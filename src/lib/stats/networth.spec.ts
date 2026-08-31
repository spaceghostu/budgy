import { describe, expect, it } from 'vitest';
import { buildNetWorth, monthsCovered, netWorthByMonth, sliceNetWorth } from './networth.ts';
import { makeTransaction } from '../testing/transaction.ts';

/** Two accounts, each with the balance the bank printed beside every row. */
const certified = [
	makeTransaction({ date: '2026-06-01', amount: -100, account: 'Cheque', balance: 900 }),
	makeTransaction({ date: '2026-06-02', amount: -200, account: 'Savings', balance: 4800 }),
	makeTransaction({ date: '2026-06-03', amount: -300, account: 'Cheque', balance: 600 })
];

describe('buildNetWorth', () => {
	it('adds every account up on each day the statement moved', () => {
		const worth = buildNetWorth(certified);

		expect(worth.days.map(({ date, total }) => ({ date, total }))).toEqual([
			{ date: '2026-06-01', total: 5900 },
			{ date: '2026-06-02', total: 5700 },
			{ date: '2026-06-03', total: 5400 }
		]);
		expect(worth.total).toBe(5400);
	});

	it('holds an account at its last balance through days it did not move', () => {
		const worth = buildNetWorth(certified);

		// Savings did not move on the 3rd, so the whole fall is the cheque account.
		expect(worth.days[2].total - worth.days[1].total).toBe(-300);
	});

	it('counts an account before its first transaction, at the balance it opened on', () => {
		const worth = buildNetWorth([
			makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque', balance: 900 }),
			makeTransaction({ date: '2026-07-04', amount: -200, account: 'Savings', balance: 4800 })
		]);

		// Savings was worth 5,000 in June — it was simply quiet, not absent.
		expect(worth.opening).toBe(6000);
		expect(worth.days[0].total).toBe(5900);
		expect(worth.days[0].timestamp).toBe(new Date('2026-06-10T00:00:00').getTime());
	});

	it('takes an entered balance for an account the bank printed none for', () => {
		const worth = buildNetWorth(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, account: 'Cheque' }),
				makeTransaction({ date: '2026-06-02', amount: -50, account: 'Savings' })
			],
			{ Cheque: 400, Savings: 950 }
		);

		expect(worth.days.map(({ date, total }) => ({ date, total }))).toEqual([
			{ date: '2026-06-01', total: 1400 },
			{ date: '2026-06-02', total: 1350 }
		]);
		expect(worth.isRelative).toBe(false);
		expect(worth.unanchored).toEqual([]);
	});

	it('names the accounts with no balance, and says the total is a shape', () => {
		const worth = buildNetWorth(
			[
				makeTransaction({ date: '2026-06-01', amount: -100, account: 'Cheque' }),
				makeTransaction({ date: '2026-06-02', amount: -50, account: 'Savings' })
			],
			{ Cheque: 400 }
		);

		expect(worth.unanchored).toEqual(['Savings']);
		expect(worth.isRelative).toBe(true);
	});

	it('reads a certified account as needing no balance entered', () => {
		const worth = buildNetWorth(certified);

		expect(worth.isRelative).toBe(false);
		expect(worth.accounts).toEqual([
			{ account: 'Cheque', isCertified: true, isAnchored: true, closing: 600 },
			{ account: 'Savings', isCertified: true, isAnchored: true, closing: 4800 }
		]);
	});

	it('is empty before a statement is loaded', () => {
		const worth = buildNetWorth([]);

		expect(worth.days).toEqual([]);
		expect(worth.accounts).toEqual([]);
		expect(worth.total).toBe(0);
		expect(worth.isRelative).toBe(false);
	});
});

describe('netWorthByMonth', () => {
	/** June and August moved; July did not, and is still a month worth drawing. */
	const quiet = buildNetWorth([
		makeTransaction({ date: '2026-06-30', amount: -100, account: 'Cheque', balance: 900 }),
		makeTransaction({ date: '2026-08-01', amount: -100, account: 'Cheque', balance: 800 })
	]);

	it('draws a month nothing happened in', () => {
		const months = netWorthByMonth(quiet);

		expect(months.map((month) => month.month)).toEqual(['2026-06', '2026-07', '2026-08']);

		const july = months[1];
		expect(july.points).toHaveLength(31);
		expect(july.points.every((point) => point.total === 900)).toBe(true);
		expect(july.isPartial).toBe(false);
	});

	it('opens the first month at the balance it started with, from the 1st', () => {
		const [june] = netWorthByMonth(quiet);

		expect(june.points[0]).toEqual({ day: 1, total: 1000 });
		expect(june.points).toHaveLength(30);
		expect(june.total).toBe(900);
		// The opening balance is known, so no day of it is guesswork.
		expect(june.isPartial).toBe(false);
	});

	it('opens each later month where the one before it closed', () => {
		const months = netWorthByMonth(quiet);

		expect(months[1].points[0]).toEqual({ day: 1, total: 900 });
		expect(months[2].points[0]).toEqual({ day: 1, total: 800 });
	});

	it('stops the newest month where the statement does', () => {
		const august = netWorthByMonth(quiet).at(-1);

		expect(august?.points).toHaveLength(1);
		expect(august?.isPartial).toBe(true);
	});

	it('carries a history over the turn of the year', () => {
		const months = netWorthByMonth(
			buildNetWorth([
				makeTransaction({ date: '2026-11-20', amount: -100, account: 'Cheque', balance: 900 }),
				makeTransaction({ date: '2027-01-15', amount: -400, account: 'Cheque', balance: 500 })
			])
		);

		expect(months.map((month) => month.month)).toEqual(['2026-11', '2026-12', '2027-01']);
		expect(months[1].points.at(-1)).toEqual({ day: 31, total: 900 });
	});

	it('is empty before a statement is loaded', () => {
		expect(netWorthByMonth(buildNetWorth([]))).toEqual([]);
	});
});

