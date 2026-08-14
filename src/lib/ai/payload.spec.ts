import { describe, expect, it } from 'vitest';
import { buildAiPayload, TOP_BUCKETS } from './payload.ts';
import { buildInsights } from '../stats/insights.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';
import type { Insights, Transaction } from '../types.ts';

function insightsFor(transactions: readonly Transaction[], closing = 1000): Insights {
	return buildInsights(transactions, closing);
}

describe('buildAiPayload', () => {
	it('describes the period and the headline totals', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({ date: '2026-01-05', amount: 5000, flow: 'income' }),
				makeTransaction({ date: '2026-01-20', amount: -400 })
			])
		);

		expect(payload.currency).toBe('ZAR');
		expect(payload.period).toMatchObject({ from: '2026-01-05', to: '2026-01-20', days: 16 });
		expect(payload.totals).toMatchObject({ income: 5000, expense: 400, net: 4600 });
	});

	it('sends category and merchant totals, biggest first', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({
					date: '2026-01-02',
					amount: -100,
					category: 'Coffee',
					merchant: 'Shop'
				}),
				makeTransaction({
					date: '2026-01-03',
					amount: -900,
					category: 'Levies',
					merchant: 'Rent'
				})
			])
		);

		expect(payload.categories.map((bucket) => bucket.label)).toEqual(['Levies', 'Coffee']);
		expect(payload.merchants[0]).toMatchObject({ label: 'Rent', total: 900, count: 1 });
	});

	it('rounds shares, so the payload carries cents rather than float noise', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({ date: '2026-01-02', amount: -100, category: 'Coffee' }),
				makeTransaction({ date: '2026-01-03', amount: -200, category: 'Levies' })
			])
		);

		expect(payload.categories.map((bucket) => bucket.share)).toEqual([0.667, 0.333]);
	});

	it('caps the long tail — a hundred merchants is noise, not context', () => {
		resetTransactionIds();
		const many = Array.from({ length: TOP_BUCKETS + 5 }, (_, index) =>
			makeTransaction({
				date: '2026-01-02',
				amount: -(index + 1),
				category: `Category ${index}`,
				merchant: `Merchant ${index}`
			})
		);
		const payload = buildAiPayload(insightsFor(many));

		expect(payload.categories).toHaveLength(TOP_BUCKETS);
		expect(payload.merchants).toHaveLength(TOP_BUCKETS);
	});

	it('rolls the period up by month, so a trend is visible', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({ date: '2026-01-10', amount: -100 }),
				makeTransaction({ date: '2026-02-10', amount: -250 }),
				makeTransaction({ date: '2026-02-11', amount: 900, flow: 'income' })
			])
		);

		expect(payload.months).toEqual([
			{ month: '2026-01', income: 0, expense: 100, net: -100 },
			{ month: '2026-02', income: 900, expense: 250, net: 650 }
		]);
	});

	it('carries recurring charges as a commitment, not as their lines', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({
					date: '2026-01-05',
					amount: -199,
					type: 'Debit order',
					merchant: 'Gym',
					category: 'Sport and Fitness'
				})
			])
		);

		expect(payload.recurring).toEqual([
			{
				merchant: 'Gym',
				category: 'Sport and Fitness',
				monthlyAmount: 199,
				months: 1,
				isDebitOrder: true
			}
		]);
	});

	it('reduces the biggest expenses to date, merchant, category and amount', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({
					date: '2026-01-05',
					amount: -1200,
					merchant: 'Airline',
					category: 'Flights',
					description: 'CARD 1234 REF 998877 AIRLINE',
					note: 'private note',
					counterparty: 'Someone',
					accountNumber: '1234567890'
				})
			])
		);

		expect(payload.largestExpenses).toEqual([
			{ date: '2026-01-05', merchant: 'Airline', category: 'Flights', amount: 1200 }
		]);
	});

	it('never carries a description, note, counterparty, account or time', () => {
		resetTransactionIds();
		const payload = buildAiPayload(
			insightsFor([
				makeTransaction({
					date: '2026-01-05',
					time: '13:45:02',
					amount: -1200,
					description: 'CARD 1234 REF 998877',
					note: 'private note',
					counterparty: 'A Person',
					account: 'Cheque account',
					accountNumber: '1234567890'
				})
			])
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

	it('holds up on an empty statement rather than throwing', () => {
		const payload = buildAiPayload(insightsFor([], 0));

		expect(payload.months).toEqual([]);
		expect(payload.totals.transactionCount).toBe(0);
	});
});
