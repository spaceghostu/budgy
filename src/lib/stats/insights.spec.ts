import { describe, expect, it } from 'vitest';
import { makeTransaction } from '../testing/transaction.ts';
import {
	buildBalanceSeries,
	buildDailyFlow,
	daysCovered,
	groupFlowByMonth,
	hasPrintedBalances
} from './balance.ts';
import {
	NO_FILTERS,
	buildInsights,
	bucketBy,
	filterTransactions,
	findRecurring
} from './insights.ts';

describe('buildBalanceSeries', () => {
	it('unwinds backwards from the closing balance the user supplied', () => {
		const transactions = [
			makeTransaction({ date: '2026-03-01', amount: -100 }),
			makeTransaction({ date: '2026-03-02', amount: -50 }),
			makeTransaction({ date: '2026-03-03', amount: 200 })
		];

		const series = buildBalanceSeries(transactions, 1050);

		// Opening = 1050 - (-100 - 50 + 200) = 1000.
		expect(series.map((point) => point.balance)).toEqual([1000, 900, 850, 1050]);
	});

	it('opens the series with a synthetic point carrying no transaction', () => {
		const series = buildBalanceSeries([makeTransaction({ date: '2026-03-01', amount: -100 })], 0);

		expect(series[0].transaction).toBeNull();
		expect(series[1].transaction).not.toBeNull();
	});

	it('treats the default anchor of zero as net change', () => {
		const series = buildBalanceSeries(
			[
				makeTransaction({ date: '2026-03-01', amount: -100 }),
				makeTransaction({ date: '2026-03-02', amount: -50 })
			],
			0
		);

		expect(series.map((point) => point.balance)).toEqual([150, 50, 0]);
	});

	it('settles floating-point drift to cents', () => {
		const series = buildBalanceSeries(
			[
				makeTransaction({ date: '2026-03-01', amount: -0.1 }),
				makeTransaction({ date: '2026-03-02', amount: -0.2 }),
				makeTransaction({ date: '2026-03-03', amount: -0.3 })
			],
			0
		);

		expect(series.map((point) => point.balance)).toEqual([0.6, 0.5, 0.3, 0]);
	});

	it('returns nothing for an empty statement', () => {
		expect(buildBalanceSeries([], 100)).toEqual([]);
	});

	it('uses the balances the bank printed, ignoring the anchor entirely', () => {
		const transactions = [
			makeTransaction({ date: '2026-03-01', amount: -100, balance: 900 }),
			makeTransaction({ date: '2026-03-02', amount: -50, balance: 850 })
		];

		// The anchor is nonsense on purpose: printed balances must win.
		const series = buildBalanceSeries(transactions, 999_999);

		expect(series.map((point) => point.balance)).toEqual([1000, 900, 850]);
	});

	it('opens a printed series at the balance before the first movement', () => {
		const series = buildBalanceSeries(
			[makeTransaction({ date: '2026-03-01', amount: -100, balance: 900 })],
			0
		);

		expect(series[0]).toMatchObject({ balance: 1000, transaction: null });
	});

	it('falls back to the anchor when even one row has no printed balance', () => {
		const series = buildBalanceSeries(
			[
				makeTransaction({ date: '2026-03-01', amount: -100, balance: 900 }),
				makeTransaction({ date: '2026-03-02', amount: -50, balance: null })
			],
			850
		);

		expect(series.map((point) => point.balance)).toEqual([1000, 900, 850]);
	});
});

describe('hasPrintedBalances', () => {
	it('is true only when every row carries one', () => {
		expect(
			hasPrintedBalances([makeTransaction({ date: '2026-03-01', amount: -1, balance: 5 })])
		).toBe(true);
		expect(
			hasPrintedBalances([
				makeTransaction({ date: '2026-03-01', amount: -1, balance: 5 }),
				makeTransaction({ date: '2026-03-02', amount: -1, balance: null })
			])
		).toBe(false);
	});

	it('is false for an empty period', () => {
		expect(hasPrintedBalances([])).toBe(false);
	});
});

