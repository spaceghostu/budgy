import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RunwayTable from './RunwayTable.svelte';
import { formatCurrency, formatDate } from '../format.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway } from '../stats/runway.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/** The same two months the chart's spec reads, so the twins agree. */
const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe' }),
	makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe' }),
	makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop' })
];

function draw(transactions: readonly Transaction[] = STATEMENT, balance = 5000) {
	const runway = buildRunway(buildForecast(transactions, { metric: 'net' }), { balance });

	return render(RunwayTable, { props: { runway } });
}

describe('RunwayTable.svelte', () => {
	it('opens on today at the balance the account holds', async () => {
		draw();

		await expect
			.element(page.getByRole('rowheader', { name: formatDate('2026-07-05'), exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('cell', { name: formatCurrency(5000) }))
			.toBeInTheDocument();
	});

	it('names the charge on the day it lands', async () => {
		draw();

		await expect.element(page.getByRole('cell', { name: /Gym/ })).toBeInTheDocument();
	});

	it('closes on the day before payday', async () => {
		draw();

		await expect
			.element(page.getByRole('rowheader', { name: `${formatDate('2026-07-31')} *`, exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('cell', { name: formatCurrency(4620) }))
			.toBeInTheDocument();
	});

	it('marks the projected days apart from the banked one', async () => {
		draw();

		await expect.element(page.getByText(/Projected rather than banked/)).toBeInTheDocument();
	});

	it('says so when there is nothing to project from', async () => {
		draw([]);

		await expect.element(page.getByText('No transactions to project from.')).toBeInTheDocument();
	});
});
