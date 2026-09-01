import { describe, expect, it } from 'vitest';
import { TOP_OUTLOOK, TOP_PAYMENTS, buildForecastPayload } from './forecast-payload.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway, type Runway } from '../stats/runway.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/**
 * Two whole months behind a month in progress, so there is a projection to
 * describe: the gym is a debit order and lands on the 10th for 300, and the
 * shop and the cafe swing too far to read as fixed prices, so they stay in the
 * everyday channel.
 */
function statement(extra: readonly Transaction[] = []): readonly Transaction[] {
	return [
		makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop', category: 'Groceries' }),
		makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe', category: 'Coffee' }),

		makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop', category: 'Groceries' }),
		makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe', category: 'Coffee' }),

		makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop', category: 'Groceries' }),
		...extra
	];
}

function runwayFor(transactions: readonly Transaction[] = statement(), balance = 5000): Runway {
	return buildRunway(buildForecast(transactions, { metric: 'net' }), { balance });
}

describe('buildForecastPayload', () => {
	it('describes the stretch to payday and where the balance goes', () => {
		const runway = runwayFor();
		const payload = buildForecastPayload(runway, { window: 6 });

		expect(payload.currency).toBe('ZAR');
		expect(payload.period).toEqual({
			from: runway.from,
			to: runway.to,
			payday: runway.payday,
			daysLeft: runway.daysLeft
		});
		expect(payload.balance.opening).toBe(5000);
		expect(payload.balance.closing).toBe(runway.closing);
		expect(payload.balance.lowest).toEqual({
			date: runway.lowest?.date,
			balance: runway.lowest?.balance
		});
	});

	it('carries the named charges with what makes them actionable', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6 });
		const gym = payload.payments.find((payment) => payment.merchant === 'Gym');

		expect(gym).toMatchObject({
			amount: 300,
			flow: 'expense',
			date: '2026-07-10',
			isDebitOrder: true,
			overdue: false,
			seen: 2
		});
	});

	it('splits what is still to leave by category', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6 });

		expect(payload.byCategory.length).toBeGreaterThan(0);
		for (const row of payload.byCategory) {
			expect(row.total).toBeCloseTo(row.named + row.everyday, 2);
		}
	});

	it('says nothing about the month start while it is the calendar’s', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6 });

		expect(payload).not.toHaveProperty('monthStartDay');
	});

	it('names the month start where the reader is not paid on the 1st', () => {
		const runway = buildRunway(buildForecast(statement(), { metric: 'net', monthStart: 25 }), {
			balance: 5000,
			monthStart: 25
		});
		const payload = buildForecastPayload(runway, { window: 6, monthStart: 25 });

		expect(payload.monthStartDay).toBe(25);
	});

	it('says when the balance is a shape rather than money', () => {
		const payload = buildForecastPayload(runwayFor(statement(), 0), {
			window: 6,
			isRelative: true
		});

		expect(payload.balance.isRelative).toBe(true);
	});

	it('says when the everyday channel is not in the figures', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6, everydayCounted: false });

		expect(payload.everydayCounted).toBe(false);
	});

	it('counts both channels as counted and learned-from by default', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 3 });

		expect(payload.everydayCounted).toBe(true);
		expect(payload.balance.isRelative).toBe(false);
		expect(payload.learnedFromMonths).toBe(3);
	});

	it('never carries a description, note, counterparty, account or time', () => {
		const payload = buildForecastPayload(
			runwayFor(
				statement([
					makeTransaction({
						date: '2026-07-06',
						time: '13:45:02',
						amount: -1200,
						merchant: 'Airline',
						description: 'CARD 1234 REF 998877',
						note: 'private note',
						counterparty: 'A Person',
						account: 'Cheque account',
						accountNumber: '1234567890'
					})
				])
			),
			{ window: 6 }
		);

		const serialised = JSON.stringify(payload);
		for (const secret of [
			'CARD 1234',
			'998877',
			'private note',
			'A Person',
			'1234567890',
			'13:45:02',
			'Cheque account'
		]) {
			expect(serialised).not.toContain(secret);
		}
	});

	it('caps the charges and the categories it sends', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6 });

		expect(payload.payments.length).toBeLessThanOrEqual(TOP_PAYMENTS);
		expect(payload.byCategory.length).toBeLessThanOrEqual(TOP_OUTLOOK);
	});

	it('holds up on an empty statement rather than throwing', () => {
		const payload = buildForecastPayload(runwayFor([], 0), { window: 6 });

		expect(payload.payments).toEqual([]);
		expect(payload.byCategory).toEqual([]);
		expect(payload.period.daysLeft).toBe(0);
	});
});
