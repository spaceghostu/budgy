import type {
	BalancePoint,
	Bucket,
	DailyFlow,
	Insights,
	PeriodSummary,
	RecurringCharge,
	Transaction
} from '../types.ts';
import {
	buildBalanceSeries,
	buildDailyFlow,
	daysCovered,
	groupFlowByMonth,
	round,
	sumAmounts
} from './balance.ts';
import { mean, median } from './average.ts';
import { CALENDAR_START, cycleOf } from './cycle.ts';
import { normaliseType } from '../parse/normalise.ts';

/** Above this many days, the flow chart buckets by month instead. */
const MAX_DAILY_BARS = 92;

/** How many entries the "biggest hits" list shows. */
export const LARGEST_EXPENSE_COUNT = 8;

/** A card charge must appear in at least this many distinct months. */
const RECURRING_MIN_MONTHS = 2;

/**
 * …and span at least this many days. Two months apart can mean 31 July and 1
 * August, which is a pair of grocery runs, not a subscription.
 */
const RECURRING_MIN_SPAN_DAYS = 25;

/**
 * …and bill roughly the same amount each time. A subscription is a fixed
 * price; a supermarket is not.
 */
const RECURRING_MAX_VARIATION = 1.15;

const MS_PER_DAY = 86_400_000;

export interface Filters {
	/** `null` means every account in the file. */
	readonly account: string | null;
	/** Inclusive ISO date bounds. `null` means unbounded. */
	readonly from: string | null;
	readonly to: string | null;
}

export const NO_FILTERS: Filters = { account: null, from: null, to: null };

export function filterTransactions(
	transactions: readonly Transaction[],
	filters: Filters
): readonly Transaction[] {
	return transactions.filter(
		(transaction) =>
			(filters.account === null || transaction.account === filters.account) &&
			(filters.from === null || transaction.date >= filters.from) &&
			(filters.to === null || transaction.date <= filters.to)
	);
}

/**
 * Re-anchor the balance for a filtered slice.
 *
 * The user supplies one number — their balance today, after the most recent
 * transaction in `all`. Narrowing the date range moves the slice's own closing
 * balance back in time, so the transactions that happened *after* the slice
 * have to be unwound from the anchor.
 *
 * @param all Every transaction for the account, oldest first.
 * @param slice A contiguous date-range subset of `all`.
 * @param anchor Balance after the last transaction in `all`.
 */
export function anchorForSlice(
	all: readonly Transaction[],
	slice: readonly Transaction[],
	anchor: number
): number {
	const last = slice.at(-1);
	if (last === undefined) return anchor;

	const index = all.findIndex((transaction) => transaction.id === last.id);
	if (index < 0) return anchor;

	return round(anchor - sumAmounts(all.slice(index + 1)));
}

/**
 * Everything the dashboard renders, derived in one pass so every number on
 * screen describes the same slice of the statement.
 *
 * @param transactions Oldest first, already filtered.
 * @param closingBalance Balance after the most recent transaction. See
 * {@link buildBalanceSeries} for why this anchor is needed.
 * @param start Day of the month a month opens on. See {@link cycleOf}.
 */
export function buildInsights(
	transactions: readonly Transaction[],
	closingBalance: number,
	start: number = CALENDAR_START
): Insights {
	const balanceSeries = buildBalanceSeries(transactions, closingBalance);
	const dailyFlow = buildDailyFlow(transactions, balanceSeries);
	const expenses = transactions.filter((transaction) => transaction.flow === 'expense');

	// Past a quarter a bar per day is unreadable; months carry the same story.
	const flowIsMonthly = daysCovered(transactions) > MAX_DAILY_BARS;

	return {
		summary: buildSummary(transactions, dailyFlow, balanceSeries),
		balanceSeries,
		dailyFlow,
		flow: flowIsMonthly ? groupFlowByMonth(dailyFlow, start) : dailyFlow,
		flowIsMonthly,
		categories: bucketBy(expenses, (transaction) => transaction.category),
		merchants: bucketBy(expenses, (transaction) => transaction.merchant),
		recurring: findRecurring(expenses, start),
		largestExpenses: [...expenses]
			.sort((a, b) => a.amount - b.amount)
			.slice(0, LARGEST_EXPENSE_COUNT)
	};
}

