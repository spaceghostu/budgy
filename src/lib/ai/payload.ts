/**
 * The one thing in this app that leaves the browser.
 *
 * Everything else is parsed and computed on this device and sent nowhere. Asking
 * Claude to read the numbers is the exception, so what gets sent is built here
 * as a pure function rather than assembled at the call site: it can be tested,
 * it can be shown to the reader before they send it, and there is a single
 * place to check when the question is "what does Anthropic actually see?".
 *
 * Aggregates by default. Category and merchant totals say where the money went;
 * the bank's description does not add to that and carries card fragments,
 * payment references and whoever was on the other end. So unless the reader asks
 * for more, descriptions, notes, counterparties, account names, account numbers
 * and times are all dropped, and a test asserts they stay dropped.
 *
 * The reader can ask for more: every line in the period, in full, so Claude can
 * answer what a rollup cannot — which payment that was, what one merchant's
 * lines came to. That is opt-in, off by default and never remembered, and it is
 * still decided here, so the answer to "what is sent?" stays in this one file.
 */

import { groupFlowByMonth, round } from '../stats/balance.ts';
import { CALENDAR_START, cycleOf } from '../stats/cycle.ts';
import type { Bucket, Insights, RecurringCharge, Transaction } from '../types.ts';

/**
 * How many categories and merchants to send.
 *
 * Past the top dozen the totals are rounding errors on the period, and a long
 * tail costs tokens to say nothing.
 */
export const TOP_BUCKETS = 12;

/** How many recurring charges to send. Commitments are the point, so this is generous. */
export const TOP_RECURRING = 25;

/** ISO 4217. Discovery Bank statements are in rand; the app is written for them. */
export const CURRENCY = 'ZAR';

export interface AiBucket {
	readonly label: string;
	/** Positive magnitude. */
	readonly total: number;
	readonly count: number;
	/** Fraction of the period's spending, 0–1, to three places. */
	readonly share: number;
}

export interface AiRecurring {
	readonly merchant: string;
	readonly category: string;
	/** Positive. What it takes in a typical billing month. */
	readonly monthlyAmount: number;
	/** How many distinct months it has billed in. */
	readonly months: number;
	readonly isDebitOrder: boolean;
}

export interface AiMonth {
	/** `YYYY-MM`. */
	readonly month: string;
	/** Positive. */
	readonly income: number;
	/** Positive. */
	readonly expense: number;
	/** `income - expense`. */
	readonly net: number;
}

export interface AiExpense {
	readonly date: string;
	readonly merchant: string;
	readonly category: string;
	/** Positive magnitude. */
	readonly amount: number;
}

/** Exactly what is sent to Anthropic, and nothing else. */
export interface AiPayload {
	readonly currency: string;
	readonly period: { readonly from: string; readonly to: string; readonly days: number };
	readonly balance: {
		readonly opening: number;
		readonly closing: number;
		/** Days at the current burn rate, or `null` when not burning. */
		readonly runwayDays: number | null;
	};
	readonly totals: {
		readonly income: number;
		readonly expense: number;
		readonly net: number;
		readonly fees: number;
		readonly declinedFees: number;
		readonly declinedCount: number;
		readonly transactionCount: number;
	};
	readonly spendPerDay: { readonly mean: number; readonly median: number };
	/**
	 * The day of the month the reader's months open on, when it is not the 1st.
	 *
	 * Left out at the 1st, where a month is what anyone would assume. Present, it
	 * says that "2026-08" in `months` is the reader's August — 25 July to 24
	 * August for a start of the 25th — so the model's wording matches the charts.
	 */
	readonly monthStartDay?: number;
	readonly months: readonly AiMonth[];
	readonly categories: readonly AiBucket[];
	readonly merchants: readonly AiBucket[];
	readonly recurring: readonly AiRecurring[];
	readonly largestExpenses: readonly AiExpense[];
	/**
	 * Every line in the period, oldest first. Present only when the reader asked
	 * for the full data — see {@link buildAiPayload}.
	 */
	readonly transactions?: readonly AiTransaction[];
}

/**
 * One line of the statement, as the bank gave it.
 *
 * Everything the reader can see about the row, and none of this app's own
 * bookkeeping: the id, file order, timestamp and source say nothing about the
 * money, and `flow` is the sign of `amount` again. A field the bank left blank
 * is left out rather than sent empty — across a few thousand lines that is most
 * of the cost of sending them, and an empty string tells the model nothing.
 */
export interface AiTransaction {
	readonly date: string;
	/** `HH:MM:SS`. */
	readonly time?: string;
	readonly account?: string;
	readonly accountNumber?: string;
	/** The bank's transaction type, e.g. `Debit order`. */
	readonly type?: string;
	readonly description?: string;
	readonly counterparty?: string;
	readonly merchant?: string;
	readonly category?: string;
	readonly bankCategory?: string;
	readonly note?: string;
	/** Signed. Negative is money leaving the account. */
	readonly amount: number;
	/** The balance the bank printed beside the row. */
	readonly balance?: number;
	readonly isFee: boolean;
	readonly isDeclined: boolean;
}

