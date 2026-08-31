/**
 * Where the month on screen is heading.
 *
 * Every other module in this app reports what happened. This one carries the
 * newest month's line past the last row in the statement and says where it ends
 * up — which is a different kind of claim, and is built to be one a reader can
 * check rather than a number they have to trust.
 *
 * The projection is made of two channels, kept apart because they are known to
 * very different standards:
 *
 * - **Committed.** Charges the history names: a debit order, a subscription, a
 *   salary. Each is placed on the day of the month it usually lands on, for what
 *   it usually takes. These are the *expected payments* — the part of next week
 *   that is already decided.
 * - **Everyday.** Everything else, as one figure: what the rest of a month
 *   usually costs, spread evenly across the days that are left. Nobody can say
 *   which Tuesday the groceries happen, so this channel does not pretend to —
 *   the committed payments carry the shape of the line, and this carries its
 *   drift.
 *
 * A merchant belongs to exactly one channel. A charge the history calls
 * recurring is never counted again in the everyday figure, whether or not it has
 * already billed this month, or the same money would be forecast twice.
 *
 * Both are learned from **complete** past cycles only. A month the statement
 * stops half-way into would drag every average down towards "not yet exported",
 * and a forecast that cannot say how much history it had is a guess wearing a
 * number's clothes — so {@link Forecast.monthsOfHistory} says, and the page says
 * it out loud.
 *
 * And only from the **recent** ones. Two years of exports is a record, not an
 * expectation: prices move, subscriptions are cancelled, salaries change. So the
 * projection reads a window of the last few complete cycles — see
 * {@link ForecastWindow} — and a charge that has missed the last
 * {@link STALE_AFTER_CYCLES} of them is treated as stopped, counted in neither
 * channel, because money that is not coming should not be forecast either by
 * name or by average.
 */

import type { MonthMetric, Transaction } from '../types.ts';
import { median } from './average.ts';
import { round } from './balance.ts';
import {
	CALENDAR_START,
	cycleDate,
	cycleDay,
	cycleLength,
	cycleOf,
	cycleOpening
} from './cycle.ts';
import { findRecurring } from './insights.ts';
import { flowAmount } from './monthly.ts';
import { normaliseType } from '../parse/normalise.ts';

/**
 * How many complete cycles back the projection reads.
 *
 * Two answers rather than a dial, because they are two different questions and
 * a reader knows which one they are asking:
 *
 * - **Six** is the standing shape of a life. Long enough for a monthly
 *   commitment to prove itself and for one strange month to be outvoted.
 * - **Three** is where things stand now. A raise, a move, a subscription
 *   cancelled in March — the recent months know about it and the older ones
 *   quietly argue against it.
 *
 * Nothing longer, because a grocery bill from two years ago describes a
 * different life; nothing shorter, because two months cannot outvote anything.
 *
 * The window sets what a charge is expected to cost and when, and what the rest
 * of the month usually runs to. It moves *whether* too, though not through the
 * staleness rule below — both windows end at the most recent complete cycle, so
 * both read the same two months for that. It is the recurring test itself that
 * runs over the window: a card subscription that went from 100 to 200 half a
 * year ago varies too much for six months to call it recurring at all, where
 * three months see a steady 200 and expect it. Which is the narrow window
 * earning its place rather than a wrinkle in it.
 */
export type ForecastWindow = 3 | 6;

/** The windows offered, so the picker and the guard cannot disagree. */
export const FORECAST_WINDOWS: readonly ForecastWindow[] = [3, 6];

/** The standing shape of a life, until the reader asks the other question. */
export const DEFAULT_WINDOW: ForecastWindow = 6;

/**
 * A named charge that has missed this many whole cycles has stopped.
 *
 * Two rather than one, because a charge can slip a month — a card reissued, a
 * billing date moved — without being cancelled. Two in a row is a pattern.
 */
const STALE_AFTER_CYCLES = 2;

