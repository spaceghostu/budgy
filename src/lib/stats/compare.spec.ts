import { describe, expect, it } from 'vitest';
import { allSpending, compareMonths, drillInto, foldTail, peakMonth } from './compare.ts';
import { applyCategoryRules } from '../categorise.ts';
import { bucketBy } from './insights.ts';
import { makeTransaction } from '../testing/transaction.ts';

/** Two whole months of two categories, so June and July can be set against each other. */
const twoMonths = [
	makeTransaction({ date: '2026-06-01', amount: -100, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-20', amount: -300, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-30', amount: -50, category: 'Coffee', merchant: 'Cafe' }),
	makeTransaction({ date: '2026-07-01', amount: -600, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-31', amount: -25, category: 'Coffee', merchant: 'Cafe' })
];

describe('compareMonths', () => {
	it('gives each label a total per month, oldest column first', () => {
		const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

		expect(comparison.months.map((month) => month.month)).toEqual(['2026-06', '2026-07']);
		expect(comparison.rows.map((row) => [row.label, ...row.totals])).toEqual([
			['Groceries', 400, 600],
			['Coffee', 50, 25]
		]);
	});

	it('sorts the heaviest label first, across every month compared', () => {
		// Coffee beat groceries in July alone; over both months it did not.
		const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

		expect(comparison.rows.map((row) => row.total)).toEqual([1000, 75]);
	});

	it('breaks a tie on the label, so the order cannot wander', () => {
		const comparison = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, category: 'Zoo' }),
				makeTransaction({ date: '2026-06-02', amount: -100, category: 'Apples' })
			],
			['2026-06']
		);

		expect(comparison.rows.map((row) => row.label)).toEqual(['Apples', 'Zoo']);
	});

	it('rolls up by merchant when asked', () => {
		const comparison = compareMonths(twoMonths, ['2026-06', '2026-07'], 'merchant');

		expect(comparison.dimension).toBe('merchant');
		expect(comparison.rows.map((row) => row.label)).toEqual(['Shop', 'Cafe']);
	});

	it('counts the transactions behind each row', () => {
		const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

		expect(comparison.rows[0].count).toBe(3);
	});

	it('totals each month across every label', () => {
		const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

		expect(comparison.months.map((month) => month.total)).toEqual([450, 625]);
	});

	it('leaves income out — money coming in has no category to compare', () => {
		const comparison = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: 5000, category: 'Income Salary' }),
				makeTransaction({ date: '2026-06-02', amount: -100, category: 'Groceries' })
			],
			['2026-06']
		);

		expect(comparison.rows.map((row) => row.label)).toEqual(['Groceries']);
	});

	it('leaves transfers out — moving your own money is not spending', () => {
		const comparison = compareMonths(
			[
				makeTransaction({
					date: '2026-06-01',
					amount: -900,
					flow: 'transfer',
					category: 'Transfers'
				}),
				makeTransaction({ date: '2026-06-02', amount: -100, category: 'Groceries' })
			],
			['2026-06']
		);

		expect(comparison.rows.map((row) => row.label)).toEqual(['Groceries']);
	});

	it('files a row the bank left blank under Uncategorised rather than under nothing', () => {
		const comparison = compareMonths(
			[makeTransaction({ date: '2026-06-01', amount: -100, category: '' })],
			['2026-06']
		);

		expect(comparison.rows[0].label).toBe('Uncategorised');
	});

	it('ignores months outside the comparison', () => {
		const comparison = compareMonths(twoMonths, ['2026-07']);

		expect(comparison.rows.map((row) => [row.label, ...row.totals])).toEqual([
			['Groceries', 600],
			['Coffee', 25]
		]);
	});

	it('keeps a column for a month nothing was spent in', () => {
		// The reader asked about August; that nothing happened is the answer.
		const comparison = compareMonths(twoMonths, ['2026-07', '2026-08']);

		expect(comparison.months.map((month) => month.total)).toEqual([625, 0]);
		expect(comparison.rows[0].totals).toEqual([600, 0]);
	});

	it('zero-fills a month a label never appeared in', () => {
		const comparison = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, category: 'Coffee' }),
				makeTransaction({ date: '2026-07-01', amount: -100, category: 'Fuel' })
			],
			['2026-06', '2026-07']
		);

		expect(comparison.rows.map((row) => [row.label, ...row.totals])).toEqual([
			['Coffee', 100, 0],
			['Fuel', 0, 100]
		]);
	});

	it('puts the columns in order however they were asked for, and asks once', () => {
		const comparison = compareMonths(twoMonths, ['2026-07', '2026-06', '2026-07']);

		expect(comparison.months.map((month) => month.month)).toEqual(['2026-06', '2026-07']);
	});

	it('settles floating-point drift to cents', () => {
		const comparison = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -0.1, category: 'Coffee' }),
				makeTransaction({ date: '2026-06-02', amount: -0.2, category: 'Coffee' })
			],
			['2026-06']
		);

		expect(comparison.rows[0].totals).toEqual([0.3]);
	});

	it('is empty before a statement is loaded', () => {
		expect(compareMonths([], ['2026-06']).rows).toEqual([]);
	});

	it('has nothing to compare when no month was asked for', () => {
		const comparison = compareMonths(twoMonths, []);

		expect(comparison.months).toEqual([]);
		expect(comparison.rows).toEqual([]);
	});

	describe('what moved', () => {
		it('sets the newest month against the one before it', () => {
			const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

			expect(comparison.rows[0].change).toBe(200);
			expect(comparison.rows[0].changeShare).toBe(0.5);
		});

		it('is negative when less went there', () => {
			const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

			expect(comparison.rows[1].change).toBe(-25);
			expect(comparison.rows[1].changeShare).toBe(-0.5);
		});

		it('compares the last two of a longer run, not the ends of it', () => {
			// The question a reader asks of six columns is what moved *this* month.
			const comparison = compareMonths(
				[
					makeTransaction({ date: '2026-06-01', amount: -900, category: 'Coffee' }),
					makeTransaction({ date: '2026-07-01', amount: -100, category: 'Coffee' }),
					makeTransaction({ date: '2026-08-01', amount: -150, category: 'Coffee' })
				],
				['2026-06', '2026-07', '2026-08']
			);

			expect(comparison.rows[0].change).toBe(50);
		});

		it('has no percentage to report when the month before was zero', () => {
			// Spending that started from nothing did not rise by a percentage.
			const comparison = compareMonths(
				[makeTransaction({ date: '2026-07-01', amount: -100, category: 'Fuel' })],
				['2026-06', '2026-07']
			);

			expect(comparison.rows[0].change).toBe(100);
			expect(comparison.rows[0].changeShare).toBeNull();
		});

		it('reports no movement across a single month, which has nothing before it', () => {
			const comparison = compareMonths(twoMonths, ['2026-07']);

			expect(comparison.rows[0].change).toBe(0);
			expect(comparison.rows[0].changeShare).toBeNull();
		});
	});

	describe('months the statement may not have all of', () => {
		it('marks a newest month the statement stops part-way into', () => {
			const comparison = compareMonths(
				[
					makeTransaction({ date: '2026-06-01', amount: -100 }),
					makeTransaction({ date: '2026-07-09', amount: -100 })
				],
				['2026-06', '2026-07']
			);

			expect(comparison.months.map((month) => month.isPartial)).toEqual([false, true]);
		});

		it('leaves a month the statement runs to the end of alone', () => {
			// June opens on the 1st and July closes on the 31st: both are whole.
			const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

			expect(comparison.months.map((month) => month.isPartial)).toEqual([false, false]);
		});

		it('marks an oldest month the statement opens part-way into', () => {
			const comparison = compareMonths(
				[
					makeTransaction({ date: '2026-06-15', amount: -100 }),
					makeTransaction({ date: '2026-07-31', amount: -100 })
				],
				['2026-06', '2026-07']
			);

			expect(comparison.months.map((month) => month.isPartial)).toEqual([true, false]);
		});

		it('reads the whole statement, not only what was spent', () => {
			// A month whose first purchase falls on the 9th is a quiet week, not an
			// export that opened late — and an asterisk on it would say otherwise.
			const comparison = compareMonths(
				[
					makeTransaction({ date: '2026-06-01', amount: 5000, category: 'Income Salary' }),
					makeTransaction({ date: '2026-06-09', amount: -100, category: 'Groceries' }),
					makeTransaction({ date: '2026-07-31', amount: -100, category: 'Groceries' })
				],
				['2026-06', '2026-07']
			);

			expect(comparison.months.map((month) => month.isPartial)).toEqual([false, false]);
		});

		it('judges a month against the whole statement, not the comparison', () => {
			// July is whole; that the reader left June out does not put it in doubt.
			const comparison = compareMonths(
				[
					makeTransaction({ date: '2026-06-15', amount: -100 }),
					makeTransaction({ date: '2026-07-10', amount: -100 }),
					makeTransaction({ date: '2026-08-31', amount: -100 })
				],
				['2026-07', '2026-08']
			);

			expect(comparison.months.map((month) => month.isPartial)).toEqual([false, false]);
		});
	});

	describe('a month that opens on a day of the reader’s choosing', () => {
		/** Paid on the 25th: June's money is spent from 25 May to 24 June. */
		const paidOn25 = [
			makeTransaction({ date: '2026-05-24', amount: -100, category: 'Coffee' }),
			makeTransaction({ date: '2026-05-25', amount: -200, category: 'Coffee' }),
			makeTransaction({ date: '2026-06-24', amount: -400, category: 'Coffee' })
		];

		it('files spending into the cycle it falls in, not the calendar month', () => {
			const comparison = compareMonths(paidOn25, ['2026-05', '2026-06'], 'category', 25);

			// 24 May closes May's cycle; the 25th opens June's.
			expect(comparison.rows[0].totals).toEqual([100, 600]);
		});

		it('measures a cycle’s completeness against its own last day', () => {
			const comparison = compareMonths(paidOn25, ['2026-05', '2026-06'], 'category', 25);

			// The statement stops on 24 June, which is the last day of June's cycle.
			expect(comparison.months.map((month) => month.isPartial)).toEqual([true, false]);
		});
	});
});