describe('buildDailyFlow', () => {
	const transactions = [
		makeTransaction({ date: '2026-03-01', amount: -100 }),
		makeTransaction({ date: '2026-03-01', amount: -50, time: '15:00:00' }),
		makeTransaction({ date: '2026-03-01', amount: 500, time: '16:00:00', flow: 'income' }),
		makeTransaction({ date: '2026-03-03', amount: -25 }),
		makeTransaction({ date: '2026-03-03', amount: 1000, time: '13:00:00', flow: 'transfer' })
	];

	it('sums money in and money out per day', () => {
		const flow = buildDailyFlow(transactions, buildBalanceSeries(transactions, 0));

		expect(flow.map((day) => [day.date, day.income, day.expense])).toEqual([
			['2026-03-01', 500, 150],
			['2026-03-03', 0, 25]
		]);
	});

	it('excludes own-account transfers from money in and out', () => {
		const flow = buildDailyFlow(transactions, buildBalanceSeries(transactions, 0));
		const third = flow.find((day) => day.date === '2026-03-03');

		expect(third?.income).toBe(0);
	});

	it('carries the balance at the end of each day', () => {
		const flow = buildDailyFlow(transactions, buildBalanceSeries(transactions, 0));

		// Closing 0; the last day's final transaction is the +1000 transfer.
		expect(flow.at(-1)?.closingBalance).toBe(0);
	});
});

describe('groupFlowByMonth', () => {
	const transactions = [
		makeTransaction({ date: '2026-03-01', amount: -100 }),
		makeTransaction({ date: '2026-03-20', amount: -50 }),
		makeTransaction({ date: '2026-04-02', amount: 500, flow: 'income' })
	];

	it('sums each month’s money in and out into one bucket', () => {
		const months = groupFlowByMonth(
			buildDailyFlow(transactions, buildBalanceSeries(transactions, 0))
		);

		expect(months.map((month) => [month.date, month.income, month.expense])).toEqual([
			['2026-03-01', 0, 150],
			['2026-04-01', 500, 0]
		]);
	});

	it('carries the balance at the end of the month', () => {
		const months = groupFlowByMonth(
			buildDailyFlow(transactions, buildBalanceSeries(transactions, 0))
		);

		expect(months.at(-1)?.closingBalance).toBe(0);
	});

	it('has nothing to group in an empty period', () => {
		expect(groupFlowByMonth([])).toEqual([]);
	});
});

describe('flow resolution', () => {
	function spanning(days: number) {
		return Array.from({ length: days }, (_, index) =>
			makeTransaction({
				date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
				amount: -10
			})
		);
	}

	it('keeps a bar per day for a quarter or less', () => {
		const insights = buildInsights(spanning(60), 0);

		expect(insights.flowIsMonthly).toBe(false);
		expect(insights.flow).toHaveLength(60);
	});

	it('buckets by month once a bar per day would be unreadable', () => {
		// 600 hairlines say less than 20 monthly bars do.
		const insights = buildInsights(spanning(200), 0);

		expect(insights.flowIsMonthly).toBe(true);
		expect(insights.flow.length).toBeLessThan(10);
		// The day-level roll-up stays, because the summary is computed from it.
		expect(insights.dailyFlow).toHaveLength(200);
	});
});

describe('daysCovered', () => {
	it('counts both endpoints', () => {
		expect(
			daysCovered([
				makeTransaction({ date: '2026-03-01', amount: -1 }),
				makeTransaction({ date: '2026-03-03', amount: -1 })
			])
		).toBe(3);
	});

	it('counts a single-day statement as one day', () => {
		expect(daysCovered([makeTransaction({ date: '2026-03-01', amount: -1 })])).toBe(1);
	});

	it('is zero for an empty statement', () => {
		expect(daysCovered([])).toBe(0);
	});
});

describe('bucketBy', () => {
	it('totals magnitudes, biggest first, with each share of the whole', () => {
		const buckets = bucketBy(
			[
				makeTransaction({ date: '2026-03-01', amount: -75, bankCategory: 'Food and Drink' }),
				makeTransaction({ date: '2026-03-02', amount: -25, bankCategory: 'Food and Drink' }),
				makeTransaction({ date: '2026-03-03', amount: -100, bankCategory: 'Transport' })
			],
			(transaction) => transaction.bankCategory
		);

		expect(buckets).toEqual([
			{ label: 'Food and Drink', total: 100, count: 2, share: 0.5 },
			{ label: 'Transport', total: 100, count: 1, share: 0.5 }
		]);
	});

	it('labels a blank key rather than dropping it', () => {
		const buckets = bucketBy(
			[makeTransaction({ date: '2026-03-01', amount: -10, bankCategory: '' })],
			(t) => t.bankCategory
		);

		expect(buckets[0].label).toBe('Uncategorised');
	});
});

