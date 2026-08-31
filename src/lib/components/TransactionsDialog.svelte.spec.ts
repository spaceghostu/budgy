import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TransactionsDialog from './TransactionsDialog.svelte';
import { formatCurrency } from '../format.ts';
import { applyCategoryRules } from '../categorise.ts';
import { drillInto } from '../stats/compare.ts';
import { makeTransaction } from '../testing/transaction.ts';

const transactions = [
	makeTransaction({ date: '2026-06-01', amount: -100, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-20', amount: -300, category: 'Groceries', merchant: 'Deli' }),
	makeTransaction({ date: '2026-07-01', amount: -50, category: 'Coffee', merchant: 'Cafe' })
];

const groceries = drillInto(transactions, 'category', 'Groceries');

describe('TransactionsDialog.svelte', () => {
	it('stays shut until something is opened', async () => {
		render(TransactionsDialog, { drilldown: null, onclose: () => {} });

		await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('names the label it was opened from', async () => {
		render(TransactionsDialog, { drilldown: groceries, onclose: () => {} });

		await expect.element(page.getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
	});

	it('totals to the figure the bar showed', async () => {
		render(TransactionsDialog, { drilldown: groceries, onclose: () => {} });

		await expect
			.element(page.getByText('across 2 transactions', { exact: false }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('across 2 transactions', { exact: false }))
			.toBeInTheDocument();
	});

	it('lists the rows behind it, newest first', async () => {
		render(TransactionsDialog, { drilldown: groceries, onclose: () => {} });

		await expect.element(page.getByText('Deli')).toBeInTheDocument();
		await expect.element(page.getByText('Shop')).toBeInTheDocument();
	});

	it('says which period the figures cover', async () => {
		render(TransactionsDialog, {
			drilldown: groceries,
			periodLabel: '1 Jun 2026 – 31 Jul 2026',
			onclose: () => {}
		});

		await expect
			.element(page.getByText('1 Jun 2026 – 31 Jul 2026', { exact: false }))
			.toBeInTheDocument();
	});

	it('names the month instead when the figure stood for one', async () => {
		render(TransactionsDialog, {
			drilldown: drillInto(transactions, 'category', 'Groceries', ['2026-06']),
			periodLabel: '1 Jun 2026 – 31 Jul 2026',
			onclose: () => {}
		});

		await expect.element(page.getByText('in Jun 2026', { exact: false })).toBeInTheDocument();
	});

	it('does not drop the keyboard reader at the top of the page on close', async () => {
		// Opened from a bar rather than from a Dialog.Trigger, so there is no
		// trigger for the primitive to hand focus back to. Landing on <body> would
		// mean tabbing down the whole page again to reach the next bar.
		const { rerender } = render(TransactionsDialog, { drilldown: null, onclose: () => {} });

		const bar = document.createElement('button');
		bar.textContent = 'Groceries';
		document.body.append(bar);
		bar.focus();

		await rerender({ drilldown: groceries, onclose: () => {} });
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();

		await rerender({ drilldown: null, onclose: () => {} });

		await expect.poll(() => document.activeElement).toBe(bar);
		bar.remove();
	});

	it('closes on Escape, and says so upwards', async () => {
		let closed = false;
		render(TransactionsDialog, { drilldown: groceries, onclose: () => (closed = true) });

		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await page
			.getByRole('dialog')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await expect.poll(() => closed).toBe(true);
	});
});

describe('TransactionsDialog.svelte, re-filing from it', () => {
	const options = ['Coffee', 'Eating Out and Takeouts', 'Groceries'];

	it('reads only, until it is given somewhere to send a choice', async () => {
		render(TransactionsDialog, { drilldown: groceries, onclose: () => {} });

		await expect.element(page.getByRole('combobox')).not.toBeInTheDocument();
	});

	it('offers a category per merchant, not per transaction', async () => {
		// A rule is keyed by merchant, so one control per merchant is the truth
		// about what a choice here does. Two merchants, two pickers.
		render(TransactionsDialog, {
			drilldown: groceries,
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await expect
			.element(page.getByRole('combobox', { name: 'Category for Shop' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('combobox', { name: 'Category for Deli' }))
			.toBeInTheDocument();
	});

	it('shows what a merchant is filed under now', async () => {
		render(TransactionsDialog, {
			drilldown: groceries,
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await expect
			.element(page.getByRole('combobox', { name: 'Category for Shop' }))
			.toHaveTextContent('Groceries');
	});

	it('sends the choice up, against the merchant it was made for', async () => {
		const chosen: [string, string][] = [];
		render(TransactionsDialog, {
			drilldown: groceries,
			options,
			onassign: (merchant, category) => chosen.push([merchant, category]),
			onclose: () => {}
		});

		await page.getByRole('combobox', { name: 'Category for Shop' }).click();
		await page.getByRole('option', { name: 'Coffee' }).click();

		expect(chosen).toEqual([['Shop', 'Coffee']]);
	});

	it('says how far the choice reaches before it is made', async () => {
		render(TransactionsDialog, {
			drilldown: groceries,
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await expect
			.element(page.getByText('Files 1 transaction from Shop', { exact: false }))
			.toBeInTheDocument();
	});

	it('says so plainly when the last row has been filed elsewhere', async () => {
		// The drill-down is re-derived as rules change, so a category emptied from
		// inside the dialog leaves it open and empty rather than showing old rows.
		render(TransactionsDialog, {
			drilldown: drillInto([], 'category', 'Groceries'),
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await expect
			.element(page.getByText('Nothing is filed under this category any more'))
			.toBeInTheDocument();
	});
});

describe('TransactionsDialog.svelte, as the statement changes under it', () => {
	const options = ['Coffee', 'Groceries'];

	/**
	 * What the page's derived does: the dialog is handed rows re-derived from the
	 * current statement, not the snapshot taken when the bar was clicked. Filing a
	 * merchant elsewhere has to move it out from under the open dialog, the same
	 * way it moves the bar behind it.
	 */
	function groceriesAfter(rules: Record<string, string>) {
		return drillInto(applyCategoryRules(transactions, rules), 'category', 'Groceries');
	}

	it('drops a merchant re-filed out of the open category, and retotals', async () => {
		const { rerender } = render(TransactionsDialog, {
			drilldown: groceriesAfter({}),
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await expect
			.element(page.getByRole('combobox', { name: 'Category for Shop' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText('across 2 transactions', { exact: false }))
			.toBeInTheDocument();

		await rerender({ drilldown: groceriesAfter({ Shop: 'Coffee' }) });

		await expect
			.element(page.getByRole('combobox', { name: 'Category for Shop' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('combobox', { name: 'Category for Deli' }))
			.toBeInTheDocument();
		// The header follows the rows rather than the click that opened them.
		await expect
			.element(page.getByText('across 1 transaction in', { exact: false }))
			.toBeInTheDocument();
		await expect.element(page.getByText(formatCurrency(300)).first()).toBeInTheDocument();
	});

	it('stays open and says so when the last merchant is re-filed away', async () => {
		const { rerender } = render(TransactionsDialog, {
			drilldown: groceriesAfter({}),
			options,
			onassign: () => {},
			onclose: () => {}
		});

		await rerender({ drilldown: groceriesAfter({ Shop: 'Coffee', Deli: 'Coffee' }) });

		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await expect
			.element(page.getByText('Nothing is filed under this category any more'))
			.toBeInTheDocument();
	});
});
