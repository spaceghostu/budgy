import { describe, expect, it } from 'vitest';
import { MAX_FINDINGS } from './prompt.ts';
import { parseReport } from './report.ts';

const VALID = {
	headline: 'You spent R400 more than you took in.',
	findings: [{ title: 'Food is a third', detail: 'R2 400 across 41 buys.', tone: 'warning' }],
	actions: ['Cancel the gym at R199.']
};

describe('parseReport', () => {
	it('accepts a well-formed report', () => {
		expect(parseReport(VALID)).toEqual(VALID);
	});

	it('rejects anything that is not an object', () => {
		for (const value of [null, undefined, 'text', 42, []]) {
			expect(parseReport(value)).toBeNull();
		}
	});

	it('rejects a report with no headline', () => {
		expect(parseReport({ ...VALID, headline: '' })).toBeNull();
		expect(parseReport({ ...VALID, headline: 42 })).toBeNull();
	});

	it('rejects a report with no usable finding', () => {
		expect(parseReport({ ...VALID, findings: [] })).toBeNull();
		expect(parseReport({ ...VALID, findings: 'one thing' })).toBeNull();
		expect(parseReport({ ...VALID, findings: [{ title: 'No detail', tone: 'good' }] })).toBeNull();
	});

	it('drops a malformed finding rather than the whole report', () => {
		const report = parseReport({
			...VALID,
			findings: [...VALID.findings, { title: 'Half a finding' }]
		});

		expect(report?.findings).toEqual(VALID.findings);
	});

	it('falls back to a neutral tone, which is presentation rather than content', () => {
		const report = parseReport({
			...VALID,
			findings: [{ title: 'Fine', detail: 'Fine.', tone: 'catastrophic' }]
		});

		expect(report?.findings[0].tone).toBe('neutral');
	});

	it('trims the findings to what the card draws', () => {
		const many = Array.from({ length: MAX_FINDINGS + 3 }, (_, index) => ({
			title: `Finding ${index}`,
			detail: 'Detail.',
			tone: 'neutral'
		}));

		expect(parseReport({ ...VALID, findings: many })?.findings).toHaveLength(MAX_FINDINGS);
	});

	it('treats missing actions as no actions', () => {
		expect(parseReport({ ...VALID, actions: undefined })?.actions).toEqual([]);
		expect(parseReport({ ...VALID, actions: ['One', 7, ''] })?.actions).toEqual(['One']);
	});

	it('trims surrounding whitespace, so the card does not have to', () => {
		const report = parseReport({
			headline: '  Spent more than earned.  ',
			findings: [{ title: ' Food ', detail: ' R2 400. ', tone: 'good' }],
			actions: [' Cancel it. ']
		});

		expect(report).toEqual({
			headline: 'Spent more than earned.',
			findings: [{ title: 'Food', detail: 'R2 400.', tone: 'good' }],
			actions: ['Cancel it.']
		});
	});
});