describe('sliceNetWorth', () => {
	/** Four months of one account, one movement in each. */
	const history = buildNetWorth([
		makeTransaction({ date: '2026-05-10', amount: -100, account: 'Cheque', balance: 900 }),
		makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque', balance: 800 }),
		makeTransaction({ date: '2026-07-10', amount: -100, account: 'Cheque', balance: 700 }),
		makeTransaction({ date: '2026-08-10', amount: -100, account: 'Cheque', balance: 600 })
	]);

	it('keeps the whole history when no period is chosen', () => {
		expect(sliceNetWorth(history, null)).toEqual({
			days: history.days,
			opening: history.opening
		});
	});

	it('counts back in calendar months from the newest one', () => {
		const window = sliceNetWorth(history, 2);

		expect(window.days.map((day) => day.date)).toEqual(['2026-07-10', '2026-08-10']);
	});

	it('opens the window at the level the money was already at', () => {
		const window = sliceNetWorth(history, 2);

		// June closed at 800; July does not start the reader back at zero.
		expect(window.opening).toBe(800);
	});

	it('gives back the whole history for a window longer than it', () => {
		expect(sliceNetWorth(history, 24)).toEqual({
			days: history.days,
			opening: history.opening
		});
	});

	it('is empty before a statement is loaded', () => {
		expect(sliceNetWorth(buildNetWorth([]), 3)).toEqual({ days: [], opening: 0 });
	});
});

describe('monthsCovered', () => {
	it('counts both ends of the history', () => {
		expect(
			monthsCovered(
				buildNetWorth([
					makeTransaction({ date: '2026-11-20', amount: -100, account: 'Cheque', balance: 900 }),
					makeTransaction({ date: '2027-01-15', amount: -400, account: 'Cheque', balance: 500 })
				])
			)
		).toBe(3);
	});

	it('is nothing before a statement is loaded', () => {
		expect(monthsCovered(buildNetWorth([]))).toBe(0);
	});
});

describe('a net worth cut into months that open on a chosen day', () => {
	/** Paid on the 25th, so a month runs from the 25th to the 24th. */
	const worth = buildNetWorth([
		makeTransaction({ date: '2026-05-20', amount: -100, account: 'Cheque', balance: 900 }),
		makeTransaction({ date: '2026-05-26', amount: -100, account: 'Cheque', balance: 800 }),
		makeTransaction({ date: '2026-07-02', amount: -100, account: 'Cheque', balance: 700 })
	]);

	it('names each line after the month most of it falls in', () => {
		expect(netWorthByMonth(worth, 25).map((month) => month.month)).toEqual([
			'2026-05',
			'2026-06',
			'2026-07'
		]);
	});

	it('opens each line on the chosen day, at the level the last one closed at', () => {
		const [may, june] = netWorthByMonth(worth, 25);

		// May's cycle is 25 April to 24 May: the 20th is its 26th day.
		expect(may.points[25]).toEqual({ day: 26, total: 900 });
		// June's opens on 25 May at what May closed at, and drops the next day.
		expect(june.points[0]).toEqual({ day: 1, total: 900 });
		expect(june.points[1]).toEqual({ day: 2, total: 800 });
		expect(june.points).toHaveLength(31);
	});

	it('stops the newest line where the statement does, counted in cycle days', () => {
		const july = netWorthByMonth(worth, 25).at(-1);

		// July's cycle opened on 25 June; the statement stops on 2 July.
		expect(july?.points).toHaveLength(8);
		expect(july?.total).toBe(700);
		expect(july?.isPartial).toBe(true);
	});

	it('counts a window back in the reader’s months, not the calendar’s', () => {
		const window = sliceNetWorth(worth, 2, 25);

		// Two months back from July's cycle opens on 25 May.
		expect(window.days.map((day) => day.date)).toEqual(['2026-05-26', '2026-07-02']);
		expect(window.opening).toBe(900);
	});

	it('counts how many of the reader’s months the history covers', () => {
		expect(monthsCovered(worth, 25)).toBe(3);
	});
});
