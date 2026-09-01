/**
 * How long the money lasts.
 *
 * The forecast next door answers "what will this month come to". This module
 * asks the shorter, more useful question a reader actually has on the 12th:
 * *from what is in the account right now, does it reach payday* — and if it
 * dips, when, and how far.
 *
 * It is the same projection, read on a different axis. Nothing here re-learns
 * anything from the statement: it takes one {@link Forecast}, anchors its line
 * to a real balance and crops it to the days that are still ahead. That is
 * deliberate — the tiles, the line and the list of expected payments all read
 * from the same single `buildForecast` call, so they cannot come to different
 * conclusions about the same month.
 *
 * Two things follow from being a balance rather than a total:
 *
 * - **It is always net.** Money out lowers it and money in raises it, so the
 *   forecast behind it has to be built with `metric: 'net'`. There is no such
 *   thing as a money-out-only balance.
 * - **It only knows what the statement knows.** Own-account transfers are not
 *   income or spending, so they are not in the projection — a standing sweep to
 *   savings will not show up here unless the reader adds it as a charge.
 *
 * Payday is the day the reader's next cycle opens — the setting in
 * {@link cycleOf}. So the line runs to the last day of this cycle, and
 * {@link Runway.payday} is the morning after it.
 */

import { cycleClosing, cycleDate, cycleOpening, nextCycle, CALENDAR_START } from './cycle.ts';
import { counted, type CategoryShare, type ExpectedPayment, type Forecast } from './forecast.ts';

/** One day between now and payday. */
export interface RunwayDay {
	/** Day of the cycle, so a point can be matched back to the forecast. */
	readonly day: number;
	readonly date: string;
	/** What the account is expected to hold at the end of this day. */
	readonly balance: number;
	/**
	 * The same day if the rest of the month runs as the leanest or the heaviest
	 * of the months behind it did. Equal to {@link balance} on the opening day,
	 * where the money is counted rather than projected.
	 */
	readonly low: number;
	readonly high: number;
	/** The charges expected to land on this day. Only the counted ones. */
	readonly payments: readonly ExpectedPayment[];
	/** False on the opening day alone — that one is the bank's own figure. */
	readonly isProjected: boolean;
}

/**
 * What one category still has to take before payday.
 *
 * The two channels are kept apart here for the same reason the forecast keeps
 * them apart: they are known to very different standards. {@link named} is money
 * with a date and a payee on it, and {@link everyday} is this category's share
 * of what the rest of the month usually costs — a reasonable expectation, not an
 * appointment. A reader deciding whether to spend on groceries this week is
 * owed the difference between the two.
 */
export interface CategoryOutlook {
	/** The bank's sub-category, as every other breakdown in this app means it. */
	readonly category: string;
	/** Positive. Named charges still to come, from {@link Runway.payments}. */
	readonly named: number;
	/** Positive. This category's slice of {@link Runway.everyday}. */
	readonly everyday: number;
	/** Positive. `named + everyday` — what the category has left to take. */
	readonly total: number;
	/** How many named charges are behind {@link named}. */
	readonly count: number;
	/** {@link total} as a fraction of everything still to leave. */
	readonly share: number;
}

