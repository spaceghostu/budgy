/**
 * What the app keeps of a credit report.
 *
 * A bureau report is the most personal document this app will ever be handed:
 * an identity number, a name, addresses, employers, and the full number of
 * every account. None of that is needed to answer what the app is asked — what
 * is owed, to whom, and what it takes each month — so none of it is modelled
 * here. These types are the whole of what survives reading a report, and the
 * only shape that is ever stored.
 */

/** What kind of borrowing an account is. `other` where the bureau does not say. */
export type CreditKind = 'loan' | 'card' | 'revolving' | 'store' | 'other';

export type CreditStatus = 'current' | 'arrears' | 'closed' | 'unknown';

/** One account on the report, reduced to the figures a plan is made of. */
export interface CreditAccount {
	/**
	 * Stable identity on this device. See {@link creditAccountId}.
	 *
	 * A hash rather than the account number, so the reader's own settings can be
	 * kept against an account without the number being kept at all.
	 */
	readonly id: string;
	/** The lender, as the bureau names it. */
	readonly creditor: string;
	readonly kind: CreditKind;
	/** Positive. What is owed on the report date. */
	readonly balance: number;
	/** Positive. The monthly instalment, or 0 where the bureau gives none. */
	readonly instalment: number;
	/** Positive. What is overdue, or 0 when the account is up to date. */
	readonly arrears: number;
	readonly status: CreditStatus;
	/** `YYYY-MM-DD`, or blank where the bureau does not say. */
	readonly opened: string;
	/** The limit on a card or a facility, where there is one. */
	readonly limit: number | null;
}

/** One reading of the bureau, on one day. */
export interface CreditReport {
	/** `YYYY-MM-DD` the figures describe — a bureau runs a month or two behind. */
	readonly reportDate: string;
	readonly score: number | null;
	readonly accounts: readonly CreditAccount[];
}