function buildSummary(
	transactions: readonly Transaction[],
	dailyFlow: readonly DailyFlow[],
	balanceSeries: readonly BalancePoint[]
): PeriodSummary {
	const days = daysCovered(transactions);
	const balanceChange = sumAmounts(transactions);

	// Read the balances off the series, so it makes no difference whether they
	// were printed by the bank or unwound from an anchor.
	const closingBalance = balanceSeries.at(-1)?.balance ?? 0;
	const openingBalance = balanceSeries.at(0)?.balance ?? 0;
	const income = round(total(transactions, (t) => (t.flow === 'income' ? t.amount : 0)));
	const expense = round(total(transactions, (t) => (t.flow === 'expense' ? -t.amount : 0)));
	const fees = round(total(transactions, (t) => (t.isFee ? -Math.min(t.amount, 0) : 0)));
	const declinedFees = round(
		total(transactions, (t) => (t.isFee && t.isDeclined ? -Math.min(t.amount, 0) : 0))
	);

	const meanDailySpend = days > 0 ? round(expense / days) : 0;
	const dailyNetBurn = days > 0 ? (expense - income) / days : 0;

	return {
		from: transactions.at(0)?.date ?? '',
		to: transactions.at(-1)?.date ?? '',
		days,
		openingBalance: round(openingBalance),
		closingBalance: round(closingBalance),
		income,
		expense,
		net: round(income - expense),
		balanceChange,
		fees,
		declinedFees,
		declinedCount: transactions.filter((t) => t.isDeclined).length,
		transactionCount: transactions.filter((t) => t.flow !== 'noop').length,
		meanDailySpend,
		medianDailySpend: median(dailySpendPerDay(dailyFlow, days)),
		runwayDays:
			dailyNetBurn > 0 && closingBalance > 0 ? Math.floor(closingBalance / dailyNetBurn) : null,
		busiestSpendDay: pickBusiestSpendDay(dailyFlow),
		largestExpense: pickExtreme(transactions, 'expense', (a, b) => a.amount - b.amount),
		largestIncome: pickExtreme(transactions, 'income', (a, b) => b.amount - a.amount)
	};
}

/**
 * Every day in the period's spending, the quiet ones included.
 *
 * `dailyFlow` only carries a row for days something happened, but the mean
 * divides by every day in the period. The median has to count the same days, or
 * the two numbers sitting beside each other would be describing two different
 * periods — one where nothing was spent on a Sunday, and one without Sundays.
 */
function dailySpendPerDay(dailyFlow: readonly DailyFlow[], days: number): readonly number[] {
	const quietDays = Math.max(days - dailyFlow.length, 0);

	return [...dailyFlow.map((day) => day.expense), ...Array.from({ length: quietDays }, () => 0)];
}

/**
 * Roll transactions up by some label, biggest first.
 *
 * Amounts arrive negative (money out) and leave positive — a bar chart plots
 * magnitudes, and "R2,046 on health" reads better than "R-2,046".
 */