/** One charge the history says is still to come this month. */
export interface ExpectedPayment {
	/**
	 * Stable identity for the charge — merchant and side.
	 *
	 * Carried on the row rather than built by whatever is looking at it, so the
	 * list that offers to drop a charge, the state that remembers the choice and
	 * the line that stops counting it cannot disagree about which charge it is.
	 */
	readonly key: string;
	readonly merchant: string;
	readonly category: string;
	/**
	 * Positive magnitude — money out for an expense, money in for income, the
	 * way every other figure in this app carries its direction in a label rather
	 * than in a sign.
	 *
	 * The middle month rather than the last: a lender that doubled up once should
	 * not set the expectation for every month after it.
	 */
	readonly amount: number;
	readonly flow: 'income' | 'expense';
	/** Day of the cycle it is expected on, counting the opening day as 1. */
	readonly day: number;
	/** That day as a `YYYY-MM-DD` date, for a list that has to name it. */
	readonly date: string;
	/**
	 * The day it usually goes off, as a `YYYY-MM-DD` date in this cycle.
	 *
	 * The same as {@link date} for a charge still to come, and the whole point of
	 * the field for one that is {@link overdue}: that charge is *placed* on the
	 * next day left, which is the same day for every late charge and so says
	 * nothing about any of them. This says which day it actually missed.
	 */
	readonly dueDate: string;
	/** Complete past cycles it billed in — the evidence behind the figure. */
	readonly seen: number;
	/**
	 * True when the day it usually lands on has already passed and it has not
	 * arrived. It is still expected — a debit order that missed the 3rd is a
	 * payment coming late, not one cancelled — so it is placed on the next day
	 * left rather than dropped.
	 */
	readonly overdue: boolean;
	readonly isDebitOrder: boolean;
	/**
	 * Where the row came from: the recurring test, the reader, or last month.
	 *
	 * The detector is deliberately conservative — see `findRecurring` — so a
	 * quarterly premium or a loan that moves about never qualifies, and the
	 * reader is the one who knows it is coming anyway. A `candidate` is neither:
	 * a payee last month had, offered on {@link Forecast.candidates} for the
	 * reader to say yes or nothing to, and counted only once they have.
	 */
	readonly source: 'history' | 'added' | 'candidate';
	/**
	 * False when the reader has said this one is not coming.
	 *
	 * Still on the list, and still says what the history says about it — dropping
	 * the row would hide the very charge whose absence is now moving the figures.
	 * It simply stops counting: out of {@link Forecast.committed} and off the
	 * line, and never into the everyday figure either, since it is a named charge
	 * whichever way it is ticked.
	 */
	readonly included: boolean;
}

/** One day on the forecast line. */
export interface ForecastPoint {
	/** Day of the cycle, 1-based. */
	readonly day: number;
	/** Running total to the end of this day. */
	readonly total: number;
	/** True once the day is projected rather than banked. */
	readonly isProjected: boolean;
	/**
	 * The same day if the rest of the month runs as the leanest or the heaviest
	 * past month did. Equal to {@link total} on days that have happened, where
	 * there is nothing left to be uncertain about.
	 */
	readonly low: number;
	readonly high: number;
}

/** The month ahead, as far as the history can see it. */
/** One category's slice of the everyday channel. */
export interface CategoryShare {
	/** The bank's sub-category, as every other breakdown in this app means it. */
	readonly category: string;
	/** Fraction of the everyday figure, between 0 and 1. */
	readonly share: number;
}

export interface Forecast {
	/** `YYYY-MM` cycle being forecast. Blank when there is no statement. */
	readonly month: string;
	/** Which side of the money the line adds up. See {@link MonthMetric}. */
	readonly metric: MonthMetric;
	/** One point per day of the cycle, opening day first. */
	readonly points: readonly ForecastPoint[];
	/** Days of the cycle the statement covers. */
	readonly elapsedDays: number;
	/** Days in the whole cycle. */
	readonly length: number;
	/** The last date the actuals cover. Blank when the cycle has not opened. */
	readonly asOf: string;
	/** The running total on {@link asOf} — banked, not projected. */
	readonly actual: number;
	/** Where the month is expected to end: `actual + committed + everyday`. */
	readonly projected: number;
	/** The named charges still to come, soonest first. */
	readonly expected: readonly ExpectedPayment[];
	/**
	 * Everything else last month had, heaviest first, for the reader to tick.
	 *
	 * The recurring test answers "what repeats" conservatively and on purpose,
	 * which leaves it silent about a great deal that is nevertheless coming. Last
	 * month is the best short answer to "what else", so it is offered in full
	 * rather than guessed at — every payee it had, none of them counted, each one
	 * a tick away from being.
	 *
	 * Payees this month has already seen are left out: they are in the actuals
	 * already, and a row whose tick could change nothing is worse than no row.
	 */
	readonly candidates: readonly ExpectedPayment[];
	/**
	 * The `YYYY-MM` cycle {@link candidates} were read from, or blank for none.
	 *
	 * Named rather than left to be inferred: with a gap in the statement the last
	 * whole month is not always the one before this one, and a heading that
	 * guessed would be wrong exactly where a reader most needs it right.
	 */
	readonly candidateMonth: string;
	/**
	 * The cycles that could be offered from, oldest first.
	 *
	 * Every complete month behind this one, not only the ones the projection
	 * learns from: "what else might be coming" is a question a reader answers
	 * from memory as much as from the window, and a quarterly bill last paid in
	 * March is exactly the thing they came looking for.
	 */
	readonly candidateMonths: readonly string[];
	/**
	 * What {@link expected} adds to the line — signed in the metric's terms, so
	 * on a net forecast a salary lifts it and a debit order pulls it down.
	 */
	readonly committed: number;
	/**
	 * What everything else is expected to add, on the same terms.
	 *
	 * Zero when the reader has asked for the named charges alone — see
	 * {@link ForecastOptions.everyday} — which is what tells a page drawing this
	 * that the line it has is narrower than the month.
	 */
	readonly everyday: number;
	/**
	 * Where the everyday figure is expected to go, as fractions of it.
	 *
	 * The everyday channel is one number because nobody can say which Tuesday
	 * the groceries happen — but a reader asking what is left to spend is asking
	 * it of groceries and fuel and coffee separately, and the history does know
	 * that much. Each entry is one category's share of the untracked spending in
	 * the same tails {@link everyday} is the median of.
	 *
	 * Fractions rather than amounts so the caller multiplies by the figure it is
	 * actually drawing: {@link Runway} reads the everyday channel as a magnitude,
	 * and a share applied to that is money out. They sum to 1, heaviest first,
	 * and the list is empty wherever {@link everyday} is zero — a month with no
	 * tails to learn from has no shares to divide.
	 *
	 * Learned from the **expense** rows in those tails alone. The tails
	 * themselves are net on a net forecast, so a stray refund belongs in the
	 * median it moves; but "still to be spent by category" is a one-sided
	 * question, and a category that is net positive over the window would take a
	 * negative share of the spending — which is not a reading, it is an artefact.
	 */
	readonly everydayShares: readonly CategoryShare[];
	/** Complete past cycles the projection was learned from. */
	readonly monthsOfHistory: number;
	/**
	 * Complete past cycles there were to choose from, before the window.
	 *
	 * What says whether the window is a choice at all: with three whole months
	 * behind it both windows read the same three, and offering the reader a
	 * control that changes nothing is worse than not offering it.
	 */
	readonly monthsAvailable: number;
	/** The window asked for. See {@link ForecastWindow}. */
	readonly window: ForecastWindow;
	/** True when the cycle is over: there is nothing left to project. */
	readonly isComplete: boolean;
}

