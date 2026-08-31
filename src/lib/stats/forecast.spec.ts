import { describe, expect, it } from 'vitest';
import { addedKey, buildForecast, listPayees, type AddedCharge } from './forecast.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/**
 * Two whole months behind a month in progress.
 *
 * The gym is a debit order, so one occurrence already evidences a commitment;
 * the shop swings 400 against 300 and stays everyday spending, which is what
 * keeps the two channels apart in every assertion below.
 */
function statement(extra: readonly Transaction[] = []): readonly Transaction[] {
	return [
		makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
		makeTransaction({ date: '2026-05-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-05-25', amount: -300, merchant: 'Shop' }),

		makeTransaction({ date: '2026-06-03', amount: -200, merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),

		makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
		makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' }),
		...extra
	];
}

/**
 * Eight complete months, two of them quiet and the rest spending 100 to 600
 * over the back of the month — so which months a window reads shows up in the
 * median it lands on.
 */
function ramp(): readonly Transaction[] {
	return [
		makeTransaction({ date: '2025-11-01', amount: -50, merchant: 'Shop' }),
		makeTransaction({ date: '2025-12-01', amount: -50, merchant: 'Shop' }),
		...['01', '02', '03', '04', '05', '06'].map((month, index) =>
			makeTransaction({ date: `2026-${month}-25`, amount: -100 * (index + 1), merchant: 'Shop' })
		),
		makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
	];
}

/** The same statement with a salary, for the metric that has a use for one. */
const SALARY: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-25', amount: 10_000, merchant: 'Employer', type: 'Salary' }),
	makeTransaction({ date: '2026-06-25', amount: 10_000, merchant: 'Employer', type: 'Salary' })
];

