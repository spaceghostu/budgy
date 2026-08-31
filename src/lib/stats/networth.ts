import type { MonthPoint, MonthSeries, Transaction } from '../types.ts';
import { buildBalanceSeries, hasPrintedBalances, round } from './balance.ts';
import {
	CALENDAR_START,
	cycleDate,
	cycleDay,
	cycleLength,
	cycleOf,
	cyclesApart,
	cyclesBefore,
	cyclesBetween,
	cycleOpening
} from './cycle.ts';

/**
 * How much of one account's balance is real money rather than a shape.
 *
 * A net worth made of several accounts is only as true as its weakest one, so
 * each account carries its own standing and the total says which of them, if
 * any, are still unknown.
 */
export interface AccountStanding {
	readonly account: string;
	/** The bank printed a balance beside every one of its rows. */
	readonly isCertified: boolean;
	/** Its balance is known — printed by the bank, or entered by the reader. */
	readonly isAnchored: boolean;
	/** What it stands at on the last day the statement knows about. */
	readonly closing: number;
}

/** Everything owned, added up, on a day the statement moved. */
export interface NetWorthDay {
	/** ISO date, `YYYY-MM-DD`. */
	readonly date: string;
	/** Midnight on `date`, so a chart can space the days by real time. */
	readonly timestamp: number;
	readonly total: number;
}

export interface NetWorth {
	/** One entry per day something moved, oldest first. */
	readonly days: readonly NetWorthDay[];
	/** Every account the statement covers, in the order it first appears. */
	readonly accounts: readonly AccountStanding[];
	/** The total before the first transaction, which starts the line. */
	readonly opening: number;
	/** The total on the last day the statement knows about. */
	readonly total: number;
	/** The accounts whose balance is neither printed nor entered. */
	readonly unanchored: readonly string[];
	/**
	 * True while at least one account is unanchored, so the total is a shape
	 * rather than money. It is off by however much sits in those accounts —
	 * the movement is still true, the level is not.
	 */
	readonly isRelative: boolean;
}

/**
 * Add every account up into one net worth, day by day.
 *
 * Each account keeps its own balance chain, because that is the only way the
 * numbers stay true: a printed balance belongs to one account, and chaining
 * several accounts' balances into a single line would draw a figure that was
 * never true of any of them. The lines are summed afterwards, which is a figure
 * that *is* true — what the reader is worth on that day.
 *
 * Two details keep the sum honest across accounts that move at different times:
 *
 * - An account holds its last balance through every day it did not move, so a
 *   quiet savings account still counts on the days the cheque account is busy.
 * - An account counts from the first day of the statement, not from its own
 *   first transaction, at the balance it opened on. Money that was already
 *   there did not appear the day it was first spent.
 *
 * @param transactions Every account, oldest first. Not scoped to a period —
 * net worth is a level, and a level needs the whole chain behind it.
 * @param anchors Balance after each account's most recent transaction, by
 * account. Accounts the bank printed balances for do not need one.
 */
export function buildNetWorth(
	transactions: readonly Transaction[],
	anchors: Readonly<Record<string, number>> = {}
): NetWorth {
	const byAccount = groupByAccount(transactions);

	const chains = [...byAccount.entries()].map(([account, rows]) => {
		const isCertified = hasPrintedBalances(rows);
		const series = buildBalanceSeries(rows, anchors[account] ?? 0);

		const closingByDate = new Map<string, number>();
		for (const point of series) {
			if (point.transaction === null) continue;
			closingByDate.set(point.transaction.date, point.balance);
		}

		return {
			account,
			isCertified,
			isAnchored: isCertified || anchors[account] !== undefined,
			opening: series.at(0)?.balance ?? 0,
			closing: series.at(-1)?.balance ?? 0,
			closingByDate
		};
	});

	const dates = [...new Set(transactions.map((transaction) => transaction.date))].sort();
	const standing = new Map(chains.map((chain) => [chain.account, chain.opening]));

	const days = dates.map((date) => {
		for (const chain of chains) {
			const closing = chain.closingByDate.get(date);
			if (closing !== undefined) standing.set(chain.account, closing);
		}

		return {
			date,
			timestamp: new Date(`${date}T00:00:00`).getTime(),
			total: round(sum(standing.values()))
		};
	});

	return {
		days,
		accounts: chains.map(({ account, isCertified, isAnchored, closing }) => ({
			account,
			isCertified,
			isAnchored,
			closing
		})),
		opening: round(sum(chains.map((chain) => chain.opening))),
		total: days.at(-1)?.total ?? 0,
		unanchored: chains.filter((chain) => !chain.isAnchored).map((chain) => chain.account),
		isRelative: chains.some((chain) => !chain.isAnchored)
	};
}

