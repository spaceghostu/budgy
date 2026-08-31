/**
 * Domain types for parsed bank statements.
 *
 * Everything here is immutable — parsing and statistics always return fresh
 * objects rather than mutating their inputs.
 */

/** How a transaction should be treated by the spending statistics. */
export type Flow = 'income' | 'expense' | 'transfer' | 'noop';

/**
 * Which side of the money a month's running total adds up.
 *
 * `net` is money in less money out and can fall as well as rise; `out` and `in`
 * accumulate one side only, as positive magnitudes, so the line climbs.
 */
export type MonthMetric = 'net' | 'out' | 'in';

/**
 * Where a transaction's facts came from.
 *
 * The two exports know different things: the PDF carries the running balance
 * and every account, the CSV carries the bank's own filing and the time of day.
 * `both` means the row was matched across the two and has everything.
 */
export type Source = 'pdf' | 'csv' | 'both';

/** A single statement line, normalised from whatever the bank exported. */
export interface Transaction {
	/** Stable identity, derived from the row's position in the source file. */
	readonly id: string;
	/** ISO date, `YYYY-MM-DD`. */
	readonly date: string;
	/** 24h clock time, `HH:MM:SS`. Empty when the export omits it. */
	readonly time: string;
	/** Milliseconds since epoch, in the viewer's timezone. */
	readonly timestamp: number;
	readonly account: string;
	/** Account number, when the source gave one. Empty for CSV-only rows. */
	readonly accountNumber: string;
	/** Bank's transaction type, e.g. `Debit order`. Empty for PDF-only rows. */
	readonly type: string;
	readonly description: string;
	readonly counterparty: string;
	/** Signed, in account currency. Negative is money leaving the account. */
	readonly amount: number;
	/**
	 * What this app files the transaction under: the bank's **sub**-category,
	 * `Groceries` or `Fuel` or `Coffee`.
	 *
	 * The bank's broad headings are a dozen buckets nobody can act on — groceries,
	 * restaurants and coffee are one "Food and Drink" — so the finer label is the
	 * one every breakdown, list and export in this app means by "category".
	 */
	readonly category: string;
	/**
	 * The heading the bank itself files that category under, `Food and Drink`.
	 *
	 * Kept because it, and not {@link category}, is what says a row is an
	 * own-account transfer or a bank charge: those live at the bank's own level as
	 * `Not for Financial Analyser` and `Fees and Interest`. Nothing on screen rolls
	 * up by it.
	 */
	readonly bankCategory: string;
	readonly note: string;
	/** Cleaned-up merchant name derived from the description. */
	readonly merchant: string;
	readonly flow: Flow;
	/** Bank fee, interest or charge. */
	readonly isFee: boolean;
	/** A declined attempt, or the fee charged for one. */
	readonly isDeclined: boolean;
	/**
	 * The balance the bank printed beside this row, when a PDF supplied it.
	 * `null` means the balance has to be inferred from a user-entered anchor.
	 */
	readonly balance: number | null;
	readonly source: Source;
	/** Position in the source file, used to break ties on identical timestamps. */
	readonly fileOrder: number;
}

/** A problem found while reading one row — surfaced rather than swallowed. */
export interface ParseIssue {
	/** 1-based line number in the source file, counting the header. */
	readonly line: number;
	readonly reason: string;
}

export interface ParseResult {
	readonly transactions: readonly Transaction[];
	readonly issues: readonly ParseIssue[];
	/** Distinct account nicknames present in the file, in first-seen order. */
	readonly accounts: readonly string[];
}

/** One point on the running-balance line. */
export interface BalancePoint {
	readonly timestamp: number;
	/** Account balance immediately after `transaction` cleared. */
	readonly balance: number;
	/** `null` on the synthetic opening point that starts the series. */
	readonly transaction: Transaction | null;
}

export interface DailyFlow {
	readonly date: string;
	readonly timestamp: number;
	/** Positive. */
	readonly income: number;
	/** Positive — the magnitude of the day's spending. */
	readonly expense: number;
	/** `income - expense`. */
	readonly net: number;
	/** Balance at the end of this day. */
	readonly closingBalance: number;
}

/** One day on a month's running-total line. */
export interface MonthPoint {
	/** Day of the month, 1-based. */
	readonly day: number;
	/** Running total from the first of the month to the end of this day. */
	readonly total: number;
}

/** One month's running total, as its own line indexed by day of the month. */
export interface MonthSeries {
	/** `YYYY-MM`. */
	readonly month: string;
	/** One point per day, from the 1st to the last day the month is known for. */
	readonly points: readonly MonthPoint[];
	/** The running total on the last of those days. */
	readonly total: number;
	/**
	 * True when the statement may not cover the whole calendar month: the newest
	 * month, which has not finished, or an oldest month whose first row is not on
	 * the 1st — which cannot be told apart from a quiet first of the month, so
	 * anything shown for it says "may".
	 */
	readonly isPartial: boolean;
}