describe('foldTail', () => {
	const rows = compareMonths(
		[
			makeTransaction({ date: '2026-06-01', amount: -100, category: 'A' }),
			makeTransaction({ date: '2026-06-02', amount: -80, category: 'B' }),
			makeTransaction({ date: '2026-06-03', amount: -60, category: 'C' }),
			makeTransaction({ date: '2026-07-01', amount: -10, category: 'B' }),
			makeTransaction({ date: '2026-07-02', amount: -20, category: 'C' })
		],
		['2026-06', '2026-07']
	).rows;

	it('leaves a list shorter than the limit alone', () => {
		expect(foldTail(rows, 8)).toBe(rows);
	});

	it('folds everything past the limit into one row, month by month', () => {
		const folded = foldTail(rows, 1);

		expect(folded.map((row) => row.label)).toEqual(['A', 'Other (2)']);
		expect(folded[1].totals).toEqual([140, 30]);
		expect(folded[1].total).toBe(170);
		expect(folded[1].count).toBe(4);
	});

	it('says what moved in the tail, so the folded row reads like the others', () => {
		expect(foldTail(rows, 1)[1].change).toBe(-110);
	});

	it('reports no movement in a tail folded out of a single month', () => {
		const oneMonth = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, category: 'A' }),
				makeTransaction({ date: '2026-06-02', amount: -80, category: 'B' })
			],
			['2026-06']
		).rows;

		expect(foldTail(oneMonth, 1)[1].change).toBe(0);
		expect(foldTail(oneMonth, 1)[1].changeShare).toBeNull();
	});
});

