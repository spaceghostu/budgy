import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AiForecastCard from './AiForecastCard.svelte';

/** The key the build carries, stubbed rather than read. See the insights spec. */
const build = vi.hoisted(() => ({ key: '' }));

vi.mock('../ai/env.ts', () => ({
	envApiKey: () => build.key,
	hasEnvKey: () => build.key !== ''
}));

import { PLAN_TOOL } from '../ai/forecast-prompt.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway, type Runway } from '../stats/runway.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

function runway(extra: readonly Transaction[] = [], balance = 5000): Runway {
	resetTransactionIds();
	const transactions = [
		makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop', category: 'Groceries' }),
		makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop', category: 'Groceries' }),
		makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
		makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop', category: 'Groceries' }),
		...extra
	];

	return buildRunway(buildForecast(transactions, { metric: 'net' }), { balance });
}

const PLAN = {
	headline: 'The money reaches payday with R1 200 to spare.',
	findings: [
		{ title: 'Gym on the 10th', detail: 'R300, a debit order.', tone: 'neutral' as const }
	],
	actions: ['Hold groceries to R900 over the days left.']
};

function stubFetch(input: object = PLAN): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						content: [{ type: 'tool_use', id: 'tu_1', name: PLAN_TOOL.name, input }]
					}),
					{ status: 200 }
				)
			)
		)
	);
}

/** The body of the one request that was made. */
function sentBody(): Record<string, unknown> {
	const mock = fetch as unknown as ReturnType<typeof vi.fn>;
	return JSON.parse((mock.mock.calls[0] as [string, RequestInit])[1].body as string);
}

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
	build.key = '';
});

describe('AiForecastCard.svelte', () => {
	it('shows the projection before it is sent, carrying no descriptions', async () => {
		render(AiForecastCard, { runway: runway(), window: 6 });
		await page.getByText('See exactly what would be sent').click();

		const preview = page.getByText('"payments"');
		await expect.element(preview).toBeInTheDocument();
		expect(await preview.element().textContent).not.toContain('description');
	});

	it('asks under its own instructions and its own tool', async () => {
		build.key = 'sk-ant-test';
		stubFetch();
		render(AiForecastCard, { runway: runway(), window: 6 });

		await page.getByRole('button', { name: 'Plan the rest of my month' }).click();
		await expect.element(page.getByText(PLAN.headline)).toBeInTheDocument();

		const body = sentBody();
		expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_plan' });
		expect(body.system).toContain('get from today to their next payday');
	});

	it('renders the plan Claude returns, actions and all', async () => {
		build.key = 'sk-ant-test';
		stubFetch();
		render(AiForecastCard, { runway: runway(), window: 6 });

		await page.getByRole('button', { name: 'Plan the rest of my month' }).click();
		await expect.element(page.getByText(PLAN.headline)).toBeInTheDocument();
		await expect.element(page.getByText(PLAN.actions[0])).toBeInTheDocument();
	});

	it('sends the note with the projection', async () => {
		build.key = 'sk-ant-test';
		stubFetch();
		render(AiForecastCard, { runway: runway(), window: 6 });

		await page.getByRole('textbox', { name: /What do you want/ }).fill('Keeping R2000 back.');
		await page.getByRole('button', { name: 'Plan the rest of my month' }).click();
		await expect.element(page.getByText(PLAN.headline)).toBeInTheDocument();

		const messages = sentBody().messages as { content: string }[];
		expect(messages[0].content).toContain('Keeping R2000 back.');
	});

	it('says the balance is missing rather than planning around a fake one', async () => {
		render(AiForecastCard, { runway: runway([], 0), window: 6, isRelative: true });

		await expect
			.element(page.getByText(/Set your current balance on the overview/))
			.toBeInTheDocument();
	});

	it('tells the model when the everyday spending is not counted', async () => {
		build.key = 'sk-ant-test';
		stubFetch();
		render(AiForecastCard, { runway: runway(), window: 6, everydayCounted: false });

		await page.getByRole('button', { name: 'Plan the rest of my month' }).click();
		await expect.element(page.getByText(PLAN.headline)).toBeInTheDocument();

		const messages = sentBody().messages as { content: string }[];
		expect(messages[0].content).toContain('"everydayCounted": false');
	});

	it('names the days it was written from, not the ones now on screen', async () => {
		build.key = 'sk-ant-test';
		stubFetch();
		const { rerender } = render(AiForecastCard, { runway: runway(), window: 6 });

		await page.getByRole('button', { name: 'Plan the rest of my month' }).click();
		await expect.element(page.getByText(PLAN.headline)).toBeInTheDocument();

		// A later statement, so both the days left and the figures move. The
		// warning only exists once the two have parted company, so naming what is
		// now on screen would assert the opposite of what it is there to say.
		await rerender({
			runway: runway([makeTransaction({ date: '2026-07-18', amount: -250, merchant: 'Shop' })]),
			window: 6
		});

		await expect
			.element(page.getByText('This plan is about the 26 days', { exact: false }))
			.toBeInTheDocument();
	});

	it('will not send anything until a key is entered', async () => {
		render(AiForecastCard, { runway: runway(), window: 6 });

		await expect
			.element(page.getByRole('button', { name: 'Plan the rest of my month' }))
			.toBeDisabled();
	});
});
