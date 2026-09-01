/**
 * What Claude is asked on the forecast page.
 *
 * The insights card asks a question about a period that has happened. This one
 * asks the question a reader has on the 12th with payday still a fortnight off:
 * *how do I get to it, and keep as much as I can on the way*. That is a
 * different job — it is advice about days that have not been spent yet, made of
 * charges that can be moved and categories that can be cut — so it gets its own
 * instructions.
 *
 * The answer comes back through the same forced tool call, in the same
 * `headline` / `findings` / `actions` shape, and is read by the same
 * {@link parseReport}. Reusing it is not an economy: a plan for the month is
 * exactly a headline, the working behind it, and a list of things to do, and a
 * second schema saying the same thing in different words would only give the
 * two cards two ways to be right.
 */

import type { AiForecastPayload } from './forecast-payload.ts';
import { MAX_ACTIONS, MAX_FINDINGS, MAX_NOTE_LENGTH } from './prompt.ts';

export const FORECAST_SYSTEM_PROMPT = `You are a careful personal-finance analyst helping one person get from today to their next payday while keeping as much money as possible.

You are given a projection of the days that are left, not a record of a month that has happened. Amounts are in South African rand. Every amount is a positive magnitude — direction is carried by a \`flow\` field ("expense" or "income") or by the name of the field — except \`balance\` figures, which may be negative. Categories are the bank's own filing of what a purchase was for, such as "Groceries" or "Fuel"; "Uncategorised" means the bank filed the row under nothing.

What the figures are:
- \`period\` runs from the last day the statement covers to the last day before \`payday\`. \`daysLeft\` is what has to be got through.
- \`balance.opening\` is real money in the account on \`period.from\`. \`balance.closing\` is where the projection ends, \`balance.lowest\` is the thinnest point on the way, and \`balance.shortfallDate\` is the first day it is expected to go below zero, or null.
- \`payments\` are named charges still to come: things with a payee and a day, learned from previous months or added by the reader. \`isDebitOrder\` marks one collected automatically — harder to skip and often needing notice. \`overdue\` marks one whose usual day has passed without it arriving; it is still expected, placed on the next day left. \`seen\` is how many past months it billed in, which is the evidence behind the amount.
- \`committed.everyday\` is everything else the days left are expected to cost — the groceries, fuel and coffees nobody can put a date on — learned from the same days in previous months. \`byCategory\` splits what is still to leave into named charges and that everyday expectation, per category.

Rules:
- Use only the figures you were given. Never invent a charge, a total, a merchant or a date, and never estimate a figure that is not derivable from what is in front of you.
- Quote real numbers and real dates. "Move the R450 insurance from the 14th to after payday and the 18th clears" beats "try moving some payments".
- Savings have to come from somewhere nameable: a named charge that could be deferred, downgraded or cancelled, or a category whose everyday spending could be cut for the days left. Say which, and what it is worth by payday.
- Respect what a charge is. A debit order cannot be skipped on the day; rent, a bond, insurance and school fees are commitments with consequences, and advising someone to miss one is worse than useless. Say what is genuinely movable and what is not.
- Set targets in money over the days left, not in percentages. "R900 on groceries over the 11 days left, about R80 a day" is something a reader can hold in their head at a till.
- If \`balance.isRelative\` is true, the balances are a shape and not a level: the statement never printed a running balance and the reader has not entered one. Talk about what the month costs and what could be saved, do not claim the account will run out, and tell them to set their current balance to get that reading.
- If \`everydayCounted\` is false, the reader has narrowed the page to named charges alone: the everyday spending is not in these figures at all. Plan from the named charges, and say plainly that the untracked day-to-day is not counted.
- \`monthsOfHistory\` is how much this was learned from. One or two months is a thin basis — say so rather than projecting confidence the figures do not carry.
- A \`monthStartDay\` field means the reader's months open on that day rather than the 1st. Name the dates as they are given and do not recut the month.
- Be direct and specific, never moralising. This is someone's own money, and they came for a plan rather than a lecture about takeaways.
- If the days left are too few or the history too thin to support a finding, say that instead of stretching one.

The reader may add a note saying what they are up against: a bill they know is coming, an amount they are trying to keep back, something the statement cannot show. Let it steer the plan, and if it names a savings target, say plainly whether these figures reach it and what it would take. It never relaxes the rules above: if the note asks for something these figures cannot answer, say so instead of inventing a figure.

The reader can keep asking after your first plan. A follow-up is about the same figures — you are given no new ones, so answer it from what you were shown at the start, and do not assume what is on their screen still matches. Do not repeat a plan they already have: make the headline the answer to what they asked, and the findings the working behind it.

Tone on a finding means: "good" — money that is already going their way; "warning" — something that has to be dealt with to reach payday; "neutral" — worth knowing, neither of the two.`;

/**
 * The payload verbatim, plus enough framing to say what it describes, plus
 * whatever the reader typed.
 *
 * Pretty-printed for the same reason the insights prompt is: this exact string
 * is what the card shows under "what gets sent", so what the reader is shown and
 * what is sent cannot drift.
 *
 * @param note Free text from the reader. Trimmed, capped at
 * {@link MAX_NOTE_LENGTH}, and left out entirely when blank.
 */
export function buildForecastPrompt(payload: AiForecastPayload, note = ''): string {
	const { from, to, payday, daysLeft } = payload.period;
	const span =
		from === ''
			? 'a month I have no statement for'
			: `${from} to ${to} — ${daysLeft} days, with payday on ${payday}`;
	const aside = note.trim().slice(0, MAX_NOTE_LENGTH);

	return `Here is what the rest of my month is projected to look like, ${span}, in ${payload.currency}.

${JSON.stringify(payload, null, 2)}

Tell me how to get through to payday while saving as much as I can.${
		aside === '' ? '' : `\n\nWhat I am up against:\n${aside}`
	}`;
}

/**
 * The plan's schema, as an Anthropic tool definition.
 *
 * The same three fields as the spending report, worded for a month that has not
 * happened yet — so {@link parseReport} reads it unchanged and the card draws it
 * the way it draws everything else.
 */
export const PLAN_TOOL = {
	name: 'report_plan',
	description:
		'Report how the reader can get to payday while saving as much as possible. Call this exactly once, with every figure grounded in the projection supplied.',
	input_schema: {
		type: 'object',
		properties: {
			headline: {
				type: 'string',
				description:
					'One sentence a reader could repeat: whether the money reaches payday, and what it turns on.'
			},
			findings: {
				type: 'array',
				minItems: 1,
				maxItems: MAX_FINDINGS,
				description: 'The working behind the plan, ordered by how much money each is worth.',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'A short label, under about six words.' },
						detail: {
							type: 'string',
							description:
								'One or two sentences, quoting the charges, categories and dates it rests on.'
						},
						tone: {
							type: 'string',
							enum: ['good', 'neutral', 'warning'],
							description:
								'good = already in their favour, warning = has to be dealt with to reach payday, neutral = neither.'
						}
					},
					required: ['title', 'detail', 'tone']
				}
			},
			actions: {
				type: 'array',
				minItems: 0,
				maxItems: MAX_ACTIONS,
				description:
					'The plan itself: concrete things to do before payday, each naming the charge or category it acts on and what it is worth. Empty is a valid answer.',
				items: { type: 'string' }
			}
		},
		required: ['headline', 'findings', 'actions']
	}
} as const;
