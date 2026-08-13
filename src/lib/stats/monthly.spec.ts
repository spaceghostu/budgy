import { describe, expect, it } from 'vitest';
import { buildMonthlyTotals, listMonths, monthEnd, typicalMonth } from './monthly.ts';
import { makeTransaction } from '../testing/transaction.ts';

describe('listMonths', () => {
	it('lists the distinct months a statement touches, oldest first', () => {
		expect(
			listMonths([
				makeTransaction({ date: '2026-07-15', amount: -100 }),
				makeTransaction({ date: '2026-06-02', amount: -100 }),
				makeTransaction({ date: '2026-07-01', amount: -100 })
			])
		).toEqual(['2026-06', '2026-07']);
	});

	it('is empty before a statement is loaded', () => {
		expect(listMonths([])).toEqual([]);
	});
});

describe('monthEnd', () => {
	it('knows how long each month is', () => {
		expect(monthEnd('2026-01')).toBe('2026-01-31');
		expect(monthEnd('2026-04')).toBe('2026-04-30');
		expect(monthEnd('2026-02')).toBe('2026-02-28');
	});

	it('knows about leap years', () => {
		expect(monthEnd('2024-02')).toBe('2024-02-29');
	});
});

describe('buildMonthlyTotals', () => {
	it('accumulates the month day by day', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: 1000 }),
			makeTransaction({ date: '2026-06-02', amount: -200 }),
			makeTransaction({ date: '2026-06-03', amount: -300 })
		]);

		expect(series).toHaveLength(1);
		expect(series[0].month).toBe('2026-06');
		expect(series[0].points.slice(0, 3)).toEqual([
			{ day: 1, total: 1000 },
			{ day: 2, total: 800 },
			{ day: 3, total: 500 }
		]);
	});

	it('holds the total across days with no transactions', () => {
		// A quiet day is not a gap in the line — the total simply did not move.
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -100 }),
			makeTransaction({ date: '2026-06-04', amount: -100 }),
			makeTransaction({ date: '2026-07-01', amount: -1 })
		]);

		expect(series[0].points.slice(0, 4).map((point) => point.total)).toEqual([
			-100, -100, -100, -200
		]);
		// …and keeps holding it to the end of the month.
		expect(series[0].points.at(-1)).toEqual({ day: 30, total: -200 });
	});

	it('gives each month its own line, reset to zero at the first', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-30', amount: -900 }),
			makeTransaction({ date: '2026-07-01', amount: -100 })
		]);

		expect(series.map((month) => month.month)).toEqual(['2026-06', '2026-07']);
		expect(series[1].points).toEqual([{ day: 1, total: -100 }]);
	});

	it('leaves transfers out — they move money, they do not spend it', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -500, flow: 'transfer' }),
			makeTransaction({ date: '2026-06-02', amount: -100 })
		]);

		expect(series[0].points).toEqual([
			{ day: 1, total: 0 },
			{ day: 2, total: -100 }
		]);
	});

	it('runs a finished month to its last day', () => {
		// July continues the statement, so June is known all the way to the 30th.
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-05', amount: -100 }),
			makeTransaction({ date: '2026-07-02', amount: -100 })
		]);

		expect(series[0].points).toHaveLength(30);
		expect(series[0].points.at(-1)).toEqual({ day: 30, total: -100 });
	});

	it('stops the newest month where the data stops', () => {
		// Otherwise the line flatlines to the 31st and reads as "spending stopped".
		const series = buildMonthlyTotals([makeTransaction({ date: '2026-07-09', amount: -100 })]);

		expect(series[0].points).toHaveLength(9);
		expect(series[0].points.at(-1)).toEqual({ day: 9, total: -100 });
	});

	it('carries the closing total for the month', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: 2000 }),
			makeTransaction({ date: '2026-06-20', amount: -750 })
		]);

		expect(series[0].total).toBe(1250);
	});

	it('marks a newest month the statement has not finished', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -100 }),
			makeTransaction({ date: '2026-07-09', amount: -100 })
		]);

		expect(series[0].isPartial).toBe(false);
		expect(series[1].isPartial).toBe(true);
	});

	it('marks an oldest month the statement opens part-way into', () => {
		// A statement starting on the 15th knows nothing about the 1st to the 14th.
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-15', amount: -100 }),
			makeTransaction({ date: '2026-07-31', amount: -100 })
		]);

		expect(series[0].isPartial).toBe(true);
		expect(series[1].isPartial).toBe(false);
	});

	it('cannot tell a late opening from a quiet first, and says so by erring towards partial', () => {
		// Flagging a quiet 1st costs a hedged footnote; missing a statement that
		// opened on the 15th would draw two silent weeks of no spending.
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-02', amount: -100 }),
			makeTransaction({ date: '2026-07-31', amount: -100 })
		]);

		expect(series[0].isPartial).toBe(true);
	});

	it('leaves a middle month alone — only the ends of a statement are in doubt', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -100 }),
			makeTransaction({ date: '2026-07-20', amount: -100 }),
			makeTransaction({ date: '2026-08-31', amount: -100 })
		]);

		expect(series.map((month) => month.isPartial)).toEqual([false, false, false]);
	});

	it('settles floating-point drift to cents', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -0.1 }),
			makeTransaction({ date: '2026-06-02', amount: -0.2 })
		]);

		expect(series[0].points.at(-1)?.total).toBe(-0.3);
	});

	it('is empty before a statement is loaded', () => {
		expect(buildMonthlyTotals([])).toEqual([]);
	});

	describe('metric', () => {
		const month = [
			makeTransaction({ date: '2026-06-01', amount: 5000 }),
			makeTransaction({ date: '2026-06-02', amount: -300 }),
			makeTransaction({ date: '2026-06-03', amount: -200, flow: 'transfer' })
		];

		it('nets the two sides by default', () => {
			expect(buildMonthlyTotals(month).at(0)?.total).toBe(4700);
		});

		it('climbs as spending accumulates, so more spent reads as higher', () => {
			const series = buildMonthlyTotals(month, 'out');

			expect(series[0].points.slice(0, 3)).toEqual([
				{ day: 1, total: 0 },
				{ day: 2, total: 300 },
				{ day: 3, total: 300 }
			]);
		});

		it('accumulates income on its own', () => {
			const series = buildMonthlyTotals(month, 'in');

			expect(series[0].points.slice(0, 2)).toEqual([
				{ day: 1, total: 5000 },
				{ day: 2, total: 5000 }
			]);
		});

		it('leaves transfers out whichever side is being counted', () => {
			expect(buildMonthlyTotals(month, 'out').at(0)?.total).toBe(300);
			expect(buildMonthlyTotals(month, 'in').at(0)?.total).toBe(5000);
		});
	});

	it('keeps a month whose only movement was a transfer, as a flat line', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-10', amount: -500, flow: 'transfer' })
		]);

		expect(series[0].points).toEqual(
			Array.from({ length: 10 }, (_, index) => ({ day: index + 1, total: 0 }))
		);
	});
});