/** A category or merchant rolled up into a total. */
export interface Bucket {
	readonly label: string;
	/** Positive magnitude. */
	readonly total: number;
	readonly count: number;
	readonly share: number;
}

export interface RecurringCharge {
	readonly merchant: string;
	readonly category: string;
	/**
	 * Positive. What the merchant took in the most recent month it billed —
	 * the total, not one line, since a lender can take two instalments at once.
	 */
	readonly latestAmount: number;
	/** Positive. The monthly total, meaned across the months it appeared in. */
	readonly meanAmount: number;
	/**
	 * Positive. The middle monthly total — what the charge usually takes, where
	 * {@link meanAmount} is what it took on average. A lender that doubled up
	 * once separates the two.
	 */
	readonly medianAmount: number;
	readonly count: number;
	/** Distinct `YYYY-MM` months the charge appeared in. */
	readonly months: readonly string[];
	readonly lastSeen: string;
	/** True when every occurrence is the bank's own `Debit order` type. */
	readonly isDebitOrder: boolean;
}

export interface PeriodSummary {
	readonly from: string;
	readonly to: string;
	readonly days: number;
	readonly openingBalance: number;
	readonly closingBalance: number;
	/** Positive. Excludes transfers. */
	readonly income: number;
	/** Positive. Excludes transfers. */
	readonly expense: number;
	/** `income - expense`. */
	readonly net: number;
	/** Signed change in balance, transfers included. */
	readonly balanceChange: number;
	readonly fees: number;
	readonly declinedFees: number;
	readonly declinedCount: number;
	readonly transactionCount: number;
	/** `expense / days`, so the days nothing was spent count too. */
	readonly meanDailySpend: number;
	/**
	 * What the middle day cost, over those same days — quiet ones included, so
	 * this and {@link meanDailySpend} describe the same period rather than two
	 * different ones.
	 */
	readonly medianDailySpend: number;
	/** Days of runway at the current burn rate, or `null` when not burning. */
	readonly runwayDays: number | null;
	readonly busiestSpendDay: DailyFlow | null;
	readonly largestExpense: Transaction | null;
	readonly largestIncome: Transaction | null;
}

export interface Insights {
	readonly summary: PeriodSummary;
	readonly balanceSeries: readonly BalancePoint[];
	/** Per-day flow — the resolution the summary statistics are computed at. */
	readonly dailyFlow: readonly DailyFlow[];
	/** The same flow at the resolution the chart can actually show. */
	readonly flow: readonly DailyFlow[];
	/** True when `flow` is bucketed by month rather than by day. */
	readonly flowIsMonthly: boolean;
	readonly categories: readonly Bucket[];
	readonly merchants: readonly Bucket[];
	readonly recurring: readonly RecurringCharge[];
	readonly largestExpenses: readonly Transaction[];
}

/** What a month-against-month comparison rolls spending up by. */
export type CompareDimension = 'category' | 'merchant';

/** One category or merchant, across the months being compared. */
export interface ComparisonRow {
	readonly label: string;
	/**
	 * One total per month in {@link MonthComparison.months}, in the same order.
	 * Positive magnitudes, and `0` for a month the label never appeared in — a
	 * gap would read as unknown where the truth is that nothing was spent.
	 */
	readonly totals: readonly number[];
	/** Positive. Everything the label took across all of those months. */
	readonly total: number;
	readonly count: number;
	/**
	 * The newest compared month's total less the month before it — signed, so a
	 * negative change is money no longer going here.
	 *
	 * The last two rather than the first and last: with six months on screen the
	 * question a reader is asking is what moved *this* month, and the whole run
	 * is already in front of them to read the longer drift off.
	 */
	readonly change: number;
	/**
	 * {@link change} as a fraction of the month before, or `null` when that month
	 * was zero — spending that started from nothing has no percentage to grow by.
	 */
	readonly changeShare: number | null;
}

/** One month's column in a comparison. */
export interface ComparisonMonth {
	/** `YYYY-MM`. */
	readonly month: string;
	/** Positive. Everything spent in the month, across every label. */
	readonly total: number;
	/**
	 * True when the statement may not cover the whole month, as
	 * {@link MonthSeries.isPartial} means it — and it matters more here, because
	 * a month the export stops half-way into looks like a month of thrift beside
	 * a whole one.
	 */
	readonly isPartial: boolean;
}

/** Spending by category or merchant, month against month. */
export interface MonthComparison {
	readonly dimension: CompareDimension;
	/** Oldest first, one per month compared. */
	readonly months: readonly ComparisonMonth[];
	/** Heaviest first, across every month compared. */
	readonly rows: readonly ComparisonRow[];
}
