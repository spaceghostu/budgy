import { describe, expect, it } from 'vitest';
import { buildForecastPayload } from './forecast-payload.ts';
import { FORECAST_SYSTEM_PROMPT, PLAN_TOOL, buildForecastPrompt } from './forecast-prompt.ts';
import { MAX_ACTIONS, MAX_FINDINGS, MAX_NOTE_LENGTH } from './prompt.ts';
import { parseReport } from './report.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway } from '../stats/runway.ts';
import { makeTransaction } from '../testing/transaction.ts';

function samplePayload() {
	const transactions = [
		makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
		makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop' }),
		makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop' })
	];

	return buildForecastPayload(
		buildRunway(buildForecast(transactions, { metric: 'net' }), { balance: 5000 }),
		{ window: 6 }
	);
}

describe('FORECAST_SYSTEM_PROMPT', () => {
	it('forbids figures that were not supplied', () => {
		expect(FORECAST_SYSTEM_PROMPT).toMatch(/only.*(figures|numbers) you were given/i);
	});

	it('names the currency, so totals are not read as dollars', () => {
		expect(FORECAST_SYSTEM_PROMPT).toContain('rand');
	});

	it('says a debit order cannot simply be skipped', () => {
		expect(FORECAST_SYSTEM_PROMPT).toMatch(/debit order cannot be skipped/i);
	});

	it('says what to do when the balance is a shape rather than money', () => {
		expect(FORECAST_SYSTEM_PROMPT).toContain('isRelative');
	});

	it('says what to do when the everyday channel is not counted', () => {
		expect(FORECAST_SYSTEM_PROMPT).toContain('everydayCounted');
	});
});

describe('buildForecastPrompt', () => {
	it('carries the payload as JSON the model can read back', () => {
		const payload = samplePayload();
		const prompt = buildForecastPrompt(payload);

		expect(prompt).toContain(JSON.stringify(payload, null, 2));
	});

	it('frames the days left and the payday it is counting to', () => {
		const payload = samplePayload();
		const prompt = buildForecastPrompt(payload);

		expect(prompt).toContain(payload.period.payday);
		expect(prompt).toContain(`${payload.period.daysLeft} days`);
	});

	it('asks the question the page exists to ask', () => {
		expect(buildForecastPrompt(samplePayload())).toMatch(/saving as much as I can/i);
	});

	it('passes the reader’s note through word for word', () => {
		const prompt = buildForecastPrompt(samplePayload(), '  Keeping R2000 back for tyres.  ');

		expect(prompt).toContain('Keeping R2000 back for tyres.');
	});

	it('leaves the note section out entirely when it is blank', () => {
		expect(buildForecastPrompt(samplePayload(), '   ')).not.toContain('What I am up against');
	});

	it('caps the note at the same length every other message is capped at', () => {
		const prompt = buildForecastPrompt(samplePayload(), 'x'.repeat(MAX_NOTE_LENGTH + 50));

		expect(prompt).toContain('x'.repeat(MAX_NOTE_LENGTH));
		expect(prompt).not.toContain('x'.repeat(MAX_NOTE_LENGTH + 1));
	});

	it('holds up where there is no statement to project from', () => {
		const payload = buildForecastPayload(
			buildRunway(buildForecast([], { metric: 'net' }), { balance: 0 }),
			{ window: 6 }
		);

		expect(buildForecastPrompt(payload)).toContain('no statement');
	});
});

describe('PLAN_TOOL', () => {
	it('is a distinct tool from the spending report', () => {
		expect(PLAN_TOOL.name).toBe('report_plan');
	});

	it('answers in the shape the card already draws', () => {
		expect(PLAN_TOOL.input_schema.required).toEqual(['headline', 'findings', 'actions']);
		expect(PLAN_TOOL.input_schema.properties.findings.maxItems).toBe(MAX_FINDINGS);
		expect(PLAN_TOOL.input_schema.properties.actions.maxItems).toBe(MAX_ACTIONS);
	});

	it('offers the three tones the card has markers for', () => {
		expect(PLAN_TOOL.input_schema.properties.findings.items.properties.tone.enum).toEqual([
			'good',
			'neutral',
			'warning'
		]);
	});

	it('produces something parseReport reads, so the card needs no second reader', () => {
		const report = parseReport({
			headline: 'The money reaches payday with R1 200 to spare.',
			findings: [{ title: 'Gym on the 10th', detail: 'R300, a debit order.', tone: 'neutral' }],
			actions: ['Hold groceries to R900 over the 11 days left.']
		});

		expect(report?.actions).toHaveLength(1);
	});
});