/**
 * A charge the reader has added, because the history could not see it.
 *
 * Two kinds, because there are two different things to say:
 *
 * - **merchant** — "this payee is a commitment, whatever the test thinks". The
 *   figures still come from its own history and go on tracking it, so a premium
 *   that goes up is expected at the new price without being re-entered.
 * - **custom** — "expect this, from nothing". Rent paid from another account, a
 *   bill that has not arrived yet. Nothing in the data backs it, so what the
 *   reader typed is exactly what is expected, until they change it.
 */
export type AddedCharge = AddedMerchant | AddedCustom;

export interface AddedMerchant {
	readonly kind: 'merchant';
	/** Exactly as it appears on the transactions — this is how it is found. */
	readonly merchant: string;
	readonly flow: 'income' | 'expense';
}

export interface AddedCustom {
	readonly kind: 'custom';
	/** Stable identity, so the name can be corrected without losing the row. */
	readonly id: string;
	readonly name: string;
	readonly flow: 'income' | 'expense';
	/** Positive magnitude, like every other amount the reader reads. */
	readonly amount: number;
	/** Day of the cycle. Past the end of a short month it lands on the last day. */
	readonly day: number;
	readonly category: string;
}

/**
 * What a charge is called in {@link ForecastOptions.excluded} and on the row.
 *
 * A merchant the reader vouches for takes the same key the detector would have
 * given it, which is what lets one stand in for the other: add a payee the test
 * missed and there is one row, not two, and ticking it off means the same thing
 * either way.
 */
export function addedKey(added: AddedCharge): string {
	return added.kind === 'custom' ? `custom:${added.id}` : keyOf(added.merchant, added.flow);
}

export interface ForecastOptions {
	/** `YYYY-MM` cycle to forecast. Defaults to the newest one in the data. */
	readonly month?: string;
	readonly metric?: MonthMetric;
	/** How many complete cycles to learn from. See {@link ForecastWindow}. */
	readonly window?: ForecastWindow;
	/**
	 * Charges the reader has said are not coming, by {@link ExpectedPayment.key}.
	 *
	 * The history cannot know that a gym membership was cancelled this morning —
	 * only that it has billed every month so far. This is where the reader says
	 * otherwise, and the projection takes their word for it.
	 */
	readonly excluded?: readonly string[];
	/**
	 * Charges the reader has added. See {@link AddedCharge}.
	 *
	 * One for a payee the detector already found replaces what it found, rather
	 * than sitting beside it: the reader's word is the better evidence, and two
	 * rows for one commitment would be counted twice.
	 */
	readonly added?: readonly AddedCharge[];
	/**
	 * Which past cycle to offer payees from. See {@link Forecast.candidates}.
	 *
	 * Defaults to the last complete one, and falls back to it for a month this
	 * account does not have — switching account must not strand the offer on a
	 * month that was never there.
	 */
	readonly candidateMonth?: string;
	/** Day of the month a cycle opens on. See {@link cycleOf}. */
	readonly monthStart?: number;
	/**
	 * Whether to project the everyday channel. Defaults to `true`.
	 *
	 * The everyday figure is the honest part of the projection and the part a
	 * reader can least argue with, which is exactly why it is sometimes in the
	 * way: it slopes the line down on every single day, and a reader asking
	 * "what is actually *booked* between now and payday" cannot see the named
	 * charges for it. Turned off, the line moves only where a charge lands, and
	 * {@link Forecast.everyday} is zero — the month is not cheaper, the question
	 * is narrower, and the page has to say so.
	 */
	readonly everyday?: boolean;
}

