import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ForecastTable from './ForecastTable.svelte';
import { formatCurrency } from '../format.ts';
import { buildForecast } from '../stats/forecast.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-05-25', amount: -300, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-03', amount: -200, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
];

function draw(transactions: readonly Transaction[] = STATEMENT) {
	return render(ForecastTable, {
		props: { forecast: buildForecast(transactions, { metric: 'out' }) }
	});
}

describe('ForecastTable.svelte', () => {
	it('gives every figure on the chart as text', async () => {
		draw();

		// The day the statement stops, banked, and the day the month ends at.
		await expect.element(page.getByText(formatCurrency(150), { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText(formatCurrency(850), { exact: true })).toBeInTheDocument();
	});

	it('says which rows are projected rather than banked', async () => {
		draw();

		await expect
			.element(page.getByText(/Projected from past months rather than banked/))
			.toBeInTheDocument();
	});

	it('spells out how far off a projected day could be', async () => {
		draw();

		await expect.element(page.getByText('Lean – heavy')).toBeInTheDocument();
		await expect
			.element(page.getByText(`${formatCurrency(750)} – ${formatCurrency(950)}`))
			.toBeInTheDocument();
	});

	it('names the charge expected on its day', async () => {
		draw();

		await expect.element(page.getByText(`Gym ${formatCurrency(500)}`)).toBeInTheDocument();
	});

	it('says so rather than drawing an empty table', async () => {
		draw([]);

		await expect.element(page.getByText('No transactions to forecast.')).toBeInTheDocument();
	});
});