/** The stretch between the last thing that happened and the next payday. */
export interface Runway {
	/** Today first, then one point per day left. Empty without a statement. */
	readonly days: readonly RunwayDay[];
	/** The last date the statement covers — where the projection starts. */
	readonly from: string;
	/** The last day of the cycle: the final day the money has to stretch over. */
	readonly to: string;
	/** The day the next cycle opens. See {@link cycleOf}. */
	readonly payday: string;
	/** Days still to be got through. Zero once the cycle is over. */
	readonly daysLeft: number;
	/** What the account holds on {@link from} — banked, not projected. */
	readonly opening: number;
	/** What it is expected to hold on {@link to}, the night before payday. */
	readonly closing: number;
	/**
	 * The day the balance is expected to be at its lowest.
	 *
	 * The figure the reader came for, and not the same as {@link closing}: a
	 * salary or a refund mid-month can lift the line back up, and a month that
	 * ends comfortably can still have a Tuesday in it that does not.
	 */
	readonly lowest: RunwayDay | null;
	/**
	 * The first day the balance is expected to go below zero, or `null`.
	 *
	 * Separate from {@link lowest} because they answer different questions —
	 * *how thin does it get* and *does it break* — and the second one is the one
	 * worth interrupting a reader for.
	 */
	readonly shortfall: RunwayDay | null;
	/** Every counted charge still to come, soonest first. */
	readonly payments: readonly ExpectedPayment[];
	/** Positive. What the counted charges take out between now and payday. */
	readonly committedOut: number;
	/** Positive. What they are expected to bring in. */
	readonly committedIn: number;
	/**
	 * Positive. Everything else the days left are expected to cost — the
	 * groceries and the coffees nobody can put a date on.
	 */
	readonly everyday: number;
	/**
	 * What is still to leave, split by category — heaviest first.
	 *
	 * The same money as `committedOut + everyday` and no other: the named half is
	 * {@link payments} grouped by category, the everyday half is
	 * {@link everyday} apportioned by the shares the forecast learned. So the
	 * rows add up to the figure the page shows above them, which is the whole
	 * point of computing it here rather than beside it.
	 *
	 * Spending only. Money still expected *in* is not something a category has
	 * left to spend, and a salary sitting in this list under `Income` would
	 * invite exactly the wrong arithmetic.
	 */
	readonly byCategory: readonly CategoryOutlook[];
	/** Complete past cycles the projection was learned from. */
	readonly monthsOfHistory: number;
	/** True when the cycle is over: there is nothing left to project. */
	readonly isComplete: boolean;
	/** True when there is no statement to project from at all. */
	readonly isEmpty: boolean;
}

export interface RunwayOptions {
	/**
	 * What the account holds on the forecast's `asOf` date.
	 *
	 * Real money where the bank printed it or the reader entered it, and `0`
	 * where neither did — in which case the line is still the right shape, it
	 * just reads as net change. The caller says which, the way the balance chart
	 * and net worth already do.
	 */
	readonly balance: number;
	/** Day of the month a cycle opens on — payday. See {@link cycleOf}. */
	readonly monthStart?: number;
}

/**
 * Crop a forecast to the days ahead and anchor it to a balance.
 *
 * @param forecast Built with `metric: 'net'`. See the note at the top of this
 * module — a balance has no money-out-only reading.
 */
export function buildRunway(forecast: Forecast, options: RunwayOptions): Runway {
	const start = options.monthStart ?? CALENDAR_START;
	const opening = round(options.balance);

	if (forecast.month === '' || forecast.points.length === 0) return emptyRunway(opening);

	const from = forecast.asOf === '' ? cycleOpening(forecast.month, start) : forecast.asOf;
	const to = cycleClosing(forecast.month, start);
	const payday = cycleOpening(nextCycle(forecast.month), start);

	// The line is a running net total from the first day of the cycle. Only the
	// part of it that has not happened yet belongs on a balance, so today's
	// total is subtracted out and the rest is carried on top of real money.
	const today = Math.max(forecast.elapsedDays, 1);
	const banked = forecast.points[today - 1]?.total ?? 0;

	const payments = counted(forecast.expected);
	const byDay = new Map<number, ExpectedPayment[]>();
	for (const payment of payments) {
		byDay.set(payment.day, [...(byDay.get(payment.day) ?? []), payment]);
	}

	const days: RunwayDay[] = [];
	for (let day = today; day <= forecast.length; day += 1) {
		const point = forecast.points[day - 1];
		if (point === undefined) continue;

		days.push({
			day,
			date: cycleDate(forecast.month, start, day),
			balance: round(opening + point.total - banked),
			low: round(opening + point.low - banked),
			high: round(opening + point.high - banked),
			payments: byDay.get(day) ?? [],
			isProjected: point.isProjected
		});
	}

	return {
		days,
		from,
		to,
		payday,
		daysLeft: Math.max(forecast.length - forecast.elapsedDays, 0),
		opening,
		closing: days.at(-1)?.balance ?? opening,
		lowest: lowestOf(days),
		shortfall: days.find((day) => day.balance < 0) ?? null,
		payments,
		committedOut: round(sum(payments, 'expense')),
		committedIn: round(sum(payments, 'income')),
		// Reported as a magnitude, like every other figure a reader reads. The
		// channel is spending and a net forecast signs it negative, which
		// `tailTransactions` guarantees by counting expense rows alone — without
		// that, money in could turn the figure positive and this line would report
		// an expected *inflow* as "everyday spending" while the chart above it
		// climbed.
		everyday: round(Math.abs(forecast.everyday)),
		byCategory: byCategory(payments, round(Math.abs(forecast.everyday)), forecast.everydayShares),
		monthsOfHistory: forecast.monthsOfHistory,
		isComplete: forecast.isComplete,
		isEmpty: false
	};
}

