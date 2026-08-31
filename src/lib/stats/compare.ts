/**
 * Months compared by what the money actually went on.
 *
 * `stats/monthly.ts` lays one month's running total over another, which says
 * whether a month went well but never why. This says why: the same categories,
 * or the same merchants, in a column each, across the months being compared —
 * and what moved between the last two of them.
 *
 * Spending only, exactly as every other breakdown in the app counts it. Money
 * coming in has no category worth putting beside last month's, and a transfer
 * between the reader's own accounts is not spending at all. See
 * {@link bucketBy} in `stats/insights.ts`, which rolls up the same rows for a
 * single period.
 */

import type { CompareDimension, ComparisonRow, MonthComparison, Transaction } from '../types.ts';
import { round } from './balance.ts';
import { CALENDAR_START, cycleDay, cycleLength, cycleOf } from './cycle.ts';

/** What both exports call a row they have nothing to file under. */
const UNCATEGORISED = 'Uncategorised';

/**
 * Roll spending up by category or merchant, one column per month.
 *
 * The months are given rather than derived, because a comparison is a choice:
 * every month a statement touches is what {@link listMonths} answers, and
 * putting twelve of them side by side is a different question from putting
 * three. They are sorted and deduplicated here so a caller cannot produce a
 * table whose columns run backwards.
 *
 * A month that is asked for and has nothing in it keeps its column. Dropping it
 * would quietly answer a different question from the one the reader asked, and
 * a month of no spending on eating out is a real answer.
 *
 * @param transactions The account's transactions, in any order — **not** a
 * period-filtered slice, since a comparison cannot be scoped to one of the
 * months it compares.
 * @param months `YYYY-MM` cycles to compare. See {@link cycleOf}.
 * @param dimension Whether rows are the bank's sub-categories or merchants.
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function compareMonths(
	transactions: readonly Transaction[],
	months: readonly string[],
	dimension: CompareDimension = 'category',
	start: number = CALENDAR_START
): MonthComparison {
	const columns = [...new Set(months)].sort();
	const position = new Map(columns.map((month, index) => [month, index]));
	const partial = partialMonths(transactions, start);

	const totals = new Map<string, Map<number, number>>();
	const counts = new Map<string, number>();
	const monthTotals = new Map<number, number>();

	for (const transaction of transactions) {
		if (transaction.flow !== 'expense') continue;

		const index = position.get(cycleOf(transaction.date, start));
		if (index === undefined) continue;

		const label = labelFor(transaction, dimension);
		const spent = Math.abs(transaction.amount);
		const byMonth = totals.get(label) ?? new Map<number, number>();

		byMonth.set(index, (byMonth.get(index) ?? 0) + spent);
		totals.set(label, byMonth);
		counts.set(label, (counts.get(label) ?? 0) + 1);
		monthTotals.set(index, (monthTotals.get(index) ?? 0) + spent);
	}

	return {
		dimension,
		months: columns.map((month, index) => ({
			month,
			total: round(monthTotals.get(index) ?? 0),
			isPartial: partial.has(month)
		})),
		rows: [...totals.entries()]
			.map(([label, byMonth]) => toRow(label, byMonth, counts.get(label) ?? 0, columns.length))
			.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
	};
}

/**
 * The months the statement may not have all of.
 *
 * Read from every transaction rather than from spending alone: a month whose
 * first *purchase* happens to fall on the 9th is a quiet week, not a statement
 * that opened late, and flagging it would put an asterisk on most months.
 *
 * The rule is {@link buildMonthlyTotals}'s, so the same month is hedged
 * wherever it is drawn: only the ends of a statement are ever in doubt, and the
 * oldest one errs towards partial, because a late opening and a quiet first of
 * the month cannot be told apart.
 */
function partialMonths(transactions: readonly Transaction[], start: number): ReadonlySet<string> {
	const spans = new Map<string, { first: number; last: number }>();

	for (const transaction of transactions) {
		const month = cycleOf(transaction.date, start);
		const day = cycleDay(transaction.date, start);
		const span = spans.get(month);

		spans.set(month, {
			first: Math.min(span?.first ?? day, day),
			last: Math.max(span?.last ?? day, day)
		});
	}

	const months = [...spans.keys()].sort();
	const oldest = months.at(0);
	const newest = months.at(-1);
	const partial = new Set<string>();

	if (oldest !== undefined && (spans.get(oldest)?.first ?? 1) > 1) partial.add(oldest);
	if (newest !== undefined && (spans.get(newest)?.last ?? 1) < cycleLength(newest, start)) {
		partial.add(newest);
	}

	return partial;
}

function toRow(
	label: string,
	byMonth: ReadonlyMap<number, number>,
	count: number,
	span: number
): ComparisonRow {
	const totals = Array.from({ length: span }, (_, index) => round(byMonth.get(index) ?? 0));

	// One month is a breakdown rather than a comparison: there is no month before
	// it, so nothing moved and saying it rose by its own total would be a lie.
	const latest = span > 1 ? (totals.at(-1) ?? 0) : 0;
	const previous = span > 1 ? (totals.at(-2) ?? 0) : 0;
	const change = round(latest - previous);

	return {
		label,
		totals,
		total: round(totals.reduce((sum, total) => sum + total, 0)),
		count,
		change,
		changeShare: previous > 0 ? change / previous : null
	};
}

/**
 * What a transaction is filed under, for the dimension being rolled up.
 *
 * Exported because a bar and the list behind it have to agree on what a label
 * means: a row the bank left blank is counted under `Uncategorised` here, and
 * anything drilling into that bar has to look for the same empty string rather
 * than for the word.
 */