describe('findRecurring', () => {
	it('flags a debit order even when it appears once', () => {
		const recurring = findRecurring([
			makeTransaction({ date: '2026-03-01', amount: -998, type: 'Debit order', merchant: 'GYM' })
		]);

		expect(recurring.map((charge) => charge.merchant)).toEqual(['GYM']);
		expect(recurring[0].isDebitOrder).toBe(true);
	});

	it('flags a card merchant billing the same amount a month apart', () => {
		const recurring = findRecurring([
			makeTransaction({ date: '2026-02-26', amount: -229, merchant: 'Streamflix' }),
			makeTransaction({ date: '2026-03-26', amount: -229, merchant: 'Streamflix' })
		]);

		expect(recurring[0]).toMatchObject({
			merchant: 'Streamflix',
			count: 2,
			months: ['2026-02', '2026-03'],
			meanAmount: 229,
			medianAmount: 229,
			isDebitOrder: false
		});
	});

	it('ignores a one-off card purchase', () => {
		expect(
			findRecurring([makeTransaction({ date: '2026-03-01', amount: -99, merchant: 'Shop' })])
		).toEqual([]);
	});

	it('ignores two shops either side of a month boundary', () => {
		// 31 July and 1 August are two distinct months but four days apart.
		expect(
			findRecurring([
				makeTransaction({ date: '2026-07-31', amount: -420, merchant: 'Grocer' }),
				makeTransaction({ date: '2026-08-01', amount: -420, merchant: 'Grocer' })
			])
		).toEqual([]);
	});

	it('ignores a merchant whose amount swings, however often it appears', () => {
		expect(
			findRecurring([
				makeTransaction({ date: '2026-02-02', amount: -775, merchant: 'Grocer' }),
				makeTransaction({ date: '2026-03-05', amount: -158, merchant: 'Grocer' }),
				makeTransaction({ date: '2026-04-08', amount: -486, merchant: 'Grocer' })
			])
		).toEqual([]);
	});

	it('ignores bank fees, which recur but are not a commitment', () => {
		expect(
			findRecurring([
				makeTransaction({ date: '2026-02-02', amount: -5, merchant: 'Payment fee', isFee: true }),
				makeTransaction({ date: '2026-03-05', amount: -5, merchant: 'Payment fee', isFee: true })
			])
		).toEqual([]);
	});

	it('totals a lender taking two instalments on one day as one monthly outgoing', () => {
		const recurring = findRecurring([
			makeTransaction({
				date: '2026-03-24',
				amount: -8319.22,
				type: 'Debit Order',
				merchant: 'LENDER'
			}),
			makeTransaction({
				date: '2026-03-24',
				amount: -2920.22,
				type: 'Debit Order',
				merchant: 'LENDER'
			})
		]);

		expect(recurring[0]).toMatchObject({
			merchant: 'LENDER',
			latestAmount: 11239.44,
			meanAmount: 11239.44,
			medianAmount: 11239.44,
			count: 2
		});
	});

	it('averages across months, not across charges', () => {
		const recurring = findRecurring([
			makeTransaction({ date: '2026-02-01', amount: -500, type: 'Debit order', merchant: 'GYM' }),
			makeTransaction({ date: '2026-03-01', amount: -500, type: 'Debit order', merchant: 'GYM' }),
			makeTransaction({ date: '2026-03-15', amount: -500, type: 'Debit order', merchant: 'GYM' })
		]);

		// March took 1000, February took 500 — the average month costs 750.
		expect(recurring[0]).toMatchObject({
			latestAmount: 1000,
			meanAmount: 750,
			medianAmount: 750
		});
	});

	it('reports a median month alongside the mean', () => {
		// A debit order, because the subscription test caps variation at 1.15x —
		// so a card charge can never swing far enough for the two to disagree.
		// This is where the median earns its place: two ordinary months and one
		// that caught up on arrears.
		const recurring = findRecurring([
			makeTransaction({
				date: '2026-01-05',
				amount: -100,
				type: 'Debit order',
				merchant: 'LENDER'
			}),
			makeTransaction({
				date: '2026-02-05',
				amount: -100,
				type: 'Debit order',
				merchant: 'LENDER'
			}),
			makeTransaction({
				date: '2026-03-05',
				amount: -1000,
				type: 'Debit order',
				merchant: 'LENDER'
			})
		]);

		expect(recurring[0]).toMatchObject({
			latestAmount: 1000,
			meanAmount: 400,
			medianAmount: 100
		});
	});

	it('does not leak its internal scoring onto the result', () => {
		const recurring = findRecurring([
			makeTransaction({ date: '2026-03-01', amount: -500, type: 'Debit order', merchant: 'GYM' })
		]);

		expect(recurring[0]).not.toHaveProperty('spanDays');
	});
});