describe('peakMonth', () => {
	it('finds the heaviest single month any row reached', () => {
		const { rows } = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, category: 'A' }),
				makeTransaction({ date: '2026-07-01', amount: -400, category: 'A' }),
				makeTransaction({ date: '2026-07-02', amount: -50, category: 'B' })
			],
			['2026-06', '2026-07']
		);

		expect(peakMonth(rows)).toBe(400);
	});

	it('is zero when there is nothing to draw', () => {
		expect(peakMonth([])).toBe(0);
	});
});

describe('allSpending', () => {
	const comparison = compareMonths(twoMonths, ['2026-06', '2026-07']);

	it('carries every month’s whole spending, in order', () => {
		expect(allSpending(comparison).totals).toEqual([450, 625]);
	});

	it('says what the months cost between them', () => {
		expect(allSpending(comparison).total).toBe(1075);
	});

	it('counts every transaction behind the comparison', () => {
		expect(allSpending(comparison).count).toBe(5);
	});

	it('says what moved, the way a row of its own would', () => {
		const row = allSpending(comparison);

		expect(row.change).toBe(175);
		expect(row.changeShare).toBeCloseTo(175 / 450, 10);
	});

	it('counts the tail a chart folded away, which a top-eight would lose', () => {
		const wide = compareMonths(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, category: 'A' }),
				makeTransaction({ date: '2026-06-02', amount: -1, category: 'B' })
			],
			['2026-06']
		);

		expect(allSpending(wide).totals).toEqual([101]);
	});
});