export function bucketBy(
	transactions: readonly Transaction[],
	label: (transaction: Transaction) => string
): readonly Bucket[] {
	const totals = new Map<string, { total: number; count: number }>();
	for (const transaction of transactions) {
		const key = label(transaction) || 'Uncategorised';
		const bucket = totals.get(key) ?? { total: 0, count: 0 };
		totals.set(key, {
			total: bucket.total + Math.abs(transaction.amount),
			count: bucket.count + 1
		});
	}

	const grandTotal = [...totals.values()].reduce((sum, bucket) => sum + bucket.total, 0);

	return [...totals.entries()]
		.map(([bucketLabel, bucket]) => ({
			label: bucketLabel,
			total: round(bucket.total),
			count: bucket.count,
			share: grandTotal > 0 ? bucket.total / grandTotal : 0
		}))
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * Find charges that repeat.
 *
 * Two signals, deliberately conservative:
 *
 * - The bank's own `Debit order` type. That is a standing mandate, so one
 *   occurrence is already evidence of a commitment.
 * - A card merchant billing a steady amount, in separate months, roughly a
 *   month apart. All three conditions matter: without the span test a grocery
 *   run on 31 July and another on 1 August looks monthly, and without the
 *   amount test a supermarket looks like a subscription.
 *
 * Bank fees are excluded — they recur, but they are already reported on their
 * own and are not a commitment the reader can cancel.
 *
 * A short statement therefore surfaces only the debit orders. Two weeks of
 * data cannot evidence a monthly pattern, and saying so beats guessing.
 */
export function findRecurring(
	expenses: readonly Transaction[],
	start: number = CALENDAR_START
): readonly RecurringCharge[] {
	const groups = new Map<string, Transaction[]>();
	for (const transaction of expenses) {
		if (transaction.isFee) continue;
		groups.set(transaction.merchant, [...(groups.get(transaction.merchant) ?? []), transaction]);
	}

	return [...groups.entries()]
		.map(([merchant, charges]) => toRecurringCharge(merchant, charges, start))
		.filter((charge) => charge.isDebitOrder || looksLikeSubscription(charge))
		.map(toPublicCharge)
		.sort((a, b) => b.latestAmount - a.latestAmount);
}

/** Drop the scoring fields — they are how a charge qualified, not what it is. */
function toPublicCharge(charge: ScoredCharge): RecurringCharge {
	return {
		merchant: charge.merchant,
		category: charge.category,
		latestAmount: charge.latestAmount,
		meanAmount: charge.meanAmount,
		medianAmount: charge.medianAmount,
		count: charge.count,
		months: charge.months,
		lastSeen: charge.lastSeen,
		isDebitOrder: charge.isDebitOrder
	};
}

function looksLikeSubscription(charge: ScoredCharge): boolean {
	if (charge.months.length < RECURRING_MIN_MONTHS) return false;
	if (charge.spanDays < RECURRING_MIN_SPAN_DAYS) return false;
	if (charge.leanestMonth <= 0) return false;

	// Compare the extremes, not the latest against the mean: a merchant that
	// swung 775 / 158 / 486 averages out to something the latest charge sits
	// close to, and would otherwise slip through as a fixed monthly price.
	return charge.fattestMonth / charge.leanestMonth <= RECURRING_MAX_VARIATION;
}

type ScoredCharge = RecurringCharge & {
	readonly spanDays: number;
	readonly leanestMonth: number;
	readonly fattestMonth: number;
};

function toRecurringCharge(
	merchant: string,
	charges: readonly Transaction[],
	start: number
): ScoredCharge {
	const latest = charges.reduce((newest, charge) =>
		charge.timestamp >= newest.timestamp ? charge : newest
	);
	const earliest = charges.reduce((oldest, charge) =>
		charge.timestamp <= oldest.timestamp ? charge : oldest
	);

	// A commitment costs what it takes per billing month, not per line: a
	// lender collecting two instalments on one day is one monthly outgoing.
	const byMonth = new Map<string, number>();
	for (const charge of charges) {
		const month = cycleOf(charge.date, start);
		byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(charge.amount));
	}

	const months = [...byMonth.keys()].sort();
	const monthlyTotals = [...byMonth.values()];

	return {
		merchant,
		category: latest.category,
		latestAmount: round(byMonth.get(months[months.length - 1]) ?? 0),
		meanAmount: mean(monthlyTotals),
		medianAmount: median(monthlyTotals),
		count: charges.length,
		months,
		lastSeen: latest.date,
		isDebitOrder: charges.every((charge) => normaliseType(charge.type) === 'debit order'),
		spanDays: Math.round((latest.timestamp - earliest.timestamp) / MS_PER_DAY),
		leanestMonth: Math.min(...monthlyTotals),
		fattestMonth: Math.max(...monthlyTotals)
	};
}

function pickBusiestSpendDay(dailyFlow: readonly DailyFlow[]): DailyFlow | null {
	const spending = dailyFlow.filter((day) => day.expense > 0);
	if (spending.length === 0) return null;

	return spending.reduce((busiest, day) => (day.expense > busiest.expense ? day : busiest));
}

function pickExtreme(
	transactions: readonly Transaction[],
	flow: 'income' | 'expense',
	compare: (a: Transaction, b: Transaction) => number
): Transaction | null {
	const candidates = transactions.filter((transaction) => transaction.flow === flow);
	if (candidates.length === 0) return null;

	return [...candidates].sort(compare)[0];
}

function total(
	transactions: readonly Transaction[],
	value: (transaction: Transaction) => number
): number {
	return transactions.reduce((sum, transaction) => sum + value(transaction), 0);
}
