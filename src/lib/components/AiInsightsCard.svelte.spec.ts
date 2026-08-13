import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiInsightsCard from './AiInsightsCard.svelte';
import { REPORT_TOOL } from '../ai/prompt.ts';
import { buildInsights } from '../stats/insights.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';
import type { Insights } from '../types.ts';

function insights(): Insights {
	resetTransactionIds();
	return buildInsights(
		[
			makeTransaction({ date: '2026-01-05', amount: 8000 }),
			makeTransaction({
				date: '2026-01-09',
				amount: -1200,
				category: 'Food and Drink',
				merchant: 'Grocer',
				description: 'CARD 4321 REF 55667788',
				note: 'a private note'
			})
		],
		6800
	);
}

const REPORT = {
	headline: 'You kept R6 800 of R8 000.',
	findings: [
		{ title: 'Groceries dominate', detail: 'R1 200 of R1 200 spent.', tone: 'warning' as const }
	],
	actions: ['Set a grocery cap.']
};

function stubFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						content: [{ type: 'tool_use', name: REPORT_TOOL.name, input: REPORT }]
					}),
					{ status: 200 }
				)
			)
		)
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('AiInsightsCard.svelte', () => {
	it('will not send anything until a key is entered', async () => {
		render(AiInsightsCard, { insights: insights() });

		await expect.element(page.getByRole('button', { name: 'Read my spending' })).toBeDisabled();
	});

	it('shows the payload before it is sent, and it carries no descriptions', async () => {
		render(AiInsightsCard, { insights: insights() });
		await page.getByText('See exactly what would be sent').click();

		const preview = page.getByText('"currency": "ZAR"', { exact: false });
		await expect.element(preview).toBeInTheDocument();
		await expect.element(preview).not.toHaveTextContent('CARD 4321');
		await expect.element(preview).not.toHaveTextContent('a private note');
	});

	it('renders the report Claude returns', async () => {
		stubFetch();
		render(AiInsightsCard, { insights: insights() });

		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-test');
		await page.getByRole('button', { name: 'Read my spending' }).click();

		await expect.element(page.getByText(REPORT.headline)).toBeInTheDocument();
		await expect.element(page.getByText('Groceries dominate')).toBeInTheDocument();
		await expect.element(page.getByText('Set a grocery cap.')).toBeInTheDocument();
	});

	it('shows the note in the preview, so nothing is sent unseen', async () => {
		render(AiInsightsCard, { insights: insights() });
		await page.getByLabelText('What do you want from this read?').fill('Saving for a deposit.');
		await page.getByText('See exactly what would be sent').click();

		// Located by the payload's own text rather than by the note's: the note is
		// on screen twice, and a locator that could resolve to the textarea would
		// still pass on the day the preview stopped showing what it sends.
		await expect
			.element(page.getByText('"currency": "ZAR"', { exact: false }))
			.toHaveTextContent('Saving for a deposit.');
	});

	it('sends the note with the figures', async () => {
		stubFetch();
		render(AiInsightsCard, { insights: insights() });

		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-test');
		await page.getByLabelText('What do you want from this read?').fill('Why was January so bad?');
		await page.getByRole('button', { name: 'Read my spending' }).click();
		await expect.element(page.getByText(REPORT.headline)).toBeInTheDocument();

		const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string) as {
			messages: { content: string }[];
		};
		expect(body.messages[0].content).toContain('Why was January so bad?');
	});

	it('says so when the question changes under a report it already wrote', async () => {
		stubFetch();
		render(AiInsightsCard, { insights: insights() });

		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-test');
		await page.getByRole('button', { name: 'Read my spending' }).click();
		await expect.element(page.getByText(REPORT.headline)).toBeInTheDocument();

		await page.getByLabelText('What do you want from this read?').fill('Actually, why the fees?');

		await expect
			.element(page.getByText('You have changed what you asked since', { exact: false }))
			.toBeInTheDocument();
	});

	it('says so when the figures move under a report it already wrote', async () => {
		stubFetch();
		const { rerender } = render(AiInsightsCard, { insights: insights() });

		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-test');
		await page.getByRole('button', { name: 'Read my spending' }).click();
		await expect.element(page.getByText(REPORT.headline)).toBeInTheDocument();

		// Same first and last date, different account underneath — the case a
		// period-only check would miss.
		resetTransactionIds();
		await rerender({
			insights: buildInsights(
				[
					makeTransaction({ date: '2026-01-05', amount: 8000, account: 'Savings' }),
					makeTransaction({ date: '2026-01-09', amount: -4400, account: 'Savings' })
				],
				3600
			)
		});

		await expect
			.element(page.getByText('The figures on screen have changed since', { exact: false }))
			.toBeInTheDocument();
	});

	it('explains a rejected key instead of failing silently', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })
				)
			)
		);
		render(AiInsightsCard, { insights: insights() });

		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-wrong');
		await page.getByRole('button', { name: 'Read my spending' }).click();

		await expect.element(page.getByRole('alert')).toHaveTextContent('That API key was rejected.');
	});

	it('keeps the key only when asked to', async () => {
		render(AiInsightsCard, { insights: insights() });
		await page.getByLabelText('Your Anthropic API key').fill('sk-ant-test');

		expect(localStorage.getItem('budgy:anthropic-key')).toBeNull();

		await page.getByText('Keep this key in this browser').click();
		expect(localStorage.getItem('budgy:anthropic-key')).toContain('sk-ant-test');
	});
});