describe('typicalMonth', () => {
	/** Three months, so day 1 has a clear middle value. */
	const threeMonths = buildMonthlyTotals([
		makeTransaction({ date: '2026-06-01', amount: -100 }),
		makeTransaction({ date: '2026-07-01', amount: -500 }),
		makeTransaction({ date: '2026-08-01', amount: -300 })
	]);

	it('takes the middle month day by day, not the average', () => {
		// A single ruinous month would drag a mean somewhere no month ever went.
		expect(typicalMonth(threeMonths)[0]).toEqual({ day: 1, total: -300 });
	});

	it('averages the two middle months when there is an even number', () => {
		const series = buildMonthlyTotals([
			makeTransaction({ date: '2026-06-01', amount: -100 }),
			makeTransaction({ date: '2026-07-01', amount: -300 })
		]);

		expect(typicalMonth(series)[0]).toEqual({ day: 1, total: -200 });
	});

	it('runs as far as the longest month drawn', () => {
		expect(typicalMonth(threeMonths).at(-1)?.day).toBe(31);
	});

	it('counts only the months that reach a given day', () => {
		// August stops on the 1st, so from the 2nd the middle is June and July.
		const [june, july] = [threeMonths[0], threeMonths[1]];
		const onSecond = typicalMonth(threeMonths)[1];

		expect(onSecond.total).toBe((june.points[1].total + july.points[1].total) / 2);
	});

	it('is empty when there is nothing to be typical of', () => {
		expect(typicalMonth([])).toEqual([]);
	});
});
