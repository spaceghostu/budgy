import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NetWorthChart from './NetWorthChart.svelte';
import { formatCurrency } from '../format.ts';
import { buildNetWorth } from '../stats/networth.ts';
import type { NetWorthDay } from '../stats/networth.ts';
import { makeTransaction } from '../testing/transaction.ts';

const worth = buildNetWorth([
	makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque', balance: 900 }),
	makeTransaction({ date: '2026-07-04', amount: -200, account: 'Savings', balance: 4800 }),
	makeTransaction({ date: '2026-08-02', amount: -300, account: 'Cheque', balance: 600 })
]);

interface DrawProps {
	days?: readonly NetWorthDay[];
	opening?: number;
	isRelative?: boolean;
}

function draw(overrides: DrawProps = {}) {
	return render(NetWorthChart, {
		days: worth.days,
		opening: worth.opening,
		isRelative: worth.isRelative,
		...overrides
	});
}

describe('NetWorthChart.svelte', () => {
	it('labels the line with what it ends at', async () => {
		draw();

		await expect.element(page.getByText(formatCurrency(5400))).toBeInTheDocument();
	});

	it('says what the total is, for a reader who cannot see it', async () => {
		draw();

		await expect
			.element(page.getByRole('slider', { name: 'Net worth history cursor' }))
			.toBeInTheDocument();
	});

	it('reads out the day under the cursor', async () => {
		draw();

		const cursor = page.getByRole('slider', { name: 'Net worth history cursor' });
		await cursor.click();
		await userEvent.keyboard('{Home}');

		// Home lands on the opening point, before anything had moved.
		await expect.element(page.getByText('Where the history opens')).toBeInTheDocument();
		await expect.element(page.getByText(formatCurrency(6000))).toBeInTheDocument();
	});

	it('says the level is a shape while an account has no balance', async () => {
		const relative = buildNetWorth([
			makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque' })
		]);

		draw({ days: relative.days, opening: relative.opening, isRelative: true });

		await expect
			.element(page.getByText('A shape rather than money', { exact: false }))
			.toBeInTheDocument();
	});

	it('draws nothing rather than an empty axis before a statement is open', async () => {
		draw({ days: [], opening: 0 });

		await expect.element(page.getByText('No transactions yet.')).toBeInTheDocument();
	});
});