/** A payee the statement knows, and what it has been taking. */
export interface Payee {
	readonly merchant: string;
	readonly flow: 'income' | 'expense';
	/** Positive. What it would be expected for, if it were added. */
	readonly amount: number;
	/** Complete months behind that figure. */
	readonly months: number;
	/**
	 * True when it has already billed in the month being forecast.
	 *
	 * Vouching for it is still worth doing — it is a standing instruction, and it
	 * will be expected next month — but nothing appears on this month's list, and
	 * a form that did not say so would look like a button that does nothing.
	 */
	readonly arrived: boolean;
}

/**
 * Every payee the statement has, read exactly as a vouched-for one would be.
 *
 * The same reading, deliberately: what a picker shows beside a name has to be
 * what the forecast will expect once it is picked, or the reader is offered one
 * figure and given another.
 *
 * @param transactions The account's transactions, as {@link buildForecast} takes
 * them.
 */
export function listPayees(
	transactions: readonly Transaction[],
	options: ForecastOptions = {}
): readonly Payee[] {
	const start = options.monthStart ?? CALENDAR_START;
	const window = options.window ?? DEFAULT_WINDOW;

	const dates = transactions.map((transaction) => transaction.date).sort();
	const earliest = dates.at(0);
	const latest = dates.at(-1);
	if (earliest === undefined || latest === undefined) return [];

	const month = options.month ?? cycleOf(latest, start);
	const whole = completeHistory(transactions, month, earliest, start);
	const arrived = new Set(
		transactions
			.filter((transaction) => cycleOf(transaction.date, start) === month)
			.map((transaction) => keyOf(transaction.merchant, transaction.flow))
	);
	const cycles = [...new Set(whole.map((transaction) => cycleOf(transaction.date, start)))]
		.sort()
		.slice(-window);

	const learned = new Set(cycles);
	const history = whole.filter((transaction) => learned.has(cycleOf(transaction.date, start)));
	const context = { history, fallback: whole, metric: 'net' as const, start };

	const seen = new Map<string, AddedMerchant>();
	for (const transaction of whole) {
		if (transaction.flow !== 'expense' && transaction.flow !== 'income') continue;
		if (transaction.merchant === '') continue;

		seen.set(keyOf(transaction.merchant, transaction.flow), {
			kind: 'merchant',
			merchant: transaction.merchant,
			flow: transaction.flow
		});
	}

	return [...seen.values()]
		.map((added) => {
			const charge = describeMerchant(added, context);

			return {
				merchant: charge.merchant,
				flow: charge.flow,
				amount: charge.amount,
				months: charge.months.length,
				arrived: arrived.has(keyOf(charge.merchant, charge.flow))
			};
		})
		.filter((payee) => payee.months > 0)
		.sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant));
}

/**
 * Carry the newest month's running total to the end of the month.
 *
 * @param transactions Every transaction for the account, in any order — **not**
 * a period-filtered slice. A forecast is learned from the months either side of
 * the one it is about, so it cannot be scoped to that one month.
 */
export function buildForecast(
	transactions: readonly Transaction[],
	options: ForecastOptions = {}
): Forecast {
	const start = options.monthStart ?? CALENDAR_START;
	const metric = options.metric ?? 'net';
	const window = options.window ?? DEFAULT_WINDOW;

	const dates = transactions.map((transaction) => transaction.date).sort();
	const earliest = dates.at(0);
	const latest = dates.at(-1);
	if (earliest === undefined || latest === undefined) return emptyForecast(metric, window);

	const month = options.month ?? cycleOf(latest, start);
	const length = cycleLength(month, start);
	const elapsedDays = daysCovered(latest, month, start, length);
	const isComplete = elapsedDays >= length;

	const inCycle = transactions.filter((transaction) => cycleOf(transaction.date, start) === month);
	const whole = completeHistory(transactions, month, earliest, start);
	const available = [
		...new Set(whole.map((transaction) => cycleOf(transaction.date, start)))
	].sort();
	const cycles = available.slice(-window);

	const learned = new Set(cycles);
	const history = whole.filter((transaction) => learned.has(cycleOf(transaction.date, start)));
	/** The cycles a live commitment has to have billed in at least one of. */
	const live = new Set(cycles.slice(-STALE_AFTER_CYCLES));

	const context = { history, fallback: whole, metric, start };
	const charges = withAdded(recurringCharges(history, metric, start), options.added ?? [], context);
	// The channels are split on the whole recurring set, not on what is still
	// expected: a debit order that already went off this month is in the actuals,
	// and letting its past occurrences into the everyday figure as well would
	// forecast the same money twice.
	const isCommitted = (transaction: Transaction): boolean =>
		charges.has(keyOf(transaction.merchant, transaction.flow));

	// A finished month has no room for either channel — and an expected payment
	// that never arrived in one is not a forecast, it is a month that happened.
	const position = {
		month,
		start,
		elapsedDays,
		length,
		excluded: new Set(options.excluded ?? [])
	};

	const expected = isComplete ? [] : expectedPayments(charges, inCycle, live, position);

	// Offered only while there is a month left to expect anything in, and from
	// the last whole month unless the reader asks for another — which is the best
	// short answer to "what else", not the only one.
	const offerable = isComplete ? [] : available;
	const asked = options.candidateMonth ?? '';
	const offerFrom = offerable.includes(asked) ? asked : offerable.at(-1);
	const candidates = candidatePayments(
		transactions,
		charges,
		inCycle,
		offerFrom,
		context,
		position
	);
	// No tails means no everyday channel: the median and the edges of an empty
	// series are zero, so the line, the band and the closing figure all fall
	// back to the committed charges alone without a second path through here.
	// Kept as rows rather than summed away: the median below needs one total per
	// cycle, but the per-category shares need the rows those totals are made of,
	// and re-filtering them a second time is how the two come to disagree about
	// which spending is "everyday".
	const tailRows =
		isComplete || options.everyday === false
			? []
			: cycles.map((cycle) =>
					tailTransactions(history, {
						cycle,
						start,
						after: elapsedDays,
						metric,
						skip: isCommitted
					})
				);
	const tails = tailRows.map((rows) =>
		sum(rows.map((transaction) => flowAmount(transaction, metric)))
	);

	const actual = sum(inCycle.map((transaction) => flowAmount(transaction, metric)));
	const committed = sum(counted(expected).map((payment) => paymentAmount(payment, metric)));
	const everyday = median(tails);
	const [low, high] = edges(tails);
	// Pooled across the window's cycles rather than averaged per cycle: the
	// shares describe where the untracked spending goes over the window as a
	// whole, and a category that appeared in one month of six should weigh as
	// the one month it was.
	const everydayShares = everyday === 0 ? [] : categoryShares(tailRows.flat());

	return {
		month,
		metric,
		points: buildPoints({
			actual,
			expected,
			metric,
			elapsedDays,
			length,
			everyday,
			low,
			high,
			byDay: actualByDay(inCycle, metric, start)
		}),
		elapsedDays,
		length,
		asOf: elapsedDays === 0 ? '' : cycleDate(month, start, elapsedDays),
		actual: round(actual),
		projected: round(actual + committed + everyday),
		expected,
		candidates,
		// The month offered from, whether or not it had anything left to offer: a
		// picker that lost its own value the moment it found nothing would take
		// the way back out with it.
		candidateMonth: offerFrom ?? '',
		candidateMonths: offerable,
		committed: round(committed),
		everyday: round(everyday),
		everydayShares,
		monthsOfHistory: cycles.length,
		monthsAvailable: available.length,
		window,
		isComplete
	};
}

