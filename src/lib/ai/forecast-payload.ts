/**
 * What leaves the browser when the forecast page asks Claude how to get to
 * payday.
 *
 * The sibling of {@link buildAiPayload}, built to the same rule and for the same
 * reason: the one call in this app that sends anything is worth having a single
 * pure function behind it, so it can be tested, shown to the reader before they
 * press send, and checked in one place when the question is "what does Anthropic
 * actually see?".
 *
 * Where that one describes a period that has happened, this one describes a
 * month that has not finished: what is in the account, what is still expected to
 * land and on which day, and what each category usually takes over the days
 * left. That is the whole material for the question the page asks — how to get
 * through the month saving as much as possible — and nothing else is sent.
 *
 * Aggregates and named charges only. A charge's merchant and category are what
 * make it recognisable enough to act on; the bank's description is not, and it
 * carries card fragments, payment references and whoever was on the other end.
 * So descriptions, notes, counterparties, account names, account numbers and
 * times never reach this payload, and a test asserts they stay out.
 */

import { CALENDAR_START } from '../stats/cycle.ts';
import type { CategoryOutlook, Runway } from '../stats/runway.ts';
import type { ExpectedPayment, ForecastWindow } from '../stats/forecast.ts';
import { CURRENCY } from './payload.ts';

/**
 * How many expected payments to send.
 *
 * A month's named charges run to a few dozen at the outside, and every one of
 * them is a commitment the reader may be able to move — which is the point of
 * asking. Generous on purpose, and still bounded so a pathological statement
 * cannot inflate the request without limit.
 */
export const TOP_PAYMENTS = 40;

/** How many category rows to send. Past this the rows are rounding errors. */
export const TOP_OUTLOOK = 15;

/** One charge with a date on it, still to land before payday. */
export interface AiExpectedPayment {
	readonly merchant: string;
	readonly category: string;
	/** Positive magnitude. {@link flow} carries the direction. */
	readonly amount: number;
	readonly flow: 'income' | 'expense';
	/** `YYYY-MM-DD`, the day the line places it on. */
	readonly date: string;
	/** True when its usual day has passed and it has not arrived yet. */
	readonly overdue: boolean;
	/** A debit order cannot simply be skipped, which changes the advice. */
	readonly isDebitOrder: boolean;
	/** Complete past cycles it billed in — the evidence behind the figure. */
	readonly seen: number;
}

/** What one category still has to take before payday. */
export interface AiCategoryOutlook {
	readonly category: string;
	/** Positive. The named charges above, grouped. */
	readonly named: number;
	/** Positive. This category's share of the everyday spending. */
	readonly everyday: number;
	/** Positive. `named + everyday`. */
	readonly total: number;
}

/** Exactly what is sent to Anthropic for a runway read, and nothing else. */
export interface AiForecastPayload {
	readonly currency: string;
	readonly period: {
		/** The last date the statement covers — where the projection starts. */
		readonly from: string;
		/** The last day the money has to stretch over. */
		readonly to: string;
		/** The day the next month opens. */
		readonly payday: string;
		readonly daysLeft: number;
	};
	readonly balance: {
		/** What the account holds on `from` — banked, not projected. */
		readonly opening: number;
		/** What it is expected to hold the night before payday. */
		readonly closing: number;
		/** The thinnest point, or `null` where there is nothing left to project. */
		readonly lowest: { readonly date: string; readonly balance: number } | null;
		/** The first day it is expected to go under zero, or `null`. */
		readonly shortfallDate: string | null;
		/**
		 * True when `opening` is a net change rather than real money.
		 *
		 * The statement did not print running balances and the reader has not
		 * entered one, so every balance here is a shape: the line is right, the
		 * level is not. Sent rather than hidden, because a model told nothing
		 * would read a zero opening as an empty account and raise an alarm about
		 * money it cannot see.
		 */
		readonly isRelative: boolean;
	};
	readonly committed: {
		/** Positive. What the named charges take out before payday. */
		readonly out: number;
		/** Positive. What they are expected to bring in. */
		readonly in: number;
		/** Positive. Everything else the days left are expected to cost. */
		readonly everyday: number;
	};
	/**
	 * The day of the month the reader's months open on, when it is not the 1st.
	 *
	 * Left out at the 1st, where a month is what anyone would assume.
	 */
	readonly monthStartDay?: number;
	/** Complete past cycles the projection was learned from. */
	readonly monthsOfHistory: number;
	/** How many months back the everyday expectation was learned from. */
	readonly learnedFromMonths: ForecastWindow;
	/**
	 * False when the reader has narrowed the page to the named charges alone.
	 *
	 * The figures are then a different and narrower question, and a plan written
	 * as though they were the whole month would be advice about money the reader
	 * is not being shown.
	 */
	readonly everydayCounted: boolean;
	readonly payments: readonly AiExpectedPayment[];
	readonly byCategory: readonly AiCategoryOutlook[];
}

export interface ForecastPayloadOptions {
	/** Day of the month a month opens on — payday. */
	readonly monthStart?: number;
	/** True while the balance is a shape rather than real money. */
	readonly isRelative?: boolean;
	/** Whether the everyday channel is in the figures at all. */
	readonly everydayCounted?: boolean;
	/** How many months the projection was learned from. */
	readonly window: ForecastWindow;
}

/**
 * Reduce the runway on screen to the figures a reader would quote out loud.
 *
 * Takes the same {@link Runway} the line, the tiles and the lists are drawn
 * from, so what is on screen and what is asked about stay the same thing —
 * including the reader's own edits, since a charge they have ticked off is
 * already out of this runway before it gets here.
 */
export function buildForecastPayload(
	runway: Runway,
	options: ForecastPayloadOptions
): AiForecastPayload {
	const start = options.monthStart ?? CALENDAR_START;

	return {
		currency: CURRENCY,
		period: {
			from: runway.from,
			to: runway.to,
			payday: runway.payday,
			daysLeft: runway.daysLeft
		},
		balance: {
			opening: runway.opening,
			closing: runway.closing,
			lowest:
				runway.lowest === null
					? null
					: { date: runway.lowest.date, balance: runway.lowest.balance },
			shortfallDate: runway.shortfall?.date ?? null,
			isRelative: options.isRelative ?? false
		},
		committed: {
			out: runway.committedOut,
			in: runway.committedIn,
			everyday: runway.everyday
		},
		...(start === CALENDAR_START ? {} : { monthStartDay: start }),
		monthsOfHistory: runway.monthsOfHistory,
		learnedFromMonths: options.window,
		everydayCounted: options.everydayCounted ?? true,
		payments: runway.payments.slice(0, TOP_PAYMENTS).map(toAiPayment),
		byCategory: runway.byCategory.slice(0, TOP_OUTLOOK).map(toAiOutlook)
	};
}

/** Eight fields, chosen one at a time — never the whole charge. */
function toAiPayment(payment: ExpectedPayment): AiExpectedPayment {
	return {
		merchant: payment.merchant,
		category: payment.category,
		amount: payment.amount,
		flow: payment.flow,
		date: payment.date,
		overdue: payment.overdue,
		isDebitOrder: payment.isDebitOrder,
		seen: payment.seen
	};
}

/** The share is left off: it is derivable from the totals, and costs tokens. */
function toAiOutlook(row: CategoryOutlook): AiCategoryOutlook {
	return {
		category: row.category,
		named: row.named,
		everyday: row.everyday,
		total: row.total
	};
}
