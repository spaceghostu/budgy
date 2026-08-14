/**
 * What Claude is asked, and the shape it has to answer in.
 *
 * The answer comes back through a forced tool call rather than as prose. A
 * model asked for JSON in the prompt will occasionally wrap it in a sentence;
 * a model given a tool and told to use it returns a validated object every
 * time, which is what lets the card render findings the same way the local
 * highlights render.
 */

import type { AiPayload } from './payload.ts';

/** The card shows at most this many findings. See {@link REPORT_TOOL}. */
export const MAX_FINDINGS = 5;

/** …and at most this many suggested actions. */
export const MAX_ACTIONS = 4;

/**
 * How much of the reader's note is sent.
 *
 * A sentence or two is the point — a goal, a question, something the statement
 * cannot show. The cap is here rather than only on the textarea so that what
 * gets sent is decided in the same file as everything else that gets sent.
 */
export const MAX_NOTE_LENGTH = 500;

export const SYSTEM_PROMPT = `You are a careful personal-finance analyst reading one person's bank statement summary.

You are given aggregate figures only — totals, category and merchant rollups, per-month flow and recurring charges. Amounts are in South African rand, and every amount is a positive magnitude unless it is a "net" field, which may be negative. Categories are the bank's own filing of what a purchase was for, such as "Groceries" or "Fuel"; "Uncategorised" means the bank filed the row under nothing, not that it was unusual.

Rules:
- Use only the figures you were given. Never invent a transaction, a total, a merchant or a trend, and never estimate a figure that is not derivable from what is in front of you.
- Quote real numbers. "R2 400 on takeaways, 18% of the month" beats "you spend a lot on takeaways".
- Compare months only when more than one month is present, and say so when a month is partial.
- Recurring charges are commitments: a large monthly total that the reader may have forgotten is worth more than a one-off purchase they clearly remember.
- Be direct and specific, never moralising. This is someone's own money and they can read the totals themselves — earn the reading by pointing at what they would have missed.
- If the period is too short or too sparse to support a finding, say that instead of stretching one.

The reader may add a note saying what they want from the read: a question, a goal, or something the statement cannot show — a move, a new job, a month they already know was unusual. Let it steer what you look at and how you frame it, and if it asks a question, make the headline the answer to it. It never relaxes the rules above: if the note asks for something these figures cannot answer, say so plainly instead of inventing a figure.

Tone on a finding means: "good" — worth knowing and in their favour; "warning" — worth acting on; "neutral" — worth knowing, neither of the two.`;

/**
 * The payload verbatim, plus enough framing to say what it describes, plus
 * whatever the reader typed in the note box.
 *
 * The JSON is pretty-printed: it costs a few tokens and this whole string is
 * what the card shows the reader under "what gets sent", so what they are shown
 * and what is sent cannot drift — including their own note, which is passed
 * through word for word.
 *
 * @param note Free text from the reader. Trimmed, capped at
 * {@link MAX_NOTE_LENGTH}, and left out entirely when blank.
 */
export function buildUserPrompt(payload: AiPayload, note = ''): string {
	const { from, to, days } = payload.period;
	const period = from === '' ? 'an empty statement' : `${from} to ${to} (${days} days)`;
	const aside = note.trim().slice(0, MAX_NOTE_LENGTH);

	return `Here is the summary of my spending for ${period}, in ${payload.currency}.

${JSON.stringify(payload, null, 2)}

Read it and report what stands out.${aside === '' ? '' : `\n\nWhat I want from this read:\n${aside}`}`;
}

/**
 * The report's schema, as an Anthropic tool definition.
 *
 * Declared `as const` so the spec can assert against the literal shape rather
 * than a widened `string[]`, and so a rename shows up as a type error here
 * before it shows up as a runtime surprise in {@link parseReport}.
 */
export const REPORT_TOOL = {
	name: 'report_spending',
	description:
		'Report what stands out in the reader’s spending. Call this exactly once, with every finding grounded in the figures supplied.',
	input_schema: {
		type: 'object',
		properties: {
			headline: {
				type: 'string',
				description:
					'One sentence a reader could repeat: the single most useful thing about this period.'
			},
			findings: {
				type: 'array',
				minItems: 1,
				maxItems: MAX_FINDINGS,
				description: 'Ordered by how much each should change what the reader does.',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'A short label, under about six words.' },
						detail: {
							type: 'string',
							description: 'One or two sentences, quoting the figures it rests on.'
						},
						tone: {
							type: 'string',
							enum: ['good', 'neutral', 'warning'],
							description: 'good = in their favour, warning = worth acting on, neutral = neither.'
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
					'Concrete things the reader could do next, each tied to a figure above. Empty is a valid answer.',
				items: { type: 'string' }
			}
		},
		required: ['headline', 'findings', 'actions']
	}
} as const;