function emptyForecast(metric: MonthMetric, window: ForecastWindow): Forecast {
	return {
		month: '',
		metric,
		points: [],
		elapsedDays: 0,
		length: 0,
		asOf: '',
		actual: 0,
		projected: 0,
		expected: [],
		candidates: [],
		candidateMonth: '',
		candidateMonths: [],
		committed: 0,
		everyday: 0,
		everydayShares: [],
		monthsOfHistory: 0,
		monthsAvailable: 0,
		window,
		isComplete: false
	};
}

/**
 * How much of the cycle the statement covers.
 *
 * A statement that runs past the cycle covers all of it; one that stops inside
 * covers the days up to its last row. A cycle the statement has not reached yet
 * is covered by nothing at all, which is a forecast of the whole month.
 */
function daysCovered(latest: string, month: string, start: number, length: number): number {
	if (latest < cycleOpening(month, start)) return 0;
	if (cycleOf(latest, start) !== month) return length;

	return cycleDay(latest, start);
}

/**
 * The rows in cycles that are both **before** the forecast cycle and whole.
 *
 * Only the oldest cycle can be short at the front — everything after it is
 * bounded by the statement on both sides — and it is dropped when its first row
 * is not on the opening day. That errs towards dropping a real month whose first
 * days were quiet, which costs one month of evidence; keeping it would quietly
 * teach the forecast that months start cheap.
 */
function completeHistory(
	transactions: readonly Transaction[],
	month: string,
	earliest: string,
	start: number
): readonly Transaction[] {
	const oldest = cycleOf(earliest, start);
	const oldestIsPartial = cycleDay(earliest, start) > 1;

	return transactions.filter((transaction) => {
		const cycle = cycleOf(transaction.date, start);

		return cycle < month && !(oldestIsPartial && cycle === oldest);
	});
}

/** One entry per charge to expect, or to offer, keyed by merchant and side. */
interface Charge {
	readonly source: ExpectedPayment['source'];
	readonly merchant: string;
	readonly category: string;
	readonly flow: 'income' | 'expense';
	readonly amount: number;
	readonly day: number;
	/** The cycles in the window it billed in — what says whether it is still live. */
	readonly months: readonly string[];
	readonly isDebitOrder: boolean;
}

/**
 * The charges that repeat, on whichever side of the money the metric counts.
 *
 * `findRecurring` is written for spending, and is fed income here as well: what
 * it actually tests for is the same amount arriving from the same counterparty
 * in month after month, which is a salary as much as it is a subscription. A
 * money-out forecast has no use for the salary and a money-in forecast has none
 * for the debit orders, so each metric is only told about the side it counts.
 */
