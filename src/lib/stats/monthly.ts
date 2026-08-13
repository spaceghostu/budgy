import type { MonthMetric, MonthPoint, MonthSeries, Transaction } from '../types.ts';
import { round } from './balance.ts';

/**
 * Every month the statement touches, oldest first, as `YYYY-MM`.
 *
 * This is what the month picker steps through, so it is derived from the data
 * rather than from a calendar: a statement has the months it has.
 */
export function listMonths(transactions: readonly Transaction[]): readonly string[] {
	const months = new Set<string>();
	for (const transaction of transactions) months.add(monthOf(transaction.date));

	return [...months].sort();
}

/** The last date of a month, as `YYYY-MM-DD`. Knows about leap years. */
export function monthEnd(month: string): string {
	return `${month}-${`${daysInMonth(month)}`.padStart(2, '0')}`;
}

/**
 * Turn a statement into one running-total line per month, so the months can be
 * laid over each other and compared.
 *
 * The total accumulates from the first of the month and resets at each new one.
 * Transfers between the owner's own accounts are left out whichever side is
 * being counted, exactly as they are everywhere else: moving money between two
 * of your accounts is not a month going well.
 *
 * Two details make the lines comparable rather than merely drawn:
 *
 * - A day with no transactions holds the previous total. A cumulative series
 *   with holes in it would read as a month that stopped happening.
 * - A month the statement runs past is known to its last day, so its line spans
 *   the whole month. The newest month stops where the data does — carrying it on
 *   to the 31st would draw a flat week that only means "not yet exported".
 *
 * @param transactions Any order; grouped by their own dates.
 * @param metric Which side of the money to add up. See {@link MonthMetric}.
 */
export function buildMonthlyTotals(
	transactions: readonly Transaction[],
	metric: MonthMetric = 'net'
): readonly MonthSeries[] {
	const netByMonth = new Map<string, Map<number, number>>();

	for (const transaction of transactions) {
		const month = monthOf(transaction.date);
		const days = netByMonth.get(month) ?? new Map<number, number>();
		const day = dayOf(transaction.date);

		days.set(day, (days.get(day) ?? 0) + contribution(transaction, metric));
		netByMonth.set(month, days);
	}

	const months = [...netByMonth.keys()].sort();

	return months.map((month, index) =>
		toSeries(month, netByMonth.get(month) ?? new Map(), {
			isOldest: index === 0,
			isNewest: index === months.length - 1
		})
	);
}

/**
 * The typical month, day by day: the middle value across the months given.
 *
 * The median rather than the mean, because one ruinous month drags a mean to a
 * level no month ever actually reached — and the point of the line is to say
 * what a normal month looks like by this day.
 *
 * Each day is taken across the months that had reached it, so a month the
 * statement stops part-way into contributes to the days it has and no further.
 *
 * @param months As returned by {@link buildMonthlyTotals}.
 */
export function typicalMonth(months: readonly MonthSeries[]): readonly MonthPoint[] {
	const longest = Math.max(...months.map((month) => month.points.length), 0);

	return Array.from({ length: longest }, (_, index) => {
		const day = index + 1;
		const totals = months
			.map((month) => month.points[index])
			.filter((point) => point !== undefined)
			.map((point) => point.total);

		return { day, total: round(median(totals)) };
	});
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;

	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What one transaction adds to the running total.
 *
 * `out` and `in` return positive magnitudes so their lines climb: on a spending
 * line, higher has to mean more spent. Transfers and no-op rows contribute
 * nothing, so a month made entirely of them keeps its line — a flat one, which
 * is the truth about it.
 */
function contribution(transaction: Transaction, metric: MonthMetric): number {
	if (metric === 'out') return transaction.flow === 'expense' ? -transaction.amount : 0;
	if (metric === 'in') return transaction.flow === 'income' ? transaction.amount : 0;

	return transaction.flow === 'income' || transaction.flow === 'expense' ? transaction.amount : 0;
}

function toSeries(
	month: string,
	netByDay: ReadonlyMap<number, number>,
	position: { isOldest: boolean; isNewest: boolean }
): MonthSeries {
	const observed = [...netByDay.keys()].sort((a, b) => a - b);
	const firstDay = observed[0] ?? 1;
	const lastDay = observed.at(-1) ?? 1;
	const length = daysInMonth(month);

	const endDay = position.isNewest ? lastDay : length;

	let running = 0;
	const points: MonthPoint[] = [];
	for (let day = 1; day <= endDay; day += 1) {
		running += netByDay.get(day) ?? 0;
		points.push({ day, total: round(running) });
	}

	return {
		month,
		points,
		total: points.at(-1)?.total ?? 0,
		isPartial: (position.isOldest && firstDay > 1) || (position.isNewest && lastDay < length)
	};
}

function monthOf(date: string): string {
	return date.slice(0, 7);
}

function dayOf(date: string): number {
	return Number(date.slice(8, 10));
}

/** Day 0 of the next month is the last day of this one. */
function daysInMonth(month: string): number {
	const [year, index] = month.split('-').map(Number);
	return new Date(year, index, 0).getDate();
}