describe('buildForecast', () => {
	it('carries the month past the last row in the statement', () => {
		const forecast = buildForecast(statement(), { metric: 'out' });

		expect(forecast.month).toBe('2026-07');
		expect(forecast.elapsedDays).toBe(10);
		expect(forecast.length).toBe(31);
		expect(forecast.asOf).toBe('2026-07-10');
		expect(forecast.actual).toBe(150);
		expect(forecast.projected).toBe(850);
	});

	it('names the charges the history says are still to come', () => {
		const forecast = buildForecast(statement(), { metric: 'out' });

		expect(forecast.expected).toEqual([
			{
				key: 'expense:Gym',
				merchant: 'Gym',
				category: 'Groceries',
				amount: 500,
				flow: 'expense',
				day: 20,
				date: '2026-07-20',
				dueDate: '2026-07-20',
				seen: 2,
				overdue: false,
				isDebitOrder: true,
				source: 'history',
				included: true
			}
		]);
		expect(forecast.committed).toBe(500);
	});

	it('learns everyday spending from the same days of past months', () => {
		// Only what those months spent after the 10th: 300 in May, 100 in June.
		const forecast = buildForecast(statement(), { metric: 'out' });

		expect(forecast.everyday).toBe(200);
		expect(forecast.monthsOfHistory).toBe(2);
	});

	it('leaves the everyday channel out when the reader asks for the named charges alone', () => {
		const forecast = buildForecast(statement(), { metric: 'out', everyday: false });

		expect(forecast.everyday).toBe(0);
		// The gym alone, on top of what is banked — nothing spread over the days.
		expect(forecast.committed).toBe(500);
		expect(forecast.projected).toBe(650);
		expect(forecast.projected).toBe(forecast.actual + forecast.committed);
	});

	it('steps a named-charges-only line only on the days a charge lands', () => {
		const forecast = buildForecast(statement(), { metric: 'out', everyday: false });

		// Flat from the last banked day right up to the gym on the 20th.
		expect(forecast.points[9].total).toBe(150);
		expect(forecast.points[18].total).toBe(150);
		expect(forecast.points[19].total).toBe(650);
		expect(forecast.points.at(-1)?.total).toBe(650);
		// And no band: there is no everyday spending left to be uncertain about.
		expect(forecast.points.at(-1)?.low).toBe(650);
		expect(forecast.points.at(-1)?.high).toBe(650);
	});

	it('counts a charge that already went off this month once, not twice', () => {
		// The gym is banked in the actuals, so it is no longer expected — and its
		// past occurrences must still stay out of the everyday figure, or the same
		// R500 would be forecast on top of the R500 already spent.
		const forecast = buildForecast(
			statement([
				makeTransaction({ date: '2026-07-08', amount: -500, merchant: 'Gym', type: 'Debit order' })
			]),
			{ metric: 'out' }
		);

		expect(forecast.expected).toEqual([]);
		expect(forecast.committed).toBe(0);
		expect(forecast.actual).toBe(650);
		expect(forecast.everyday).toBe(200);
		expect(forecast.projected).toBe(850);
	});

	it('expects a charge that has missed its day on the next day left', () => {
		const early = [
			makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-05-05', amount: -500, merchant: 'Gym', type: 'Debit order' }),
			makeTransaction({ date: '2026-06-05', amount: -500, merchant: 'Gym', type: 'Debit order' }),
			makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
		];

		const forecast = buildForecast(early, { metric: 'out' });

		expect(forecast.expected).toHaveLength(1);
		expect(forecast.expected[0]).toMatchObject({
			merchant: 'Gym',
			overdue: true,
			day: 11,
			date: '2026-07-11',
			// Placed on the 11th, but the day it missed is the day it usually goes
			// off — the one the row has to be able to name.
			dueDate: '2026-07-05'
		});
	});

	it('draws banked days and projected days as one line', () => {
		const forecast = buildForecast(statement(), { metric: 'out' });

		expect(forecast.points).toHaveLength(31);
		expect(forecast.points[9]).toEqual({
			day: 10,
			total: 150,
			isProjected: false,
			low: 150,
			high: 150
		});
		// Nine of the twenty-one remaining days of everyday spending, and the gym
		// has not gone off yet.
		expect(forecast.points[18].total).toBeCloseTo(150 + (200 * 9) / 21, 2);
		expect(forecast.points[18].isProjected).toBe(true);
		// The day after it does.
		expect(forecast.points[19].total).toBeCloseTo(150 + 500 + (200 * 10) / 21, 2);
	});

	it('ends the line on exactly the figure the tiles show', () => {
		for (const metric of ['net', 'out', 'in'] as const) {
			const forecast = buildForecast(statement(SALARY), { metric });

			expect(forecast.points.at(-1)?.total).toBe(forecast.projected);
			expect(forecast.projected).toBe(
				Math.round((forecast.actual + forecast.committed + forecast.everyday) * 100) / 100
			);
		}
	});

	it('spreads the leanest and heaviest months either side of the projection', () => {
		const forecast = buildForecast(statement(), { metric: 'out' });
		const end = forecast.points.at(-1);

		expect(end?.low).toBe(750);
		expect(end?.high).toBe(950);
	});

	it('sets a freak month aside once there are months to spare', () => {
		// Six tails of 100, 200, 300, 400, 500 and 4 000. Keeping the last would
		// stretch the band until nothing else on the plot could be read.
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-01-01', amount: -50, merchant: 'Shop' }),
				...[100, 200, 300, 400, 500, 4000].map((amount, index) =>
					makeTransaction({
						date: `2026-0${index + 1}-25`,
						amount: -amount,
						merchant: 'Shop'
					})
				),
				makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
			],
			{ metric: 'out' }
		);
		const end = forecast.points.at(-1);

		expect(forecast.monthsOfHistory).toBe(6);
		expect(forecast.everyday).toBe(350);
		expect(end?.low).toBe(250);
		expect(end?.high).toBe(550);
	});

	it('lifts a net forecast by the salary the history expects', () => {
		const forecast = buildForecast(statement(SALARY), { metric: 'net' });

		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym', 'Employer']);
		// The gym pulls the line down and the salary lifts it.
		expect(forecast.committed).toBe(9500);
		expect(forecast.actual).toBe(-150);
		expect(forecast.everyday).toBe(-200);
		expect(forecast.projected).toBe(9150);
	});

	it('tells a money-out forecast nothing about the salary', () => {
		const forecast = buildForecast(statement(SALARY), { metric: 'out' });

		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym']);
		expect(forecast.projected).toBe(850);
	});

	it('forecasts money in from the salary alone', () => {
		const forecast = buildForecast(statement(SALARY), { metric: 'in' });

		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Employer']);
		expect(forecast.actual).toBe(0);
		expect(forecast.everyday).toBe(0);
		expect(forecast.projected).toBe(10_000);
	});

	it('projects nothing from a single unfinished month', () => {
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-07-04', amount: -150, merchant: 'Shop' }),
				makeTransaction({ date: '2026-07-09', amount: -50, merchant: 'Shop' })
			],
			{ metric: 'out' }
		);

		expect(forecast.monthsOfHistory).toBe(0);
		expect(forecast.expected).toEqual([]);
		expect(forecast.everyday).toBe(0);
		expect(forecast.projected).toBe(forecast.actual);
		expect(forecast.points.at(-1)).toEqual({
			day: 31,
			total: 200,
			isProjected: true,
			low: 200,
			high: 200
		});
	});

	it('drops a first month the statement opened part-way into', () => {
		// May's first row is on the 3rd, so May cannot say what a whole month costs.
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-05-03', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-05-25', amount: -300, merchant: 'Shop' }),
				makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-07-04', amount: -150, merchant: 'Shop' })
			],
			{ metric: 'out' }
		);

		expect(forecast.monthsOfHistory).toBe(1);
		expect(forecast.everyday).toBe(100);
	});

	it('stops expecting a charge that has stopped', () => {
		// The old subscription billed in March and April and has since gone quiet;
		// the gym has never missed. Two whole months of silence is a cancellation.
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-03-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({
					date: '2026-03-20',
					amount: -300,
					merchant: 'OldSub',
					type: 'Debit order'
				}),
				makeTransaction({
					date: '2026-04-20',
					amount: -300,
					merchant: 'OldSub',
					type: 'Debit order'
				}),
				...['03', '04', '05', '06'].flatMap((month) => [
					makeTransaction({
						date: `2026-${month}-20`,
						amount: -500,
						merchant: 'Gym',
						type: 'Debit order'
					}),
					makeTransaction({ date: `2026-${month}-25`, amount: -100, merchant: 'Shop' })
				]),
				makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
			],
			{ metric: 'out' }
		);

		expect(forecast.monthsOfHistory).toBe(4);
		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym']);
		// …and it is not quietly folded into the everyday figure either, which
		// would forecast the same cancelled subscription without naming it.
		expect(forecast.everyday).toBe(100);
		expect(forecast.projected).toBe(650);
	});

	it('narrows to the last three months when asked', () => {
		// The same eight months, read three deep: tails of 400, 500 and 600, so the
		// median is 500 rather than the 350 the six-month window gives.
		const forecast = buildForecast(ramp(), { metric: 'out', window: 3 });

		expect(forecast.monthsOfHistory).toBe(3);
		expect(forecast.monthsAvailable).toBe(8);
		expect(forecast.window).toBe(3);
		expect(forecast.everyday).toBe(500);
	});

	it('expects what a charge costs now rather than what it used to', () => {
		// The gym went from 100 to 200 half a year ago. Six months back, the middle
		// month still says 150; three months back says what it takes today.
		const history = [
			makeTransaction({ date: '2026-03-01', amount: -100, merchant: 'Shop' }),
			...['03', '04', '05'].map((month) =>
				makeTransaction({
					date: `2026-${month}-20`,
					amount: -100,
					merchant: 'Gym',
					type: 'Debit order'
				})
			),
			...['06', '07', '08'].map((month) =>
				makeTransaction({
					date: `2026-${month}-20`,
					amount: -200,
					merchant: 'Gym',
					type: 'Debit order'
				})
			),
			makeTransaction({ date: '2026-09-10', amount: -50, merchant: 'Shop' })
		];

		const wide = buildForecast(history, { metric: 'out', window: 6 });
		const narrow = buildForecast(history, { metric: 'out', window: 3 });

		expect(wide.monthsOfHistory).toBe(6);
		expect(wide.expected[0]).toMatchObject({ merchant: 'Gym', amount: 150, seen: 6, day: 20 });

		expect(narrow.monthsOfHistory).toBe(3);
		expect(narrow.expected[0]).toMatchObject({ merchant: 'Gym', amount: 200, seen: 3, day: 20 });
	});

	it('reads the recent months rather than the whole statement', () => {
		// Eight complete months behind it; only the last six are read, and their
		// tails run 100 to 600 — a median of 350 rather than the 250 that dragging
		// the two quiet months in would give.
		const forecast = buildForecast(ramp(), { metric: 'out' });

		expect(forecast.monthsOfHistory).toBe(6);
		expect(forecast.monthsAvailable).toBe(8);
		expect(forecast.everyday).toBe(350);
	});

	it('never expects a charge past the end of a shorter month', () => {
		// A debit order that bills on the 31st, forecast into a month of 30 days.
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-03-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-03-20', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-03-31', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-04-25', amount: -300, merchant: 'Shop' }),
				makeTransaction({ date: '2026-05-25', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-05-31', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-06-10', amount: -50, merchant: 'Shop' })
			],
			{ metric: 'out' }
		);

		expect(forecast.length).toBe(30);
		expect(forecast.expected[0]).toMatchObject({ merchant: 'Gym', day: 30, date: '2026-06-30' });
		// …and the line still ends on exactly the figure the tiles show, which it
		// could not if a payment landed on a day the month never reaches.
		expect(forecast.points.at(-1)?.total).toBe(forecast.projected);
		expect(forecast.projected).toBe(650);
	});

	it('stops counting a charge the reader says is not coming', () => {
		const forecast = buildForecast(statement(), { metric: 'out', excluded: ['expense:Gym'] });

		// Still on the list, and still says what the history says about it.
		expect(forecast.expected).toHaveLength(1);
		expect(forecast.expected[0]).toMatchObject({ merchant: 'Gym', amount: 500, included: false });

		// …but out of the total, off the line, and not folded into the everyday
		// figure either, which would forecast it without naming it.
		expect(forecast.committed).toBe(0);
		expect(forecast.everyday).toBe(200);
		expect(forecast.projected).toBe(350);
		expect(forecast.points.at(-1)?.total).toBe(350);
		// The day it would have landed on no longer steps the line.
		expect(forecast.points[19].total).toBeCloseTo(150 + (200 * 10) / 21, 2);
	});

	it('drops one side of a merchant that both charges and pays', () => {
		const forecast = buildForecast(statement(SALARY), {
			metric: 'net',
			excluded: ['expense:Gym']
		});

		expect(forecast.expected.map((payment) => [payment.key, payment.included])).toEqual([
			['expense:Gym', false],
			['income:Employer', true]
		]);
		expect(forecast.committed).toBe(10_000);
	});

	it('ignores a charge that has been ticked off and is no longer expected', () => {
		// The gym went off this month, so it is banked rather than expected — and a
		// stale exclusion for it must not reach back into anything.
		const forecast = buildForecast(
			statement([
				makeTransaction({ date: '2026-07-08', amount: -500, merchant: 'Gym', type: 'Debit order' })
			]),
			{ metric: 'out', excluded: ['expense:Gym'] }
		);

		expect(forecast.expected).toEqual([]);
		expect(forecast.actual).toBe(650);
		expect(forecast.projected).toBe(850);
	});

	it('expects a payee the reader vouches for, on its own history', () => {
		// The vet took 400 and then 300, which is too loose for the recurring test
		// to call it a commitment — but the reader knows it is one and says so.
		const rows = [
			makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-05-12', amount: -400, merchant: 'Vet' }),
			makeTransaction({ date: '2026-05-25', amount: -300, merchant: 'Shop' }),
			makeTransaction({ date: '2026-06-16', amount: -300, merchant: 'Vet' }),
			makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
		];
		const added: readonly AddedCharge[] = [{ kind: 'merchant', merchant: 'Vet', flow: 'expense' }];

		// Nothing to expect at all until the reader says otherwise.
		expect(buildForecast(rows, { metric: 'out' }).expected).toEqual([]);
		expect(buildForecast(rows, { metric: 'out' }).everyday).toBe(550);

		const forecast = buildForecast(rows, { metric: 'out', added });

		expect(forecast.expected[0]).toMatchObject({
			key: 'expense:Vet',
			source: 'added',
			// The middle billing month of the two, on the middle of its two days.
			amount: 350,
			day: 14,
			seen: 2
		});
		// …and its own past occurrences leave the everyday figure, or the same
		// money would be forecast twice.
		expect(forecast.everyday).toBe(200);
		expect(forecast.projected).toBe(600);
	});

	it('expects a charge with nothing behind it at all', () => {
		const added: readonly AddedCharge[] = [
			{
				kind: 'custom',
				id: 'r1',
				name: 'Rent',
				flow: 'expense',
				amount: 8000,
				day: 25,
				category: 'Housing'
			}
		];
		const forecast = buildForecast(statement(), { metric: 'out', added });

		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym', 'Rent']);
		expect(forecast.expected[1]).toMatchObject({
			key: 'custom:r1',
			source: 'added',
			amount: 8000,
			day: 25,
			date: '2026-07-25',
			seen: 0,
			category: 'Housing'
		});
		expect(forecast.committed).toBe(8500);
		expect(forecast.projected).toBe(8850);
	});

	it('replaces what the test found rather than expecting it twice', () => {
		const added: readonly AddedCharge[] = [{ kind: 'merchant', merchant: 'Gym', flow: 'expense' }];
		const forecast = buildForecast(statement(), { metric: 'out', added });

		expect(forecast.expected).toHaveLength(1);
		expect(forecast.expected[0]).toMatchObject({ merchant: 'Gym', source: 'added', amount: 500 });
		expect(forecast.committed).toBe(500);
	});

	it('does not expect an added payee that has already billed this month', () => {
		const added: readonly AddedCharge[] = [{ kind: 'merchant', merchant: 'Shop', flow: 'expense' }];
		const forecast = buildForecast(statement(), { metric: 'out', added });

		// The shop billed on the 4th and the 10th, so it is banked, not expected.
		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym']);
	});

	it('keeps an added charge off a metric that does not count its side', () => {
		const added: readonly AddedCharge[] = [
			{
				kind: 'custom',
				id: 'r1',
				name: 'Rent',
				flow: 'expense',
				amount: 8000,
				day: 25,
				category: 'Housing'
			}
		];

		expect(buildForecast(statement(), { metric: 'in', added }).expected).toEqual([]);
	});

	it('takes an added charge the reader has since ticked off out of the total', () => {
		const added: readonly AddedCharge[] = [
			{
				kind: 'custom',
				id: 'r1',
				name: 'Rent',
				flow: 'expense',
				amount: 8000,
				day: 25,
				category: 'Housing'
			}
		];
		const forecast = buildForecast(statement(), {
			metric: 'out',
			added,
			excluded: ['custom:r1']
		});

		expect(forecast.expected[1]).toMatchObject({ merchant: 'Rent', included: false });
		expect(forecast.committed).toBe(500);
	});

	it('says nothing it cannot find, rather than a figure it made up', () => {
		// A payee vouched for against a statement that has never seen it.
		const added: readonly AddedCharge[] = [
			{ kind: 'merchant', merchant: 'Nowhere', flow: 'expense' }
		];
		const forecast = buildForecast(statement(), { metric: 'out', added });

		expect(forecast.expected.find((payment) => payment.merchant === 'Nowhere')).toMatchObject({
			amount: 0,
			seen: 0
		});
		// Nothing to say, and so nothing added to the line either.
		expect(forecast.committed).toBe(500);
	});

	it('has nothing to project once the month is over', () => {
		const forecast = buildForecast(
			statement([makeTransaction({ date: '2026-07-31', amount: -50, merchant: 'Shop' })]),
			{ metric: 'out' }
		);

		expect(forecast.isComplete).toBe(true);
		expect(forecast.elapsedDays).toBe(31);
		expect(forecast.expected).toEqual([]);
		expect(forecast.everyday).toBe(0);
		expect(forecast.projected).toBe(forecast.actual);
		expect(forecast.points.every((point) => !point.isProjected)).toBe(true);
	});

	it('follows months that open on a day of the reader’s choosing', () => {
		// Cycles run from the 25th, so "2026-08" is 25 July to 24 August.
		const forecast = buildForecast(
			[
				makeTransaction({ date: '2026-05-25', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-05-28', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-06-28', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-07-20', amount: -400, merchant: 'Shop' }),
				makeTransaction({ date: '2026-07-26', amount: -50, merchant: 'Shop' })
			],
			{ metric: 'out', monthStart: 25 }
		);

		expect(forecast.month).toBe('2026-08');
		expect(forecast.length).toBe(31);
		expect(forecast.elapsedDays).toBe(2);
		expect(forecast.monthsOfHistory).toBe(2);
		expect(forecast.expected[0]).toMatchObject({ merchant: 'Gym', day: 4, date: '2026-07-28' });
		expect(forecast.everyday).toBe(200);
		expect(forecast.projected).toBe(750);
	});

	it('forecasts the month it is asked for', () => {
		const forecast = buildForecast(statement(), { metric: 'out', month: '2026-06' });

		expect(forecast.month).toBe('2026-06');
		expect(forecast.isComplete).toBe(true);
		expect(forecast.actual).toBe(800);
	});

	it('has nothing to say before a statement is loaded', () => {
		const forecast = buildForecast([]);

		expect(forecast.month).toBe('');
		expect(forecast.points).toEqual([]);
		expect(forecast.projected).toBe(0);
	});
});