function recurringCharges(
	history: readonly Transaction[],
	metric: MonthMetric,
	start: number
): ReadonlyMap<string, Charge> {
	const sides: readonly ('income' | 'expense')[] =
		metric === 'out' ? ['expense'] : metric === 'in' ? ['income'] : ['expense', 'income'];

	const charges = new Map<string, Charge>();
	for (const flow of sides) {
		const rows = history.filter((transaction) => transaction.flow === flow);

		for (const charge of findRecurring(rows, start)) {
			const mine = rows.filter((row) => row.merchant === charge.merchant);

			charges.set(keyOf(charge.merchant, flow), {
				source: 'history',
				merchant: charge.merchant,
				category: charge.category,
				flow,
				amount: charge.medianAmount,
				day: usualDay(mine, start),
				months: charge.months,
				isDebitOrder: charge.isDebitOrder
			});
		}
	}

	return charges;
}

interface AddedContext {
	/** The window's rows — where a vouched-for payee's figures come from. */
	readonly history: readonly Transaction[];
	/** Every complete month before this one, for a payee the window missed. */
	readonly fallback: readonly Transaction[];
	readonly metric: MonthMetric;
	readonly start: number;
}

/**
 * Fold the reader's own charges in over the ones the test found.
 *
 * Over, not beside: a merchant added by hand takes the key the detector would
 * have used, so vouching for a payee the test already qualified replaces it
 * rather than expecting it twice. A charge on the side of the money this metric
 * does not count is left out, exactly as a detected one would be.
 */
function withAdded(
	found: ReadonlyMap<string, Charge>,
	added: readonly AddedCharge[],
	context: AddedContext
): ReadonlyMap<string, Charge> {
	if (added.length === 0) return found;

	const charges = new Map(found);
	for (const charge of added) {
		if (!counts(charge.flow, context.metric)) continue;

		charges.set(addedKey(charge), toCharge(charge, context));
	}

	return charges;
}

/** True when this side of the money is one the metric adds up at all. */
function counts(flow: 'income' | 'expense', metric: MonthMetric): boolean {
	return metric === 'net' || (metric === 'out' ? flow === 'expense' : flow === 'income');
}

function toCharge(added: AddedCharge, context: AddedContext): Charge {
	if (added.kind === 'custom') {
		return {
			source: 'added',
			merchant: added.name,
			category: added.category,
			flow: added.flow,
			amount: added.amount,
			day: added.day,
			months: [],
			isDebitOrder: false
		};
	}

	return { source: 'added', ...describeMerchant(added, context) };
}

/**
 * What one payee's own history says it takes, and when.
 *
 * The same reading the recurring test would have made of it, without the test:
 * the middle billing month for the amount, the usual first day for the date. A
 * payee the window has nothing for is read from the whole statement instead —
 * an irregular charge is exactly the kind the window is most likely to miss,
 * and it is why the reader had to add it by hand in the first place.
 *
 * A payee this statement has never seen resolves to nothing, and says so by
 * having nothing to say: no months behind it, and no amount.
 */
function describeMerchant(added: AddedMerchant, context: AddedContext): Omit<Charge, 'source'> {
	const matches = (rows: readonly Transaction[]): readonly Transaction[] =>
		rows.filter((row) => row.merchant === added.merchant && row.flow === added.flow);

	const inWindow = matches(context.history);
	const rows = inWindow.length > 0 ? inWindow : matches(context.fallback);

	const byMonth = new Map<string, number>();
	for (const row of rows) {
		const cycle = cycleOf(row.date, context.start);
		byMonth.set(cycle, (byMonth.get(cycle) ?? 0) + Math.abs(row.amount));
	}

	const latest = rows.reduce<Transaction | null>(
		(newest, row) => (newest === null || row.timestamp >= newest.timestamp ? row : newest),
		null
	);

	return {
		merchant: added.merchant,
		category: latest?.category ?? '',
		flow: added.flow,
		amount: median([...byMonth.values()]),
		day: usualDay(rows, context.start),
		months: [...byMonth.keys()].sort(),
		isDebitOrder: rows.length > 0 && rows.every((row) => normaliseType(row.type) === 'debit order')
	};
}

/**
 * The day of the month a charge usually lands on.
 *
 * The **first** day it billed in each month, then the middle of those: a lender
 * taking a second instalment later in the month is still one commitment, and it
 * is the day the money first moves that the reader needs warning of.
 */
function usualDay(charges: readonly Transaction[], start: number): number {
	const firstByMonth = new Map<string, number>();

	for (const charge of charges) {
		const cycle = cycleOf(charge.date, start);
		const day = cycleDay(charge.date, start);

		firstByMonth.set(cycle, Math.min(firstByMonth.get(cycle) ?? day, day));
	}

	return Math.max(Math.round(median([...firstByMonth.values()])), 1);
}

interface CyclePosition {
	readonly month: string;
	readonly start: number;
	readonly elapsedDays: number;
	readonly length: number;
	/** Charge keys the reader has ticked off. See {@link ForecastOptions}. */
	readonly excluded: ReadonlySet<string>;
}

