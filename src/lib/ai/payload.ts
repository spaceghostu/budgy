/**
 * The one thing in this app that leaves the browser.
 *
 * Everything else is parsed and computed on this device and sent nowhere. Asking
 * Claude to read the numbers is the exception, so what gets sent is built here
 * as a pure function rather than assembled at the call site: it can be tested,
 * it can be shown to the reader before they send it, and there is a single
 * place to check when the question is "what does Anthropic actually see?".
 *
 * Aggregates only. Category and merchant totals say where the money went; the
 * bank's description does not add to that and carries card fragments, payment
 * references and whoever was on the other end. So descriptions, notes,
 * counterparties, account names, account numbers and times are all dropped, and
 * a test asserts they stay dropped.
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
 */
export function buildAiPayload(insights: Insights, start: number = CALENDAR_START): AiPayload {
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
		largestExpenses: insights.largestExpenses.map(toAiExpense)
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