/**
 * The thinnest the balance gets, earliest of any ties.
 *
 * Earliest because the reader is being warned, and a warning is only useful
 * before the day it is about.
 */
function lowestOf(days: readonly RunwayDay[]): RunwayDay | null {
	return days.reduce<RunwayDay | null>(
		(lowest, day) => (lowest === null || day.balance < lowest.balance ? day : lowest),
		null
	);
}

function emptyRunway(opening: number): Runway {
	return {
		days: [],
		from: '',
		to: '',
		payday: '',
		daysLeft: 0,
		opening,
		closing: opening,
		lowest: null,
		shortfall: null,
		payments: [],
		committedOut: 0,
		committedIn: 0,
		everyday: 0,
		byCategory: [],
		monthsOfHistory: 0,
		isComplete: false,
		isEmpty: true
	};
}

/**
 * Split what is still to leave across the categories it will leave through.
 *
 * Both channels land in the same row where a category has both — a Netflix debit
 * order and the odd cinema ticket are one answer to "what is entertainment still
 * costing me", not two — but each keeps its own figure on the row, because one
 * is a date in the diary and the other is a habit.
 *
 * The everyday figure is apportioned rather than re-learned per category. A
 * per-category median would not sum to the median of the whole, and the rows
 * would then quietly disagree with the total the page shows above them; shares
 * of the one figure reconcile by construction. See
 * {@link Forecast.everydayShares}.
 */
function byCategory(
	payments: readonly ExpectedPayment[],
	everyday: number,
	shares: readonly CategoryShare[]
): readonly CategoryOutlook[] {
	const named = new Map<string, { total: number; count: number }>();
	for (const payment of payments) {
		if (payment.flow !== 'expense') continue;

		const row = named.get(payment.category) ?? { total: 0, count: 0 };
		named.set(payment.category, { total: row.total + payment.amount, count: row.count + 1 });
	}

	const apportioned = apportion(everyday, shares);
	const categories = new Set([...named.keys(), ...apportioned.keys()]);

	const rows = [...categories].map((category) => {
		const own = named.get(category) ?? { total: 0, count: 0 };
		const drift = apportioned.get(category) ?? 0;

		return {
			category,
			named: round(own.total),
			everyday: drift,
			total: round(own.total + drift),
			count: own.count,
			// Filled in below, once there is a total to take a share of.
			share: 0
		};
	});

	const total = rows.reduce((running, row) => running + row.total, 0);

	return rows
		.filter((row) => row.total !== 0)
		.map((row) => ({ ...row, share: total === 0 ? 0 : row.total / total }))
		.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

/**
 * Divide one figure by share, to the cent, without losing a cent.
 *
 * Rounding each slice on its own leaves the parts a few cents off the whole,
 * which is exactly the kind of small lie that makes a reader stop trusting the
 * big numbers. So the remainder after rounding down is handed out one cent at a
 * time, largest fractional part first — the standard largest-remainder
 * apportionment — and the slices add back to the figure exactly.
 */
function apportion(total: number, shares: readonly CategoryShare[]): ReadonlyMap<string, number> {
	if (total === 0 || shares.length === 0) return new Map();

	const cents = Math.round(total * 100);
	const exact = shares.map((share) => ({ category: share.category, value: share.share * cents }));
	const floors = exact.map((slice) => ({ ...slice, floor: Math.floor(slice.value) }));

	const spare = cents - floors.reduce((running, slice) => running + slice.floor, 0);
	// Ties broken by name, so the same input always divides the same way.
	const order = [...floors].sort(
		(a, b) => b.value - b.floor - (a.value - a.floor) || a.category.localeCompare(b.category)
	);
	const topped = new Set(order.slice(0, Math.max(spare, 0)).map((slice) => slice.category));

	return new Map(
		floors.map((slice) => [
			slice.category,
			(slice.floor + (topped.has(slice.category) ? 1 : 0)) / 100
		])
	);
}

function sum(payments: readonly ExpectedPayment[], flow: 'income' | 'expense'): number {
	return payments
		.filter((payment) => payment.flow === flow)
		.reduce((total, payment) => total + payment.amount, 0);
}

/** Money is decimal; floating-point sums drift. Settle to cents at each step. */
function round(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