/**
 * The charges the history names that are still live and have not turned up
 * this month yet.
 *
 * Two filters, and they rule out different things. *Arrived* is matched on
 * merchant **and** side, so a shop that both refunds and charges is not counted
 * as settled by the wrong one. *Live* drops what has quietly stopped: over a
 * long statement the recurring test qualifies plenty of charges that ran for a
 * few months two years ago, and expecting all of them would put a year of
 * cancelled subscriptions on next week.
 */
function expectedPayments(
	charges: ReadonlyMap<string, Charge>,
	inCycle: readonly Transaction[],
	live: ReadonlySet<string>,
	position: CyclePosition
): readonly ExpectedPayment[] {
	const arrived = new Set(
		inCycle.map((transaction) => keyOf(transaction.merchant, transaction.flow))
	);

	return [...charges.entries()]
		.filter(
			([key, charge]) =>
				!arrived.has(key) &&
				// A charge the reader added is live because they said so — the
				// staleness rule reads a history that, for these, is the very thing
				// that could not see them.
				(charge.source === 'added' || charge.months.some((month) => live.has(month)))
		)
		.map(([key, charge]) => toPayment(key, charge, position))
		.sort((a, b) => a.day - b.day || b.amount - a.amount || a.merchant.localeCompare(b.merchant));
}

/**
 * One charge as the row a reader sees.
 *
 * Shared by the charges the projection counts and the ones merely offered, so a
 * payee reads the same either side of the tick that moves it between them.
 */
function toPayment(key: string, charge: Charge, position: CyclePosition): ExpectedPayment {
	const overdue = charge.day <= position.elapsedDays;
	// Never past the end of the month — a charge that bills on the 31st bills on
	// the 30th in a month that has no 31st, exactly as the bank would, rather
	// than falling off a line that stops at the 30th.
	const due = Math.min(charge.day, position.length);
	// Late, not gone: it lands on the first day there is still room for, while
	// `due` goes on saying which day it was that it missed.
	const day = overdue ? Math.min(position.elapsedDays + 1, position.length) : due;

	return {
		// The map's own key, not one rebuilt from the merchant: a charge of the
		// reader's own is keyed by an id precisely so that renaming it does not
		// lose the tick beside it.
		key,
		merchant: charge.merchant,
		category: charge.category,
		amount: charge.amount,
		flow: charge.flow,
		day,
		date: cycleDate(position.month, position.start, day),
		dueDate: cycleDate(position.month, position.start, due),
		seen: charge.months.length,
		overdue,
		isDebitOrder: charge.isDebitOrder,
		source: charge.source,
		included: !position.excluded.has(key)
	};
}

/**
 * Last month's payees, less the ones already answered for.
 *
 * Answered for means one of two things, and both are already on screen: a charge
 * the projection counts, and a payee this month has seen — the first is in the
 * list above, the second in the figures the month has banked. What is left is
 * the honest remainder of "what else could be coming", and it is offered rather
 * than decided.
 *
 * @param cycle The last complete cycle — the month the offer is made from.
 */
function candidatePayments(
	transactions: readonly Transaction[],
	charges: ReadonlyMap<string, Charge>,
	inCycle: readonly Transaction[],
	cycle: string | undefined,
	context: AddedContext,
	position: CyclePosition
): readonly ExpectedPayment[] {
	if (cycle === undefined) return [];

	const arrived = new Set(
		inCycle.map((transaction) => keyOf(transaction.merchant, transaction.flow))
	);

	const payees = new Map<string, AddedMerchant>();
	for (const transaction of transactions) {
		if (cycleOf(transaction.date, context.start) !== cycle) continue;
		if (transaction.flow !== 'expense' && transaction.flow !== 'income') continue;
		if (transaction.merchant === '') continue;
		// A payee on the side this metric does not add up could be ticked and
		// change nothing, which is the one thing an offer must not do.
		if (!counts(transaction.flow, context.metric)) continue;

		const key = keyOf(transaction.merchant, transaction.flow);
		if (charges.has(key) || arrived.has(key)) continue;

		payees.set(key, { kind: 'merchant', merchant: transaction.merchant, flow: transaction.flow });
	}

	return [...payees.entries()]
		.map(([key, payee]) =>
			toPayment(key, { source: 'candidate', ...describeMerchant(payee, context) }, position)
		)
		.map((payment) => ({ ...payment, included: false }))
		.sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant));
}

interface TailQuery {
	readonly cycle: string;
	readonly start: number;
	/** Count only the days after this one — the same tail the forecast needs. */
	readonly after: number;
	readonly metric: MonthMetric;
	readonly skip: (transaction: Transaction) => boolean;
}

/**
 * The rows one past cycle put through the days this month has left.
 *
 * The same tail rather than the whole month, so a reader looking at the 25th is
 * told what the last few days usually cost rather than what a month costs. A
 * cycle shorter than this one simply has no rows in the days past its end, which
 * is the honest answer for it.
 */
function tailTransactions(
	history: readonly Transaction[],
	query: TailQuery
): readonly Transaction[] {
	return history.filter(
		(transaction) =>
			cycleOf(transaction.date, query.start) === query.cycle &&
			cycleDay(transaction.date, query.start) > query.after &&
			!query.skip(transaction)
	);
}