describe('addedKey', () => {
	it('gives a vouched-for payee the key the test would have given it', () => {
		expect(addedKey({ kind: 'merchant', merchant: 'Gym', flow: 'expense' })).toBe('expense:Gym');
	});

	it('keys a charge of the reader’s own by its id, so it can be renamed', () => {
		const charge: AddedCharge = {
			kind: 'custom',
			id: 'r1',
			name: 'Rent',
			flow: 'expense',
			amount: 8000,
			day: 25,
			category: 'Housing'
		};

		expect(addedKey(charge)).toBe('custom:r1');
		expect(addedKey({ ...charge, name: 'Rent (new place)' })).toBe('custom:r1');
	});
});

describe('what last month offers', () => {
	/**
	 * Two whole months, and a July that stops on the 10th. The gym repeats; the
	 * vet and the shop do not, and the shop has already billed this month.
	 */
	function rows(): readonly Transaction[] {
		return [
			makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-05-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
			makeTransaction({ date: '2026-06-03', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' }),
			makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
			makeTransaction({ date: '2026-06-22', amount: 900, merchant: 'Refund' }),
			makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
			makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
		];
	}

	it('offers every payee last month had, and counts none of them', () => {
		const forecast = buildForecast(rows(), { metric: 'net' });

		expect(forecast.candidates.map((payment) => payment.merchant)).toEqual(['Refund', 'Vet']);
		expect(forecast.candidates.every((payment) => !payment.included)).toBe(true);
		expect(forecast.candidates.every((payment) => payment.source === 'candidate')).toBe(true);
		// Offered, so nothing they would add is added.
		expect(forecast.committed).toBe(-500);
	});

	it('leaves out what the projection already counts', () => {
		const forecast = buildForecast(rows(), { metric: 'net' });

		expect(forecast.expected.map((payment) => payment.merchant)).toEqual(['Gym']);
		expect(forecast.candidates.map((payment) => payment.merchant)).not.toContain('Gym');
	});

	it('leaves out a payee this month has already seen', () => {
		// The shop is in June and in July, so it is banked rather than offered —
		// a tick that could change nothing is worse than no row at all.
		expect(
			buildForecast(rows(), { metric: 'net' }).candidates.map((payment) => payment.merchant)
		).not.toContain('Shop');
	});

	it('reads a candidate exactly as ticking it would', () => {
		const offered = buildForecast(rows(), { metric: 'net' }).candidates.find(
			(payment) => payment.merchant === 'Vet'
		);
		const ticked = buildForecast(rows(), {
			metric: 'net',
			added: [{ kind: 'merchant', merchant: 'Vet', flow: 'expense' }]
		}).expected.find((payment) => payment.merchant === 'Vet');

		expect(offered?.amount).toBe(400);
		expect(offered?.amount).toBe(ticked?.amount);
		expect(offered?.date).toBe(ticked?.date);
	});

	it('offers only the side of the money the metric counts', () => {
		expect(
			buildForecast(rows(), { metric: 'out' }).candidates.map((payment) => payment.merchant)
		).toEqual(['Vet']);
		expect(
			buildForecast(rows(), { metric: 'in' }).candidates.map((payment) => payment.merchant)
		).toEqual(['Refund']);
	});

	it('offers from whichever month it is asked for', () => {
		const forecast = buildForecast(rows(), { metric: 'net', candidateMonth: '2026-05' });

		expect(forecast.candidateMonth).toBe('2026-05');
		// May had the shop and the gym; the shop has been seen this month and the
		// gym is counted above, so May has nothing left to offer.
		expect(forecast.candidates).toEqual([]);
	});

	it('offers every complete month behind this one, not just the window', () => {
		// A quarterly bill last paid in March is exactly what a reader goes
		// looking for, and the six-month window is not what bounds the question.
		const forecast = buildForecast(rows(), { metric: 'net' });

		expect(forecast.candidateMonths).toEqual(['2026-05', '2026-06']);
	});

	it('falls back to the last whole month for one this account never had', () => {
		const forecast = buildForecast(rows(), { metric: 'net', candidateMonth: '2019-01' });

		expect(forecast.candidateMonth).toBe('2026-06');
		expect(forecast.candidates.map((payment) => payment.merchant)).toEqual(['Refund', 'Vet']);
	});

	it('keeps the month it is on even when that month has nothing left', () => {
		// The picker's own value, or finding nothing would take the way back out
		// along with it.
		const forecast = buildForecast(rows(), { metric: 'net', candidateMonth: '2026-05' });

		expect(forecast.candidates).toEqual([]);
		expect(forecast.candidateMonth).toBe('2026-05');
		expect(forecast.candidateMonths).toContain('2026-06');
	});

	it('offers nothing once the month is over', () => {
		const forecast = buildForecast(
			[...rows(), makeTransaction({ date: '2026-07-31', amount: -50, merchant: 'Shop' })],
			{ metric: 'net' }
		);

		expect(forecast.isComplete).toBe(true);
		expect(forecast.candidates).toEqual([]);
		expect(forecast.candidateMonths).toEqual([]);
	});

	it('offers nothing when there is no whole month behind this one', () => {
		expect(
			buildForecast([makeTransaction({ date: '2026-07-04', amount: -150, merchant: 'Shop' })])
				.candidates
		).toEqual([]);
	});
});

describe('listPayees', () => {
	it('offers every payee the statement has, heaviest first', () => {
		expect(listPayees(statement(SALARY))).toEqual([
			{ merchant: 'Employer', flow: 'income', amount: 10_000, months: 2, arrived: false },
			{ merchant: 'Gym', flow: 'expense', amount: 500, months: 2, arrived: false },
			// May cost 400 and June 300, so the middle billing month is 350 — and
			// the shop has already billed in July, the month being forecast.
			{ merchant: 'Shop', flow: 'expense', amount: 350, months: 2, arrived: true }
		]);
	});

	it('reads a payee exactly as vouching for it would', () => {
		// August, so the shop has not billed yet and is expected rather than
		// banked — and both readings are made of the same months.
		const month = '2026-08';
		const added: readonly AddedCharge[] = [{ kind: 'merchant', merchant: 'Shop', flow: 'expense' }];

		const payee = listPayees(statement(), { month }).find((option) => option.merchant === 'Shop');
		const expected = buildForecast(statement(), { metric: 'out', month, added }).expected.find(
			(payment) => payment.merchant === 'Shop'
		);

		expect(payee?.amount).toBe(expected?.amount);
		expect(payee?.amount).toBe(300);
	});

	it('leaves out the month being forecast, which is not evidence yet', () => {
		// July's rows are the month in progress. A payee only July has ever seen
		// has no complete month behind it and nothing to be expected for.
		const payees = listPayees([
			...statement(),
			makeTransaction({ date: '2026-07-06', amount: -80, merchant: 'New shop' })
		]);

		expect(payees.map((payee) => payee.merchant)).not.toContain('New shop');
	});

	it('offers a payee the window itself cannot see', () => {
		// The window is what the forecast learns from, not what the reader is
		// allowed to name: a payee that last billed in January is exactly the kind
		// the test missed, and vouching for it is the way back in. Its figures
		// come from what there is.
		const rows = [
			makeTransaction({ date: '2026-01-01', amount: -50, merchant: 'Shop' }),
			makeTransaction({ date: '2026-01-20', amount: -900, merchant: 'Old' }),
			...['02', '03', '04', '05', '06'].map((month) =>
				makeTransaction({ date: `2026-${month}-20`, amount: -100, merchant: 'Shop' })
			),
			makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
		];

		for (const window of [3, 6] as const) {
			expect(listPayees(rows, { window }).find((payee) => payee.merchant === 'Old')).toEqual({
				merchant: 'Old',
				flow: 'expense',
				amount: 900,
				months: 1,
				arrived: false
			});
		}
	});

	it('has nothing to offer before a statement is loaded', () => {
		expect(listPayees([])).toEqual([]);
	});
});

describe('everydayShares', () => {
	/**
	 * Two whole months of untracked spending across two categories, then a month
	 * in progress. Neither merchant holds still enough to be called recurring, so
	 * both stay in the everyday channel where the shares are learned.
	 */
	function spread(extra: readonly Transaction[] = []): readonly Transaction[] {
		return [
			// Each whole month opens on its first day, or the older one is dropped as
			// partial. Everything the shares are learned from sits past the 2nd —
			// the day the month in progress stops — since that is the tail the
			// forecast reads.
			makeTransaction({ date: '2026-05-01', amount: -10, merchant: 'Open', category: 'Fees' }),
			makeTransaction({
				date: '2026-05-15',
				amount: -100,
				merchant: 'Shop',
				category: 'Groceries'
			}),
			makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe', category: 'Coffee' }),

			makeTransaction({ date: '2026-06-01', amount: -10, merchant: 'Open', category: 'Fees' }),
			makeTransaction({
				date: '2026-06-15',
				amount: -140,
				merchant: 'Shop',
				category: 'Groceries'
			}),
			makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe', category: 'Coffee' }),

			makeTransaction({ date: '2026-07-02', amount: -50, merchant: 'Shop', category: 'Groceries' }),
			...extra
		];
	}

	it('divides the everyday figure by where the history spent it', () => {
		const forecast = buildForecast(spread(), { metric: 'net' });
		const shares = Object.fromEntries(
			forecast.everydayShares.map((row) => [row.category, row.share])
		);

		// Past the 2nd, the two whole months left 160 on coffee and 240 on
		// groceries — so groceries takes the larger slice of what is still to go.
		expect(shares.Groceries).toBeCloseTo(240 / 400, 10);
		expect(shares.Coffee).toBeCloseTo(160 / 400, 10);
	});

	it('sums to one, heaviest first', () => {
		const forecast = buildForecast(spread(), { metric: 'net' });

		const total = forecast.everydayShares.reduce((running, row) => running + row.share, 0);

		expect(total).toBeCloseTo(1, 10);
		expect(forecast.everydayShares.map((row) => row.category)).toEqual(['Groceries', 'Coffee']);
	});

	it('leaves out the charges the committed channel already names', () => {
		// The gym is a debit order, so it is a named charge — counting it here as
		// well would forecast the same money twice, once by name and once by
		// average.
		const withGym = spread([
			makeTransaction({
				date: '2026-05-10',
				amount: -300,
				merchant: 'Gym',
				category: 'Gym',
				type: 'Debit order'
			}),
			makeTransaction({
				date: '2026-06-10',
				amount: -300,
				merchant: 'Gym',
				category: 'Gym',
				type: 'Debit order'
			})
		]);
		const forecast = buildForecast(withGym, { metric: 'net' });

		expect(forecast.everydayShares.map((row) => row.category)).not.toContain('Gym');
	});

	it('reads the spending alone, so a refund cannot take a negative slice', () => {
		// A category refunded more than it charged is net positive over the window.
		// That belongs in the median it moves, but not in a list of what is left to
		// spend — a negative share is an artefact, not a reading.
		const refunded = spread([
			makeTransaction({ date: '2026-05-21', amount: 500, merchant: 'Cafe', category: 'Coffee' })
		]);
		const forecast = buildForecast(refunded, { metric: 'net' });

		for (const row of forecast.everydayShares) expect(row.share).toBeGreaterThan(0);
	});

	it('has no shares where it has no everyday figure', () => {
		// Asked for the named charges alone, there is no everyday channel to divide.
		expect(buildForecast(spread(), { metric: 'net', everyday: false }).everydayShares).toEqual([]);
		expect(buildForecast([], { metric: 'net' }).everydayShares).toEqual([]);
	});
});
