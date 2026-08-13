import type { BalancePoint, DailyFlow, Transaction } from '../types.ts';

const MS_PER_DAY = 86_400_000;

/**
 * Build the running-balance line.
 *
 * There are two ways to know a balance, and the good one is preferred:
 *
 * - A certified PDF statement prints the balance beside every row. When those
 *   are present they are used as-is — they are the bank's own record.
 * - A CSV export lists amounts and no balances at all, so the series has to be
 *   anchored: `closingBalance` is the balance *after* the most recent
 *   transaction, and every earlier point is derived by unwinding from there.
 *   With the default anchor of `0` the shape is identical and the line reads as
 *   net change rather than an absolute balance.
 *
 * @param transactions Oldest first.
 */
export function buildBalanceSeries(
	transactions: readonly Transaction[],
	closingBalance: number
): readonly BalancePoint[] {
	if (transactions.length === 0) return [];
	if (hasPrintedBalances(transactions) && isOneAccount(transactions)) {
		return fromPrintedBalances(transactions);
	}

	const opening = closingBalance - sumAmounts(transactions);

	// A synthetic opening point so the line starts at the balance the period
	// began with, rather than at the balance after the first transaction.
	const start: BalancePoint = {
		timestamp: transactions[0].timestamp,
		balance: round(opening),
		transaction: null
	};

	let running = opening;
	const points = transactions.map((transaction) => {
		running += transaction.amount;
		return { timestamp: transaction.timestamp, balance: round(running), transaction };
	});

	return [start, ...points];
}

/**
 * True when the bank printed a balance on every row, which a certified PDF
 * statement does and a CSV export never does.
 *
 * It has to be every row: one missing balance would leave a hole in the line,
 * and a partial series is worse than a consistently derived one.
 */
export function hasPrintedBalances(transactions: readonly Transaction[]): boolean {
	return (
		transactions.length > 0 && transactions.every((transaction) => transaction.balance !== null)
	);
}

/**
 * A printed balance belongs to one account. Chaining several accounts' balances
 * into a single line would draw a number that was never true of any of them.
 */
function isOneAccount(transactions: readonly Transaction[]): boolean {
	const [first] = transactions;
	return transactions.every((transaction) => transaction.account === first.account);
}

function fromPrintedBalances(transactions: readonly Transaction[]): readonly BalancePoint[] {
	const first = transactions[0];

	// The balance before the first transaction, so the line starts where the
	// period did rather than after its first movement.
	const start: BalancePoint = {
		timestamp: first.timestamp,
		balance: round((first.balance ?? 0) - first.amount),
		transaction: null
	};

	return [
		start,
		...transactions.map((transaction) => ({
			timestamp: transaction.timestamp,
			balance: transaction.balance ?? 0,
			transaction
		}))
	];
}

/**
 * Roll the period up into per-day money in, money out and closing balance.
 *
 * Transfers between the owner's own accounts are excluded from in/out — they
 * are not income or spending — but they still move the closing balance.
 */
export function buildDailyFlow(
	transactions: readonly Transaction[],
	balanceSeries: readonly BalancePoint[]
): readonly DailyFlow[] {
	const closingByDate = new Map<string, number>();
	for (const point of balanceSeries) {
		if (point.transaction === null) continue;
		closingByDate.set(point.transaction.date, point.balance);
	}

	const byDate = new Map<string, { income: number; expense: number }>();
	for (const transaction of transactions) {
		const day = byDate.get(transaction.date) ?? { income: 0, expense: 0 };
		byDate.set(transaction.date, {
			income: day.income + (transaction.flow === 'income' ? transaction.amount : 0),
			expense: day.expense + (transaction.flow === 'expense' ? -transaction.amount : 0)
		});
	}

	return [...byDate.entries()]
		.map(([date, day]) => ({
			date,
			timestamp: new Date(`${date}T00:00:00`).getTime(),
			income: round(day.income),
			expense: round(day.expense),
			net: round(day.income - day.expense),
			closingBalance: closingByDate.get(date) ?? 0
		}))
		.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Roll per-day flow up into per-month flow.
 *
 * A bar per day is the right resolution for a month or a quarter. Across two
 * years it is six hundred hairlines, where no single bar can be read and the
 * shape says less than a monthly one would.
 */
export function groupFlowByMonth(days: readonly DailyFlow[]): readonly DailyFlow[] {
	const months = new Map<string, { income: number; expense: number; closingBalance: number }>();

	for (const day of days) {
		const key = day.date.slice(0, 7);
		const month = months.get(key) ?? { income: 0, expense: 0, closingBalance: 0 };
		months.set(key, {
			income: month.income + day.income,
			expense: month.expense + day.expense,
			// Days arrive in order, so the last one seen closes the month.
			closingBalance: day.closingBalance
		});
	}

	return [...months.entries()].map(([month, totals]) => ({
		date: `${month}-01`,
		timestamp: new Date(`${month}-01T00:00:00`).getTime(),
		income: round(totals.income),
		expense: round(totals.expense),
		net: round(totals.income - totals.expense),
		closingBalance: totals.closingBalance
	}));
}

/** Whole days covered by the period, counting both endpoints. */
export function daysCovered(transactions: readonly Transaction[]): number {
	if (transactions.length === 0) return 0;

	const first = startOfDay(transactions[0].date);
	const last = startOfDay(transactions[transactions.length - 1].date);
	return Math.round((last - first) / MS_PER_DAY) + 1;
}

export function sumAmounts(transactions: readonly Transaction[]): number {
	return round(transactions.reduce((total, transaction) => total + transaction.amount, 0));
}

function startOfDay(date: string): number {
	return new Date(`${date}T00:00:00`).getTime();
}

/** Money is decimal; floating-point sums drift. Settle to cents at each step. */
export function round(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