describe('drillInto', () => {
	it('finds the rows behind a category', () => {
		const drilldown = drillInto(twoMonths, 'category', 'Groceries');

		expect(drilldown.transactions).toHaveLength(3);
		expect(drilldown.label).toBe('Groceries');
	});

	it('totals to exactly the figure the bar showed', () => {
		// The rule the whole app is held to: no two figures on screen disagree.
		const bar = compareMonths(twoMonths, ['2026-06', '2026-07']).rows[0];

		expect(drillInto(twoMonths, 'category', 'Groceries').total).toBe(bar.total);
	});

	it('finds the rows behind a merchant', () => {
		expect(drillInto(twoMonths, 'merchant', 'Cafe').total).toBe(75);
	});

	it('reads newest first — a drill-down is read backwards', () => {
		const drilldown = drillInto(twoMonths, 'category', 'Groceries');

		expect(drilldown.transactions.map((transaction) => transaction.date)).toEqual([
			'2026-07-01',
			'2026-06-20',
			'2026-06-01'
		]);
	});

	it('narrows to one month when the bar stood for one month', () => {
		const drilldown = drillInto(twoMonths, 'category', 'Groceries', ['2026-07']);

		expect(drilldown.total).toBe(600);
		expect(drilldown.months).toEqual(['2026-07']);
	});

	it('matches the month bar it was opened from', () => {
		const { rows } = compareMonths(twoMonths, ['2026-06', '2026-07']);

		expect(drillInto(twoMonths, 'category', 'Groceries', ['2026-06']).total).toBe(
			rows[0].totals[0]
		);
	});

	it('finds the rows the bank left blank behind the Uncategorised bar', () => {
		// The bar counts an empty category under that name; so must the list, or
		// the one bar a reader most wants to open would come back empty.
		const blank = [
			makeTransaction({ date: '2026-06-01', amount: -100, category: '' }),
			makeTransaction({ date: '2026-06-02', amount: -50, category: 'Coffee' })
		];

		expect(drillInto(blank, 'category', 'Uncategorised').total).toBe(100);
	});

	it('leaves income out, so the list cannot outrun the bar', () => {
		const withRefund = [
			makeTransaction({ date: '2026-06-01', amount: -100, category: 'Groceries' }),
			makeTransaction({ date: '2026-06-02', amount: 30, category: 'Groceries' })
		];

		expect(drillInto(withRefund, 'category', 'Groceries').total).toBe(100);
	});

	it('leaves transfers out for the same reason', () => {
		const withTransfer = [
			makeTransaction({ date: '2026-06-01', amount: -100, category: 'Transfers' }),
			makeTransaction({ date: '2026-06-02', amount: -900, category: 'Transfers', flow: 'transfer' })
		];

		expect(drillInto(withTransfer, 'category', 'Transfers').total).toBe(100);
	});

	it('is empty for a label nothing is filed under', () => {
		const drilldown = drillInto(twoMonths, 'category', 'Fuel');

		expect(drilldown.transactions).toEqual([]);
		expect(drilldown.total).toBe(0);
	});

	it('narrows by the reader’s own months, not by calendar ones', () => {
		const paidOn25 = [
			makeTransaction({ date: '2026-05-24', amount: -100, category: 'Coffee' }),
			makeTransaction({ date: '2026-05-25', amount: -200, category: 'Coffee' })
		];

		// 25 May opens June's cycle, so only the earlier row is May's.
		expect(drillInto(paidOn25, 'category', 'Coffee', ['2026-05'], 25).total).toBe(100);
		expect(drillInto(paidOn25, 'category', 'Coffee', ['2026-06'], 25).total).toBe(200);
	});
});

describe('a bar and the list behind it', () => {
	/**
	 * The two are computed by different functions — `bucketBy` for the breakdown,
	 * `drillInto` for the rows behind it — and the app promises they agree. A
	 * refund is where they would most easily stop agreeing, so it is in the
	 * fixture.
	 */
	const slice = [
		makeTransaction({ date: '2026-06-01', amount: -300, category: 'Groceries' }),
		makeTransaction({ date: '2026-06-05', amount: 45, category: 'Groceries' }),
		makeTransaction({ date: '2026-06-10', amount: -900, category: 'Transfers', flow: 'transfer' }),
		makeTransaction({ date: '2026-06-12', amount: -60, category: '' })
	];

	/** Mirrors the real wiring: buckets are fed spending, drill-downs the slice. */
	const buckets = bucketBy(
		slice.filter((transaction) => transaction.flow === 'expense'),
		(transaction) => transaction.category
	);

	it('total to the same figure for a category', () => {
		const bar = buckets.find((bucket) => bucket.label === 'Groceries');

		expect(drillInto(slice, 'category', 'Groceries').total).toBe(bar?.total);
	});

	it('agree about the rows the bank left unfiled', () => {
		const bar = buckets.find((bucket) => bucket.label === 'Uncategorised');

		expect(drillInto(slice, 'category', 'Uncategorised').total).toBe(bar?.total);
	});

	it('count the same rows, not merely the same money', () => {
		const bar = buckets.find((bucket) => bucket.label === 'Groceries');

		expect(drillInto(slice, 'category', 'Groceries').transactions).toHaveLength(bar?.count ?? 0);
	});

	it('agree for every label at once, by merchant as well', () => {
		for (const dimension of ['category', 'merchant'] as const) {
			const bars = bucketBy(
				slice.filter((transaction) => transaction.flow === 'expense'),
				(transaction) => (dimension === 'merchant' ? transaction.merchant : transaction.category)
			);

			for (const bar of bars) {
				expect(drillInto(slice, dimension, bar.label).total).toBe(bar.total);
			}
		}
	});
});

