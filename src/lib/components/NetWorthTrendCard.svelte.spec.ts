import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NetWorthTrendCard from './NetWorthTrendCard.svelte';
import { formatCurrency, formatDate } from '../format.ts';
import { buildNetWorth } from '../stats/networth.ts';
import { makeTransaction } from '../testing/transaction.ts';

/** Five months of one account, so the "last 3" shortcut has something to cut. */
const worth = buildNetWorth([
	makeTransaction({ date: '2026-04-10', amount: -100, account: 'Cheque', balance: 900 }),
	makeTransaction({ date: '2026-05-10', amount: -100, account: 'Cheque', balance: 800 }),
	makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque', balance: 700 }),
	makeTransaction({ date: '2026-07-10', amount: -100, account: 'Cheque', balance: 600 }),
	makeTransaction({ date: '2026-08-10', amount: -100, account: 'Cheque', balance: 500 })
]);

describe('NetWorthTrendCard.svelte', () => {
	it('opens on the whole history', async () => {
		render(NetWorthTrendCard, { worth });

		await expect
			.element(page.getByText('across all 5 months', { exact: false }))
			.toBeInTheDocument();
	});

	it('cuts the line down to the period chosen', async () => {
		render(NetWorthTrendCard, { worth });

		await page.getByRole('radio', { name: 'Last 3' }).click();

		// The window opens on June, not on April where the history does.
		await expect
			.element(page.getByText(`from ${formatDate('2026-06-10')}`, { exact: false }))
			.toBeInTheDocument();
	});

	it('keeps the level true when the period is cut', async () => {
		render(NetWorthTrendCard, { worth });

		await page.getByRole('radio', { name: 'Last 3' }).click();
		await page.getByRole('radio', { name: 'Table' }).click();

		// June opened at 800, so its own day still reads as a fall of 100 rather
		// than as the line starting again.
		await expect.element(page.getByText(formatCurrency(700)).first()).toBeInTheDocument();
	});

	it('offers no period longer than the history it has', async () => {
		const short = buildNetWorth([
			makeTransaction({ date: '2026-08-10', amount: -100, account: 'Cheque', balance: 500 })
		]);

		render(NetWorthTrendCard, { worth: short });

		await expect.element(page.getByRole('radio', { name: 'Last 12' })).not.toBeInTheDocument();
	});
});