/**
 * How the untracked spending in those tails divides by category.
 *
 * Shares of the spending rather than of the net, for the reason on
 * {@link Forecast.everydayShares}: a category the window happened to refund more
 * than it charged would otherwise take a negative slice of a positive figure.
 * Income rows are simply not part of the question being asked.
 *
 * Sums to exactly 1 where anything was spent, so a caller apportioning a figure
 * by these shares gets that figure back. Empty where nothing was.
 */
function categoryShares(rows: readonly Transaction[]): readonly CategoryShare[] {
	const totals = new Map<string, number>();
	for (const transaction of rows) {
		if (transaction.flow !== 'expense') continue;

		const spent = Math.abs(transaction.amount);
		totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + spent);
	}

	const total = sum([...totals.values()]);
	if (total === 0) return [];

	return [...totals]
		.map(([category, spent]) => ({ category, share: spent / total }))
		.sort((a, b) => b.share - a.share || a.category.localeCompare(b.category));
}

interface LineInput {
	readonly actual: number;
	readonly expected: readonly ExpectedPayment[];
	readonly metric: MonthMetric;
	readonly elapsedDays: number;
	readonly length: number;
	readonly everyday: number;
	readonly low: number;
	readonly high: number;
	readonly byDay: ReadonlyMap<number, number>;
}

/**
 * The line itself: banked days, then projected ones.
 *
 * Each projected day is computed from the whole of the everyday figure rather
 * than by adding a daily slice over and over — repeated addition of a fraction
 * drifts, and the last point of this line has to come to exactly the figure the
 * tiles beside it show.
 */
function buildPoints(input: LineInput): readonly ForecastPoint[] {
	const remaining = Math.max(input.length - input.elapsedDays, 0);
	const committedTo = cumulativeCommitments(input.expected, input.metric, input.length);

	const points: ForecastPoint[] = [];
	let banked = 0;

	for (let day = 1; day <= input.length; day += 1) {
		if (day <= input.elapsedDays) {
			banked += input.byDay.get(day) ?? 0;
			points.push({
				day,
				total: round(banked),
				isProjected: false,
				low: round(banked),
				high: round(banked)
			});
			continue;
		}

		const share = remaining === 0 ? 0 : (day - input.elapsedDays) / remaining;
		const committed = committedTo[day] ?? 0;
		const middle = input.actual + committed + input.everyday * share;
		const lean = input.actual + committed + input.low * share;
		const heavy = input.actual + committed + input.high * share;

		points.push({
			day,
			total: round(middle),
			isProjected: true,
			low: round(Math.min(lean, heavy)),
			high: round(Math.max(lean, heavy))
		});
	}

	return points;
}

/** What the named payments have added to the line by the end of each day. */
function cumulativeCommitments(
	expected: readonly ExpectedPayment[],
	metric: MonthMetric,
	length: number
): readonly number[] {
	const totals: number[] = [];
	let running = 0;

	for (let day = 1; day <= length; day += 1) {
		running += sum(
			counted(expected)
				.filter((payment) => payment.day === day)
				.map((payment) => paymentAmount(payment, metric))
		);
		totals[day] = running;
	}

	return totals;
}

/**
 * What one expected payment adds to the line, in the metric's own terms.
 *
 * The list carries magnitudes and a direction, the way the rest of the app does.
 * The line needs a sign, and which sign depends on what is being plotted: on a
 * money-out total a debit order climbs, and on a net total it falls.
 */
function paymentAmount(payment: ExpectedPayment, metric: MonthMetric): number {
	if (metric === 'net') return payment.flow === 'income' ? payment.amount : -payment.amount;

	return payment.amount;
}

/**
 * The lean and heavy edges of the projection.
 *
 * What past months did over these same days, with the single most extreme on
 * each side set aside once there are enough months to spare them. One freak
 * month — a car bought, a bonus paid — stretches a band until every other line
 * on the plot is squashed flat against it, and a range nothing can be read
 * inside is worse than no range at all. Under four months there is nothing to
 * trim: the months are the evidence, all of it.
 */
function edges(tails: readonly number[]): readonly [number, number] {
	if (tails.length === 0) return [0, 0];

	const sorted = [...tails].sort((a, b) => a - b);
	const trim = sorted.length >= 4 ? 1 : 0;

	return [sorted[trim], sorted[sorted.length - 1 - trim]];
}

/** This month's banked flow, by day of the cycle. */
function actualByDay(
	inCycle: readonly Transaction[],
	metric: MonthMetric,
	start: number
): ReadonlyMap<number, number> {
	const byDay = new Map<number, number>();

	for (const transaction of inCycle) {
		const day = cycleDay(transaction.date, start);
		byDay.set(day, (byDay.get(day) ?? 0) + flowAmount(transaction, metric));
	}

	return byDay;
}

/**
 * The payments the projection actually counts.
 *
 * One place, so the tile, the line and the list cannot come to three different
 * answers about what a ticked-off charge does.
 */
export function counted(payments: readonly ExpectedPayment[]): readonly ExpectedPayment[] {
	return payments.filter((payment) => payment.included);
}

function keyOf(merchant: string, flow: string): string {
	return `${flow}:${merchant}`;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
