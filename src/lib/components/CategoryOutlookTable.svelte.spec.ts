import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CategoryOutlookTable from './CategoryOutlookTable.svelte';
import { formatCurrency } from '../format.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway } from '../stats/runway.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/**
 * The runway spec's two months, filed by category — the gym a debit order, the
 * cafe and the shop too variable to be named, so they land in the everyday
 * channel and the two halves of a row are both exercised.
 */
const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop', category: 'Groceries' }),
	makeTransaction({
		date: '2026-05-10',
		amount: -300,
		merchant: 'Gym',
		category: 'Gym',
		type: 'Debit order'
	}),
	makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe', category: 'Coffee' }),
	makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop', category: 'Groceries' }),
	makeTransaction({
		date: '2026-06-10',
		amount: -300,
		merchant: 'Gym',
		category: 'Gym',
		type: 'Debit order'
	}),
	makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe', category: 'Coffee' }),
	makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop', category: 'Groceries' })
];

function draw(everydayOn = true) {
	const runway = buildRunway(buildForecast(STATEMENT, { metric: 'net', everyday: everydayOn }), {
		balance: 5000
	});

	return {
		rendered: render(CategoryOutlookTable, { props: { rows: runway.byCategory, everydayOn } }),
		runway
	};
}

describe('CategoryOutlookTable.svelte', () => {
	it('names a category and what it still has to take', async () => {
		const { rendered, runway } = draw();
		const gym = runway.byCategory.find((row) => row.category === 'Gym');

		await expect.element(rendered.getByRole('rowheader', { name: 'Gym' })).toBeInTheDocument();
		await expect
			.element(rendered.getByRole('cell', { name: formatCurrency(gym?.total ?? 0) }).first())
			.toBeInTheDocument();
	});

	it('keeps the named charge and the everyday drift in their own columns', async () => {
		const { rendered } = draw();

		await expect.element(rendered.getByText('Named', { exact: true })).toBeInTheDocument();
		await expect.element(rendered.getByText('Everyday', { exact: true })).toBeInTheDocument();
	});

	it('drops the everyday column when the channel is not counted', async () => {
		// Scoped to this render: the column has to be absent from *this* table,
		// which an unscoped query cannot say while earlier renders are still up.
		const { rendered } = draw(false);

		await expect.element(rendered.getByText('Named', { exact: true })).toBeInTheDocument();
		expect(rendered.getByText('Everyday', { exact: true }).elements()).toHaveLength(0);
	});

	it('says which question it is answering when it has nothing to show', async () => {
		const rendered = render(CategoryOutlookTable, { props: { rows: [], everydayOn: false } });

		await expect
			.element(rendered.getByText('No named charges left before payday.'))
			.toBeInTheDocument();
	});
});
