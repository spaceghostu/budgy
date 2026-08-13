import { describe, expect, it } from 'vitest';
import {
	MAX_FINDINGS,
	MAX_NOTE_LENGTH,
	REPORT_TOOL,
	SYSTEM_PROMPT,
	buildUserPrompt
} from './prompt.ts';
import { buildAiPayload } from './payload.ts';
import { buildInsights } from '../stats/insights.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';

function samplePayload() {
	resetTransactionIds();
	return buildAiPayload(
		buildInsights(
			[
				makeTransaction({ date: '2026-01-05', amount: 5000 }),
				makeTransaction({ date: '2026-01-20', amount: -400, category: 'Food' })
			],
			4600
		)
	);
}

describe('SYSTEM_PROMPT', () => {
	it('forbids figures that were not supplied', () => {
		expect(SYSTEM_PROMPT).toMatch(/only.*(figures|numbers) (you were |)(given|supplied|provided)/i);
	});

	it('names the currency, so totals are not read as dollars', () => {
		expect(SYSTEM_PROMPT).toContain('rand');
	});
});

describe('buildUserPrompt', () => {
	it('carries the payload as JSON the model can read back', () => {
		const payload = samplePayload();
		const prompt = buildUserPrompt(payload);
		const parsed: unknown = JSON.parse(
			prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1)
		);

		expect(parsed).toEqual(JSON.parse(JSON.stringify(payload)));
	});

	it('states the period in words, so the model does not have to infer it', () => {
		expect(buildUserPrompt(samplePayload())).toContain('2026-01-05');
	});

	it('passes the reader’s note through word for word', () => {
		expect(buildUserPrompt(samplePayload(), 'Saving for a deposit in June.')).toContain(
			'Saving for a deposit in June.'
		);
	});

	it('leaves the note out entirely when it is blank', () => {
		const bare = buildUserPrompt(samplePayload());

		expect(buildUserPrompt(samplePayload(), '   ')).toBe(bare);
		expect(bare).not.toContain('What I want from this read');
	});

	it('caps the note, so one paste cannot become the whole prompt', () => {
		const prompt = buildUserPrompt(samplePayload(), 'x'.repeat(MAX_NOTE_LENGTH + 200));

		expect(prompt).toContain('x'.repeat(MAX_NOTE_LENGTH));
		expect(prompt).not.toContain('x'.repeat(MAX_NOTE_LENGTH + 1));
	});
});

describe('REPORT_TOOL', () => {
	it('requires every field the card renders', () => {
		expect(REPORT_TOOL.input_schema.required).toEqual(['headline', 'findings', 'actions']);
	});

	it('constrains tone to the three the app knows how to draw', () => {
		expect(REPORT_TOOL.input_schema.properties.findings.items.properties.tone.enum).toEqual([
			'good',
			'neutral',
			'warning'
		]);
	});

	it('caps the findings, because a wall of observations is no observations', () => {
		expect(REPORT_TOOL.input_schema.properties.findings.maxItems).toBe(MAX_FINDINGS);
	});
});