export function labelFor(transaction: Transaction, dimension: CompareDimension): string {
	const label = dimension === 'merchant' ? transaction.merchant : transaction.category;

	return label || UNCATEGORISED;
}

/** One merchant's share of a bar — the unit a category rule applies to. */
export interface DrilldownMerchant {
	readonly merchant: string;
	/** Positive. */
	readonly total: number;
	readonly count: number;
	/** Newest first, like the drill-down they came from. */
	readonly transactions: readonly Transaction[];
	/** What these rows are filed under now: the bank's word, or a rule's. */
	readonly category: string;
}

/** Everything behind one bar: the rows it counted, and what they came to. */
export interface Drilldown {
	readonly dimension: CompareDimension;
	readonly label: string;
	/** `YYYY-MM` cycles the rows were narrowed to, or `null` for all of them. */
	readonly months: readonly string[] | null;
	/** Newest first — a drill-down is read backwards from what just happened. */
	readonly transactions: readonly Transaction[];
	/** Positive. Equal to the figure that was clicked, by construction. */
	readonly total: number;
	/**
	 * The same rows grouped by merchant, heaviest first.
	 *
	 * Grouped because a category rule is keyed by merchant and not by transaction
	 * — see the note at the top of `categorise.ts`. Anything offering to re-file
	 * what is behind a bar has to offer it at the level the choice is actually
	 * made at, or it promises one answer per row and delivers one per merchant.
	 */
	readonly merchants: readonly DrilldownMerchant[];
}

/**
 * The transactions behind a category or a merchant.
 *
 * Counted exactly as the bar above it was, which is the whole point: spending
 * only, from the same slice, under the same label. A list that quietly included
 * a refund would total to something the bar does not say, and no two figures on
 * screen are allowed to disagree.
 *
 * @param transactions The same rows the bucket was built from.
 * @param months Cycles to narrow to, for a bar that stands for one month.
 * `null` takes every month in `transactions`.
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function drillInto(
	transactions: readonly Transaction[],
	dimension: CompareDimension,
	label: string,
	months: readonly string[] | null = null,
	start: number = CALENDAR_START
): Drilldown {
	const wanted = months === null ? null : new Set(months);

	const matching = transactions.filter(
		(transaction) =>
			transaction.flow === 'expense' &&
			labelFor(transaction, dimension) === label &&
			(wanted === null || wanted.has(cycleOf(transaction.date, start)))
	);

	const found = [...matching].sort(
		(a, b) => b.timestamp - a.timestamp || b.fileOrder - a.fileOrder
	);

	return {
		dimension,
		label,
		months,
		transactions: found,
		total: round(matching.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)),
		merchants: groupByMerchant(found)
	};
}

function groupByMerchant(transactions: readonly Transaction[]): readonly DrilldownMerchant[] {
	const groups = new Map<string, Transaction[]>();

	for (const transaction of transactions) {
		groups.set(transaction.merchant, [...(groups.get(transaction.merchant) ?? []), transaction]);
	}

	return [...groups.entries()]
		.map(([merchant, rows]) => ({
			merchant,
			total: round(rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
			count: rows.length,
			transactions: rows,
			// Every row here shares a merchant, and a rule files a merchant whole —
			// so what the newest one says is what the group says.
			category: rows[0]?.category ?? ''
		}))
		.sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/**
 * Fold everything past `limit` into one row, so a chart never has to draw a
 * tail it cannot label.
 *
 * Folded by overall total rather than per month, which is what makes the bars
 * comparable: an "Other" made of different categories in each column would be a
 * different subject in each column too.
 *
 * The table is given the full list — this is a drawing limit, not a finding.
 */
export function foldTail(rows: readonly ComparisonRow[], limit: number): readonly ComparisonRow[] {
	if (rows.length <= limit) return rows;

	const head = rows.slice(0, limit);
	const tail = rows.slice(limit);
	const totals = tail.reduce<readonly number[]>(
		(sums, row) => sums.map((sum, index) => sum + (row.totals[index] ?? 0)),
		tail[0].totals.map(() => 0)
	);

	const latest = totals.length > 1 ? (totals.at(-1) ?? 0) : 0;
	const previous = totals.length > 1 ? (totals.at(-2) ?? 0) : 0;

	return [
		...head,
		{
			label: `Other (${tail.length})`,
			totals: totals.map(round),
			total: round(tail.reduce((sum, row) => sum + row.total, 0)),
			count: tail.reduce((sum, row) => sum + row.count, 0),
			change: round(latest - previous),
			changeShare: previous > 0 ? (latest - previous) / previous : null
		}
	];
}

/**
 * Every month's spending as a row of its own, so a table can foot the columns
 * without adding up what it is supposed to be rendering.
 *
 * Counted across every label, folded or not: the bottom line of a comparison is
 * what the months cost, and a top-eight would quietly under-report it.
 */
export function allSpending(comparison: MonthComparison): ComparisonRow {
	const totals = comparison.months.map((month) => month.total);

	return toRow(
		'All spending',
		new Map(totals.map((total, index) => [index, total])),
		comparison.rows.reduce((sum, row) => sum + row.count, 0),
		totals.length
	);
}

/** The heaviest single month any row reached — what the bars are drawn against. */
export function peakMonth(rows: readonly ComparisonRow[]): number {
	return Math.max(...rows.flatMap((row) => [...row.totals]), 0);
}