describe('drillInto, grouped by merchant', () => {
	/** A category bar is usually several merchants; a rule files one of them. */
	const groceries = [
		makeTransaction({ date: '2026-06-01', amount: -100, category: 'Groceries', merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-10', amount: -50, category: 'Groceries', merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-20', amount: -400, category: 'Groceries', merchant: 'Deli' })
	];

	it('groups the rows by the unit a rule applies to, heaviest first', () => {
		const { merchants } = drillInto(groceries, 'category', 'Groceries');

		expect(merchants.map((group) => group.merchant)).toEqual(['Deli', 'Shop']);
		expect(merchants.map((group) => group.total)).toEqual([400, 150]);
		expect(merchants.map((group) => group.count)).toEqual([1, 2]);
	});

	it('breaks a tie on the merchant, so the order cannot wander', () => {
		const { merchants } = drillInto(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, merchant: 'Zoo' }),
				makeTransaction({ date: '2026-06-02', amount: -100, merchant: 'Arcade' })
			],
			'category',
			'Groceries'
		);

		expect(merchants.map((group) => group.merchant)).toEqual(['Arcade', 'Zoo']);
	});

	it('says what each merchant is filed under now', () => {
		const { merchants } = drillInto(groceries, 'category', 'Groceries');

		expect(merchants.every((group) => group.category === 'Groceries')).toBe(true);
	});

	it('adds up to the drill-down it came from', () => {
		const drilldown = drillInto(groceries, 'category', 'Groceries');
		const grouped = drilldown.merchants.reduce((sum, group) => sum + group.total, 0);

		expect(grouped).toBe(drilldown.total);
		expect(drilldown.merchants.reduce((sum, group) => sum + group.count, 0)).toBe(
			drilldown.transactions.length
		);
	});

	it('is one group when the bar was a merchant to begin with', () => {
		const { merchants } = drillInto(groceries, 'merchant', 'Shop');

		expect(merchants).toHaveLength(1);
		expect(merchants[0]).toMatchObject({ merchant: 'Shop', total: 150 });
	});

	it('is empty when nothing is filed there', () => {
		expect(drillInto(groceries, 'category', 'Fuel').merchants).toEqual([]);
	});
});

describe('a drill-down after the reader re-files a merchant', () => {
	/**
	 * The dialog re-derives its rows from the current statement rather than from
	 * a snapshot taken on the click, so that re-filing from inside it moves the
	 * rows out from under itself — the same movement the bar behind it makes.
	 */
	const rows = [
		makeTransaction({ date: '2026-06-01', amount: -100, category: 'Groceries', merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-20', amount: -400, category: 'Groceries', merchant: 'Deli' })
	];
	const refiled = applyCategoryRules(rows, { Shop: 'Coffee' });

	it('drops the merchant from the category it left', () => {
		const drilldown = drillInto(refiled, 'category', 'Groceries');

		expect(drilldown.merchants.map((group) => group.merchant)).toEqual(['Deli']);
		expect(drilldown.total).toBe(400);
	});

	it('finds it under the category it was moved to', () => {
		expect(drillInto(refiled, 'category', 'Coffee').total).toBe(100);
	});

	it('leaves the merchant bar alone — only the filing moved', () => {
		expect(drillInto(refiled, 'merchant', 'Shop').total).toBe(100);
	});

	it('empties the category when its last merchant is re-filed', () => {
		const emptied = applyCategoryRules(rows, { Shop: 'Coffee', Deli: 'Coffee' });
		const drilldown = drillInto(emptied, 'category', 'Groceries');

		expect(drilldown.transactions).toEqual([]);
		expect(drilldown.total).toBe(0);
	});
});