/**
 * Cut the net worth line into one line per month, indexed by day of the month,
 * so the months can be laid over each other and compared.
 *
 * Unlike a flow total, nothing resets: each month opens where the last one
 * closed, and the lines sit at the level the money was actually at. Which is
 * the point — the question this answers is "was I better off by the 15th of
 * this month than the 15th of last".
 *
 * Every month between the first transaction and the last is drawn, including
 * ones nothing happened in: net worth carries through a quiet month, and
 * leaving it out would suggest the money did too.
 *
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function netWorthByMonth(
	worth: NetWorth,
	start: number = CALENDAR_START
): readonly MonthSeries[] {
	const first = worth.days.at(0)?.date;
	const last = worth.days.at(-1)?.date;
	if (first === undefined || last === undefined) return [];

	const months = cyclesBetween(cycleOf(first, start), cycleOf(last, start));

	// The day list is walked once across every month rather than searched per
	// day: both run in date order, so the cursor only ever moves forwards.
	let cursor = 0;
	let running = worth.opening;

	return months.map((month, index) => {
		const isNewest = index === months.length - 1;
		const length = cycleLength(month, start);
		const endDay = isNewest ? cycleDay(last, start) : length;

		const points: MonthPoint[] = [];
		for (let day = 1; day <= endDay; day += 1) {
			const date = cycleDate(month, start, day);
			while (cursor < worth.days.length && worth.days[cursor].date <= date) {
				running = worth.days[cursor].total;
				cursor += 1;
			}

			points.push({ day, total: round(running) });
		}

		return {
			month,
			points,
			total: points.at(-1)?.total ?? 0,
			// Only the newest month can be short: every earlier day is known, even
			// before the first transaction, because the opening balance is known.
			isPartial: isNewest && endDay < length
		};
	});
}

/** A stretch of the net worth line, and the level it opens at. */
export interface NetWorthWindow {
	readonly days: readonly NetWorthDay[];
	/** The total before the window's first day moved it. */
	readonly opening: number;
}

/**
 * The last `months` calendar months of the line.
 *
 * The window opens at the level the money was *already* at, rather than at
 * whatever the first day inside it happens to be: a balance does not begin
 * again because a reader asked to see less of it. Counted in months from the
 * newest one, so "last 6 months" names the same six months here as it does on
 * the month-against-month chart.
 *
 * @param months `null` for the whole history.
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function sliceNetWorth(
	worth: NetWorth,
	months: number | null,
	start: number = CALENDAR_START
): NetWorthWindow {
	const last = worth.days.at(-1);
	const whole = { days: worth.days, opening: worth.opening };
	if (months === null || last === undefined) return whole;

	const cutoff = cycleOpening(cyclesBefore(cycleOf(last.date, start), months - 1), start);
	const from = worth.days.findIndex((day) => day.date >= cutoff);
	// A window at least as long as the history is the history.
	if (from <= 0) return whole;

	return { days: worth.days.slice(from), opening: worth.days[from - 1].total };
}

/**
 * How many months the history spans, counting both ends.
 *
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function monthsCovered(worth: NetWorth, start: number = CALENDAR_START): number {
	const first = worth.days.at(0)?.date;
	const last = worth.days.at(-1)?.date;
	if (first === undefined || last === undefined) return 0;

	return cyclesApart(cycleOf(first, start), cycleOf(last, start)) + 1;
}

/** Accounts in the order they first appear, each with its rows oldest first. */
function groupByAccount(
	transactions: readonly Transaction[]
): ReadonlyMap<string, readonly Transaction[]> {
	const byAccount = new Map<string, Transaction[]>();
	for (const transaction of transactions) {
		const rows = byAccount.get(transaction.account) ?? [];
		rows.push(transaction);
		byAccount.set(transaction.account, rows);
	}

	return byAccount;
}

function sum(values: Iterable<number>): number {
	let total = 0;
	for (const value of values) total += value;

	return total;
}
