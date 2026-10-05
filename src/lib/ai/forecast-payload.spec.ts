import { describe, expect, it } from 'vitest';
import {
	TOP_DEBTS,
	TOP_OUTLOOK,
	TOP_PAYMENTS,
	buildForecastPayload,
	toAiDebts
} from './forecast-payload.ts';
import { buildForecast, type DebtCharge } from '../stats/forecast.ts';
import { buildRunway, type Runway } from '../stats/runway.ts';
import { makeCreditAccount } from '../testing/credit.ts';
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

describe('the debts sent with a forecast', () => {
	const loan = makeCreditAccount({
		id: '0f1e2d3c4b5a6978',
		creditor: 'Northwind',
		balance: 42_000,
		instalment: 1500,
		arrears: 300,
		status: 'arrears',
		opened: '2022-03-14',
		limit: null
	});
	const card = makeCreditAccount({
		id: '8697a5b4c3d2e1f0',
		creditor: 'Contoso',
		kind: 'card',
		balance: 9000,
		instalment: 300,
		limit: 15_000
	});

	function charge(accountId: string, linkedMerchant: string | null): DebtCharge {
		return { accountId, name: 'A lender', amount: 300, day: 20, linkedMerchant };
	}

	function read(debts: readonly DebtCharge[], rows = statement()) {
		const forecast = buildForecast(rows, { metric: 'net', debts });
		const runway = buildRunway(forecast, { balance: 5000 });

		return { forecast, runway };
	}

	it('sends nothing about debts for a reader with no credit report', () => {
		const payload = buildForecastPayload(runwayFor(), { window: 6, debts: [] });

		expect(payload).not.toHaveProperty('debts');
		expect(payload).not.toHaveProperty('debtReportDate');
	});

	it('sends each debt as its lender, its kind and its figures, largest first', () => {
		const { forecast, runway } = read([]);
		const debts = toAiDebts([card, loan], { [loan.id]: { rate: 24.5 } }, forecast, runway.payments);
		const payload = buildForecastPayload(runway, {
			window: 6,
			debts,
			debtReportDate: '2026-06-30'
		});

		expect(payload.debtReportDate).toBe('2026-06-30');
		expect(payload.debts).toEqual([
			{
				creditor: 'Northwind',
				kind: 'loan',
				balance: 42_000,
				instalment: 1500,
				annualRate: 24.5,
				arrears: 300,
				status: 'arrears',
				handledThisMonth: false
			},
			{
				creditor: 'Contoso',
				kind: 'card',
				balance: 9000,
				instalment: 300,
				annualRate: null,
				arrears: 0,
				status: 'current',
				handledThisMonth: false
			}
		]);
	});

	it('never carries the id an account is known by here, when it was opened, or its limit', () => {
		const { forecast, runway } = read([charge(loan.id, null)]);
		const debts = toAiDebts([loan, card], {}, forecast, runway.payments);
		const serialised = JSON.stringify(
			buildForecastPayload(runway, { window: 6, debts, debtReportDate: '2026-06-30' })
		);

		for (const secret of [loan.id, card.id, '2022-03-14', '15000', 'limit', 'opened', 'score']) {
			expect(serialised).not.toContain(secret);
		}
	});

	it('calls a debt handled when its own row is one of the payments', () => {
		const { forecast, runway } = read([charge(loan.id, null)]);
		const [sent] = toAiDebts([loan], {}, forecast, runway.payments);

		expect(sent.handledThisMonth).toBe(true);
	});

	it('still calls it handled after its debit order has gone off and left the list', () => {
		// The gym stands in for the loan's debit order, already taken on the 6th.
		const paid = statement([
			makeTransaction({ date: '2026-07-06', amount: -300, merchant: 'Gym', type: 'Debit order' })
		]);
		const { forecast, runway } = read([charge(loan.id, 'Gym')], paid);

		expect(runway.payments.some((payment) => payment.merchant === 'Gym')).toBe(false);
		expect(toAiDebts([loan], {}, forecast, runway.payments)[0].handledThisMonth).toBe(true);
	});

	it('does not call a debt handled once the reader has ticked its row off', () => {
		const forecast = buildForecast(statement(), {
			metric: 'net',
			debts: [charge(loan.id, null)],
			excluded: [`debt:${loan.id}`]
		});
		const runway = buildRunway(forecast, { balance: 5000 });

		expect(toAiDebts([loan], {}, forecast, runway.payments)[0].handledThisMonth).toBe(false);
	});

	it('caps how many debts it sends', () => {
		const many = Array.from({ length: TOP_DEBTS + 5 }, (_, index) =>
			makeCreditAccount({ id: `debt-${index}`, balance: 1000 + index })
		);
		const { forecast, runway } = read([]);
		const payload = buildForecastPayload(runway, {
			window: 6,
			debts: toAiDebts(many, {}, forecast, runway.payments)
		});

		expect(payload.debts).toHaveLength(TOP_DEBTS);
	});
});
