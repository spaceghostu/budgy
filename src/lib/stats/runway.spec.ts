import { describe, expect, it } from 'vitest';
import { buildForecast } from './forecast.ts';
import { buildRunway } from './runway.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/**
 * Two whole months behind a month in progress, built so that exactly one charge
 * is committed and the rest is everyday spending.
 *
 * The gym is a debit order, so it qualifies on one occurrence and lands on the
 * 10th for 300. The shop swings 100 against 140 and the cafe 60 against 100 —
 * both too far to read as a fixed price — so they stay in the everyday channel,
 * where the runway's drift comes from. Both whole months open on their first
 * day, or the forecast would drop the older one as partial.
 */
function statement(extra: readonly Transaction[] = []): readonly Transaction[] {
	return [
		makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
		makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe' }),

		makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe' }),

		makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop' }),
		...extra
	];
}

/**
 * The forecast the runway is read from. Always net: a balance is what is left
 * after both sides of the money, and there is no other way to add it up.
 */
function forecastOf(
	transactions: readonly Transaction[] = statement(),
	options: Parameters<typeof buildForecast>[1] = {}
) {
	return buildForecast(transactions, { metric: 'net', ...options });
}

describe('buildRunway', () => {
	it('runs from the day the statement stops to the day before payday', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });

		expect(runway.from).toBe('2026-07-05');
		expect(runway.to).toBe('2026-07-31');
		expect(runway.payday).toBe('2026-08-01');
		expect(runway.daysLeft).toBe(26);
		// One point for today, then one for every day left to project.
		expect(runway.days).toHaveLength(27);
		expect(runway.days[0].date).toBe('2026-07-05');
		expect(runway.days.at(-1)?.date).toBe('2026-07-31');
	});

	it('opens at the balance it was given, not at zero', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });

		expect(runway.opening).toBe(5000);
		expect(runway.days[0].balance).toBe(5000);
		// Today is banked, so there is nothing to be uncertain about yet.
		expect(runway.days[0].isProjected).toBe(false);
		expect(runway.days[0].low).toBe(5000);
		expect(runway.days[0].high).toBe(5000);
	});

	it('steps down on the day a committed charge lands', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });

		const ninth = runway.days.find((day) => day.date === '2026-07-09');
		const tenth = runway.days.find((day) => day.date === '2026-07-10');

		expect(ninth?.payments).toHaveLength(0);
		expect(tenth?.payments.map((payment) => payment.merchant)).toEqual(['Gym']);
		// The 300 debit order, on top of one more day of everyday drift.
		expect((ninth?.balance ?? 0) - (tenth?.balance ?? 0)).toBeCloseTo(303.07, 2);
	});

	it('spreads the everyday figure evenly over the days that are left', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });

		// 80 a month of everyday spending over 26 days left: 3.08 a day, and no
		// named charge before the 10th to interrupt it.
		const sixth = runway.days.find((day) => day.date === '2026-07-06');
		const seventh = runway.days.find((day) => day.date === '2026-07-07');

		expect(sixth?.balance).toBeCloseTo(4996.92, 2);
		expect(seventh?.balance).toBeCloseTo(4993.85, 2);
	});

	it('closes where the forecast says the month ends', () => {
		const forecast = forecastOf();
		const runway = buildRunway(forecast, { balance: 5000 });

		// The one invariant that keeps the line and the tiles honest: the balance
		// moves by exactly what the forecast still expects to happen.
		expect(runway.closing).toBeCloseTo(5000 + (forecast.projected - forecast.actual), 2);
		expect(runway.closing).toBe(4620);
		expect(runway.days.at(-1)?.balance).toBe(4620);
	});

	it('widens the band as the month goes on', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });
		const last = runway.days.at(-1);

		expect(last?.isProjected).toBe(true);
		// The leanest and heaviest of the months behind: 60 and 100 of everyday.
		expect(last?.low).toBe(4600);
		expect(last?.high).toBe(4640);
		expect(last?.low).toBeLessThan(last?.balance ?? 0);
		expect(last?.high).toBeGreaterThan(last?.balance ?? 0);
	});

	it('names the lowest the balance gets before payday', () => {
		const runway = buildRunway(forecastOf(), { balance: 5000 });

		// Nothing comes in this month, so the last day is the lowest.
		expect(runway.lowest?.date).toBe('2026-07-31');
		expect(runway.lowest?.balance).toBe(4620);
	});

	it('finds the dip when a salary lands mid-month', () => {
		const salaried = statement([
			makeTransaction({ date: '2026-05-25', amount: 9000, merchant: 'Employer', type: 'Salary' }),
			makeTransaction({ date: '2026-06-25', amount: 9000, merchant: 'Employer', type: 'Salary' })
		]);
		const runway = buildRunway(forecastOf(salaried), { balance: 5000 });

		// The salary is expected on the 25th, so the low point is the day before
		// it rather than the end of the month.
		expect(runway.lowest?.date).toBe('2026-07-24');
		expect(runway.closing).toBeGreaterThan(runway.lowest?.balance ?? 0);
	});

	it('flags the first day the balance goes under', () => {
		const runway = buildRunway(forecastOf(), { balance: 200 });

		expect(runway.shortfall?.date).toBe('2026-07-10');
		expect(runway.shortfall?.balance).toBeLessThan(0);
		// The day before it is still just above water.
		expect(runway.days.find((day) => day.date === '2026-07-09')?.balance).toBeGreaterThan(0);
	});

	it('reports no shortfall when the money lasts', () => {
		expect(buildRunway(forecastOf(), { balance: 5000 }).shortfall).toBeNull();
	});

	it('leaves a charge the reader ticked off out of the line', () => {
		const runway = buildRunway(forecastOf(statement(), { excluded: ['expense:Gym'] }), {
			balance: 5000
		});

		expect(runway.days.find((day) => day.date === '2026-07-10')?.payments).toHaveLength(0);
		expect(runway.closing).toBe(4920);
	});

	it('carries a charge the reader added by hand', () => {
		const forecast = forecastOf(statement(), {
			added: [
				{
					kind: 'custom',
					id: 'rent',
					name: 'Rent',
					flow: 'expense',
					amount: 1000,
					day: 15,
					category: 'Housing'
				}
			]
		});
		const runway = buildRunway(forecast, { balance: 5000 });

		expect(
			runway.days.find((day) => day.date === '2026-07-15')?.payments.map((p) => p.merchant)
		).toEqual(['Rent']);
		expect(runway.closing).toBe(3620);
	});

	it('places an overdue charge on the next day left, and counts it', () => {
		// The gym usually bills on the 10th; the statement now runs to the 12th
		// without it, so it is late rather than gone.
		const late = [
			...statement(),
			makeTransaction({ date: '2026-07-12', amount: -20, merchant: 'Cafe' })
		];
		const runway = buildRunway(forecastOf(late), { balance: 5000 });

		const next = runway.days.find((day) => day.date === '2026-07-13');
		expect(next?.payments.map((payment) => payment.merchant)).toEqual(['Gym']);
		expect(next?.payments[0].overdue).toBe(true);
	});

	it('reads payday off the day the reader’s months open on', () => {
		const runway = buildRunway(forecastOf(statement(), { monthStart: 25 }), {
			balance: 5000,
			monthStart: 25
		});

		expect(runway.from).toBe('2026-07-05');
		expect(runway.to).toBe('2026-07-24');
		expect(runway.payday).toBe('2026-07-25');
		expect(runway.daysLeft).toBe(19);
	});

	it('has nothing to project once the month is over', () => {
		const done = [
			...statement(),
			makeTransaction({ date: '2026-07-31', amount: -10, merchant: 'Cafe' })
		];
		const runway = buildRunway(forecastOf(done), { balance: 5000 });

		expect(runway.daysLeft).toBe(0);
		expect(runway.isComplete).toBe(true);
		expect(runway.days).toHaveLength(1);
		expect(runway.closing).toBe(5000);
		expect(runway.lowest?.date).toBe('2026-07-31');
	});

	it('is empty without a statement', () => {
		const runway = buildRunway(forecastOf([]), { balance: 0 });

		expect(runway.isEmpty).toBe(true);
		expect(runway.days).toEqual([]);
		expect(runway.lowest).toBeNull();
		expect(runway.shortfall).toBeNull();
	});
});