/**
 * Reduce the dashboard to the figures a reader would quote out loud.
 *
 * Takes the same {@link Insights} every card on the page renders, so the model
 * is shown the period currently filtered rather than the whole file — what is
 * on screen and what is asked about stay the same thing.
 *
 * @param start Day of the month a month opens on. The model is told what the
 * reader's months are, so an answer about "August" means the same span of days
 * the charts drew for August.
 * @param transactions The lines {@link insights} was built from, to send in full.
 * Left out, nothing but aggregates is sent. Passed by the caller rather than
 * read off `insights`, which holds only the biggest few, so that sending them is
 * something a call site has to ask for in so many words.
 */
export function buildAiPayload(
	insights: Insights,
	start: number = CALENDAR_START,
	transactions?: readonly Transaction[]
): AiPayload {
	const { summary } = insights;

	return {
		currency: CURRENCY,
		period: { from: summary.from, to: summary.to, days: summary.days },
		balance: {
			opening: summary.openingBalance,
			closing: summary.closingBalance,
			runwayDays: summary.runwayDays
		},
		totals: {
			income: summary.income,
			expense: summary.expense,
			net: summary.net,
			fees: summary.fees,
			declinedFees: summary.declinedFees,
			declinedCount: summary.declinedCount,
			transactionCount: summary.transactionCount
		},
		spendPerDay: { mean: summary.meanDailySpend, median: summary.medianDailySpend },
		...(start === CALENDAR_START ? {} : { monthStartDay: start }),
		months: groupFlowByMonth(insights.dailyFlow, start).map((month) => ({
			month: cycleOf(month.date, start),
			income: month.income,
			expense: month.expense,
			net: month.net
		})),
		categories: insights.categories.slice(0, TOP_BUCKETS).map(toAiBucket),
		merchants: insights.merchants.slice(0, TOP_BUCKETS).map(toAiBucket),
		recurring: insights.recurring.slice(0, TOP_RECURRING).map(toAiRecurring),
		largestExpenses: insights.largestExpenses.map(toAiExpense),
		...(transactions === undefined ? {} : { transactions: toAiTransactions(transactions) })
	};
}

function toAiBucket(bucket: Bucket): AiBucket {
	return {
		label: bucket.label,
		total: bucket.total,
		count: bucket.count,
		// Three places is a tenth of a percent — past that it is float noise.
		share: Math.round(bucket.share * 1000) / 1000
	};
}

/**
 * The median, not the latest: a lender that collected two instalments in one
 * month would otherwise be reported as having doubled its price.
 */
function toAiRecurring(charge: RecurringCharge): AiRecurring {
	return {
		merchant: charge.merchant,
		category: charge.category,
		monthlyAmount: charge.medianAmount,
		months: charge.months.length,
		isDebitOrder: charge.isDebitOrder
	};
}

/** Four fields, chosen one at a time — never the whole transaction. */
function toAiExpense(transaction: Transaction): AiExpense {
	return {
		date: transaction.date,
		merchant: transaction.merchant,
		category: transaction.category,
		amount: round(Math.abs(transaction.amount))
	};
}

/** Oldest first, ties in file order — the order the statement itself reads in. */
function toAiTransactions(transactions: readonly Transaction[]): readonly AiTransaction[] {
	return [...transactions]
		.sort((a, b) => a.timestamp - b.timestamp || a.fileOrder - b.fileOrder)
		.map(toAiTransaction);
}

/** Every field the reader can see on the row, chosen by name like the four above. */
function toAiTransaction(transaction: Transaction): AiTransaction {
	return {
		date: transaction.date,
		...present('time', transaction.time),
		...present('account', transaction.account),
		...present('accountNumber', transaction.accountNumber),
		...present('type', transaction.type),
		...present('description', transaction.description),
		...present('counterparty', transaction.counterparty),
		...present('merchant', transaction.merchant),
		...present('category', transaction.category),
		...present('bankCategory', transaction.bankCategory),
		...present('note', transaction.note),
		amount: round(transaction.amount),
		...(transaction.balance === null ? {} : { balance: round(transaction.balance) }),
		isFee: transaction.isFee,
		isDeclined: transaction.isDeclined
	};
}

/** `{ [key]: value }`, or nothing at all where the bank left the field blank. */
function present<K extends string>(key: K, value: string): Partial<Record<K, string>> {
	const trimmed = value.trim();
	return trimmed === '' ? {} : ({ [key]: trimmed } as Record<K, string>);
}
