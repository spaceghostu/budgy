import { describe, expect, it } from 'vitest';
import { ALL_ACCOUNTS, busiestAccount, resolveRange } from './range.ts';
import { anchorForSlice } from '../stats/insights.ts';
import { makeTransaction } from '../testing/transaction.ts';

const BOUNDS = { earliestDate: '2026-05-01', latestDate: '2026-08-09', selectedMonth: '' };

describe('resolveRange', () => {
	it('leaves the range open for "all"', () => {
		expect(resolveRange({ ...BOUNDS, range: 'all', customFrom: '', customTo: '' })).toEqual({
			from: null,
			to: null
		});
	});

	it('counts back from the statement, not from today', () => {
		// A statement downloaded weeks ago would otherwise show an empty chart.
		expect(resolveRange({ ...BOUNDS, range: '7d', customFrom: '', customTo: '' })).toEqual({
			from: '2026-08-03',
			to: '2026-08-09'
		});
	});

	it('handles 30 and 90 day presets', () => {
		expect(resolveRange({ ...BOUNDS, range: '30d', customFrom: '', customTo: '' }).from).toBe(
			'2026-07-11'
		);
		expect(resolveRange({ ...BOUNDS, range: '90d', customFrom: '', customTo: '' }).from).toBe(
			'2026-05-12'
		);
	});

	it('defaults the month view to the statement’s newest month', () => {
		expect(resolveRange({ ...BOUNDS, range: 'month', customFrom: '', customTo: '' })).toEqual({
			from: '2026-08-01',
			to: '2026-08-31'
		});
	});

	it('takes the whole of a month the reader stepped back to', () => {
		expect(
			resolveRange({
				...BOUNDS,
				range: 'month',
				selectedMonth: '2026-06',
				customFrom: '',
				customTo: ''
			})
		).toEqual({ from: '2026-06-01', to: '2026-06-30' });
	});

	it('ends February on the day February ends', () => {
		expect(
			resolveRange({
				...BOUNDS,
				range: 'month',
				selectedMonth: '2026-02',
				customFrom: '',
				customTo: ''
			}).to
		).toBe('2026-02-28');
	});

	it('passes a custom range straight through, treating blanks as unbounded', () => {
		expect(
			resolveRange({ ...BOUNDS, range: 'custom', customFrom: '2026-06-01', customTo: '' })
		).toEqual({ from: '2026-06-01', to: null });
	});

	it('is unbounded before a statement is loaded', () => {
		expect(
			resolveRange({
				earliestDate: '',
				latestDate: '',
				range: '7d',
				customFrom: '',
				customTo: '',
				selectedMonth: ''
			})
		).toEqual({ from: null, to: null });
	});
});

describe('busiestAccount', () => {
	it('picks the account the reader most likely came to look at', () => {
		expect(
			busiestAccount([
				makeTransaction({ date: '2026-03-01', amount: -1, account: 'Savings' }),
				makeTransaction({ date: '2026-03-02', amount: -1, account: 'Cheque account' }),
				makeTransaction({ date: '2026-03-03', amount: -1, account: 'Cheque account' })
			])
		).toBe('Cheque account');
	});

	it('picks the only account in a single-account export', () => {
		expect(
			busiestAccount([makeTransaction({ date: '2026-03-01', amount: -1, account: 'Savings' })])
		).toBe('Savings');
	});

	it('falls back to every account when there are none', () => {
		expect(busiestAccount([])).toBe(ALL_ACCOUNTS);
	});
});

describe('anchorForSlice', () => {
	const all = [
		makeTransaction({ date: '2026-03-01', amount: -100 }),
		makeTransaction({ date: '2026-03-02', amount: -200 }),
		makeTransaction({ date: '2026-03-03', amount: -300 })
	];

	it('returns the anchor unchanged for the full period', () => {
		expect(anchorForSlice(all, all, 400)).toBe(400);
	});

	it('unwinds the transactions that happened after a narrower slice', () => {
		// Slice ends before the -300, so its closing balance was 300 higher.
		expect(anchorForSlice(all, all.slice(0, 2), 400)).toBe(700);
	});

	it('returns the anchor for an empty slice', () => {
		expect(anchorForSlice(all, [], 400)).toBe(400);
	});
});
