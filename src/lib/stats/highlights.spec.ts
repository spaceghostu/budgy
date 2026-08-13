import { describe, expect, it } from 'vitest';
import type { Insights } from '../types.ts';
import { makeTransaction } from '../testing/transaction.ts';
import { buildInsights } from './insights.ts';
import { buildHighlights } from './highlights.ts';

function ids(insights: Insights): readonly string[] {
	return buildHighlights(insights).map((highlight) => highlight.id);
}

describe('buildHighlights', () => {
	it('says nothing about an empty period', () => {
		expect(buildHighlights(buildInsights([], 0))).toEqual([]);
	});

	it('flags a shortfall as something to watch', () => {
		const insights = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: 1000, flow: 'income' }),
				makeTransaction({ date: '2026-03-10', amount: -3000 })
			],
			500
		);

		const net = buildHighlights(insights).find((highlight) => highlight.id === 'net');

		expect(net?.tone).toBe('warning');
		expect(net?.text).toContain('more than came in');
	});

	it('celebrates a surplus', () => {
		const insights = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: 5000, flow: 'income' }),
				makeTransaction({ date: '2026-03-10', amount: -1000 })
			],
			4000
		);

		const net = buildHighlights(insights).find((highlight) => highlight.id === 'net');

		expect(net?.tone).toBe('good');
	});

	it('calls out fees paid for declined transactions', () => {
		const insights = buildInsights(
			[
				makeTransaction({
					date: '2026-03-01',
					amount: -6,
					isFee: true,
					isDeclined: true,
					category: 'Fees and Interest'
				}),
				makeTransaction({ date: '2026-03-02', amount: -500 })
			],
			0
		);

		const declined = buildHighlights(insights).find(
			(highlight) => highlight.id === 'declined-fees'
		);

		expect(declined?.tone).toBe('warning');
		expect(declined?.text).toContain('declined');
	});

	it('stays quiet about declines when there were none', () => {
		const insights = buildInsights([makeTransaction({ date: '2026-03-01', amount: -500 })], 0);

		expect(ids(insights)).not.toContain('declined-fees');
	});

	it('warns when the runway is short', () => {
		const insights = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: -100 }),
				makeTransaction({ date: '2026-03-10', amount: -100 })
			],
			200
		);

		const runway = buildHighlights(insights).find((highlight) => highlight.id === 'runway');

		expect(runway?.tone).toBe('warning');
	});

	it('stays neutral when the runway is comfortable', () => {
		const insights = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: -100 }),
				makeTransaction({ date: '2026-03-10', amount: -100 })
			],
			50_000
		);

		const runway = buildHighlights(insights).find((highlight) => highlight.id === 'runway');

		expect(runway?.tone).toBe('neutral');
	});

	it('ignores trivial fees', () => {
		const insights = buildInsights(
			[
				makeTransaction({
					date: '2026-03-01',
					amount: -1,
					isFee: true,
					category: 'Fees and Interest'
				}),
				makeTransaction({ date: '2026-03-02', amount: -5000 })
			],
			0
		);

		expect(ids(insights)).not.toContain('fees');
	});

	it('never floods the reader', () => {
		const insights = buildInsights(
			[
				makeTransaction({ date: '2026-03-01', amount: 100, flow: 'income' }),
				makeTransaction({
					date: '2026-03-02',
					amount: -6,
					isFee: true,
					isDeclined: true,
					category: 'Fees and Interest'
				}),
				makeTransaction({ date: '2026-03-03', amount: -500, type: 'Debit order', merchant: 'Gym' }),
				makeTransaction({ date: '2026-03-04', amount: -800, category: 'Home' })
			],
			1000
		);

		expect(buildHighlights(insights).length).toBeLessThanOrEqual(5);
	});
});