describe('filterTransactions', () => {
	const transactions = [
		makeTransaction({ date: '2026-03-01', amount: -1, account: 'Cheque account' }),
		makeTransaction({ date: '2026-03-05', amount: -1, account: 'Savings' }),
		makeTransaction({ date: '2026-03-10', amount: -1, account: 'Cheque account' })
	];

	it('passes everything through when unfiltered', () => {
		expect(filterTransactions(transactions, NO_FILTERS)).toHaveLength(3);
	});

	it('filters by account', () => {
		expect(filterTransactions(transactions, { ...NO_FILTERS, account: 'Savings' })).toHaveLength(1);
	});

	it('filters by an inclusive date range', () => {
		const filtered = filterTransactions(transactions, {
			...NO_FILTERS,
			from: '2026-03-05',
			to: '2026-03-10'
		});

		expect(filtered.map((transaction) => transaction.date)).toEqual(['2026-03-05', '2026-03-10']);
	});
});

describe('buildInsights', () => {
	const transactions = [
		makeTransaction({
			date: '2026-03-01',
			amount: 10000,
			flow: 'income',
			type: 'EFT',
			merchant: 'Employer'
		}),
		makeTransaction({
			date: '2026-03-02',
			amount: -2000,
			merchant: 'Rent',
			bankCategory: 'Home',
			category: 'Utilities and Rates'
		}),
		makeTransaction({
			date: '2026-03-03',
			amount: -500,
			merchant: 'Grocer',
			bankCategory: 'Food and Drink'
		}),
		makeTransaction({
			date: '2026-03-04',
			amount: -6,
			merchant: 'Bank',
			bankCategory: 'Fees and Interest',
			category: 'Bank Fees',
			isFee: true,
			isDeclined: true,
			description: 'Txn Declined Fee'
		}),
		makeTransaction({
			date: '2026-03-04',
			amount: 0,
			flow: 'noop',
			description: 'Declined Int Card Purch',
			isDeclined: true
		}),
		makeTransaction({
			date: '2026-03-05',
			amount: -1000,
			flow: 'transfer',
			type: 'Transfer',
			bankCategory: 'Not for Financial Analyser'
		})
	];

	const { summary } = buildInsights(transactions, 6494);

	it('separates income, spending and transfers', () => {
		expect(summary.income).toBe(10000);
		expect(summary.expense).toBe(2506);
		expect(summary.net).toBe(7494);
	});

	it('reports the balance change including transfers', () => {
		expect(summary.balanceChange).toBe(6494);
		expect(summary.openingBalance).toBe(0);
		expect(summary.closingBalance).toBe(6494);
	});

	it('counts fees and declines separately from ordinary spending', () => {
		expect(summary.fees).toBe(6);
		expect(summary.declinedFees).toBe(6);
		expect(summary.declinedCount).toBe(2);
	});

	it('excludes zero-amount rows from the transaction count', () => {
		expect(summary.transactionCount).toBe(5);
	});

	it('means and medians spending across the days covered', () => {
		expect(summary.days).toBe(5);
		// R2 506 over five days, but four of those days cost R6 or nothing — the
		// rent is the whole mean, and the median says so.
		expect(summary.meanDailySpend).toBe(501.2);
		expect(summary.medianDailySpend).toBe(6);
	});

	it('counts the days nothing was spent in both averages', () => {
		const sparse = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-03-10', amount: -100, merchant: 'Shop' })
			],
			1000
		).summary;

		// Ten days covered, eight of them quiet: R200 spread over ten is R20 a
		// day, and the middle day of ten cost nothing at all.
		expect(sparse.days).toBe(10);
		expect(sparse.meanDailySpend).toBe(20);
		expect(sparse.medianDailySpend).toBe(0);
	});

	it('reports no runway when income outpaces spending', () => {
		expect(summary.runwayDays).toBeNull();
	});

	it('projects runway when the account is burning down', () => {
		const burning = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-03-10', amount: -100, merchant: 'Shop' })
			],
			1000
		);

		// 200 spent over 10 days = 20/day; 1000 / 20 = 50 days.
		expect(burning.summary.runwayDays).toBe(50);
	});

	it('names the biggest single hits', () => {
		expect(summary.largestExpense?.merchant).toBe('Rent');
		expect(summary.largestIncome?.merchant).toBe('Employer');
	});

	it('finds the heaviest spending day', () => {
		expect(summary.busiestSpendDay?.date).toBe('2026-03-02');
	});

	it('ranks spending categories, excluding transfers and income', () => {
		const { categories } = buildInsights(transactions, 6494);

		expect(categories.map((bucket) => bucket.label)).toEqual([
			'Utilities and Rates',
			'Groceries',
			'Bank Fees'
		]);
	});
});
