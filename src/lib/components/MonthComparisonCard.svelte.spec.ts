import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MonthComparisonCard from './MonthComparisonCard.svelte';
import { formatCurrency } from '../format.ts';
import { makeTransaction } from '../testing/transaction.ts';

/**
 * Four whole months of two categories and two merchants, so the "last 3"
 * shortcut has something to cut and April has something to fall out of.
 */
const transactions = [
	makeTransaction({ date: '2026-04-01', amount: -80, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-04-20', amount: -10, category: 'Coffee', merchant: 'Cafe' }),
	makeTransaction({ date: '2026-05-01', amount: -100, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-20', amount: -40, category: 'Coffee', merchant: 'Cafe' }),
	makeTransaction({ date: '2026-06-01', amount: -300, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-15', amount: -60, category: 'Coffee', merchant: 'Cafe' }),
	makeTransaction({ date: '2026-07-01', amount: -500, category: 'Groceries', merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-31', amount: -20, category: 'Coffee', merchant: 'Cafe' })
];

/** Where the page is parked in most of these — the newest month it has. */
const newest = '2026-07';

describe('MonthComparisonCard.svelte', () => {
	it('opens on the last three months rather than the whole statement', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await expect.element(page.getByText('across 3 months', { exact: false })).toBeInTheDocument();
	});

	it('rolls up by category, heaviest first', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		// 900 of groceries across May, June and July — April is not in the window.
		await expect.element(page.getByText(formatCurrency(900)).first()).toBeInTheDocument();
	});

	it('says what moved between the last two months', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await expect
			.element(page.getByText('+R200.00 (67%) on Jun 2026', { exact: false }))
			.toBeInTheDocument();
	});

	it('rolls up by merchant when asked', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await page.getByRole('radio', { name: 'Merchant' }).click();

		await expect.element(page.getByText('Shop').first()).toBeInTheDocument();
		await expect
			.element(page.getByText('by merchant', { exact: false }).first())
			.toBeInTheDocument();
	});

	it('widens to every month the statement has', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await page.getByRole('radio', { name: 'All' }).click();

		await expect.element(page.getByText('across 4 months', { exact: false })).toBeInTheDocument();
	});

	it('follows the month the page is parked on until the reader chooses', async () => {
		// Parked on May, the window ends at May rather than at the newest month.
		render(MonthComparisonCard, { transactions, focusMonth: '2026-05' });

		await page.getByRole('radio', { name: 'Table' }).click();

		await expect.element(page.getByRole('columnheader', { name: 'May 2026' })).toBeInTheDocument();
		await expect
			.element(page.getByRole('columnheader', { name: 'Jul 2026' }))
			.not.toBeInTheDocument();
	});

	it('lays every figure out as text as well', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await page.getByRole('radio', { name: 'Table' }).click();

		await expect.element(page.getByRole('rowheader', { name: 'Groceries' })).toBeInTheDocument();
		await expect.element(page.getByRole('columnheader', { name: 'Change' })).toBeInTheDocument();
		// The bottom line adds every category up, not only the ones the chart drew.
		await expect.element(page.getByRole('rowheader', { name: 'All spending' })).toBeInTheDocument();
	});

	it('drops a month the reader turns off', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await page.getByRole('button', { name: 'May 2026' }).click();

		await expect.element(page.getByText('across 2 months', { exact: false })).toBeInTheDocument();
	});

	it('says there is nothing to compare against a single month', async () => {
		render(MonthComparisonCard, {
			transactions: [makeTransaction({ date: '2026-07-01', amount: -100 })],
			focusMonth: newest
		});

		await expect
			.element(page.getByText('pick a second month', { exact: false }))
			.toBeInTheDocument();
	});

	it('opens a label across every month compared', async () => {
		const opened: { label: string; months: readonly string[]; dimension: string }[] = [];
		render(MonthComparisonCard, {
			transactions,
			focusMonth: newest,
			onselect: (label, months, dimension) => opened.push({ label, months, dimension })
		});

		await page.getByRole('button', { name: 'Groceries, every month compared' }).click();

		expect(opened).toEqual([
			{ label: 'Groceries', months: ['2026-05', '2026-06', '2026-07'], dimension: 'category' }
		]);
	});

	it('opens one month when that month’s own bar was clicked', async () => {
		const opened: { label: string; months: readonly string[] }[] = [];
		render(MonthComparisonCard, {
			transactions,
			focusMonth: newest,
			onselect: (label, months) => opened.push({ label, months })
		});

		await page.getByRole('button', { name: /Groceries in Jun 2026/ }).click();

		expect(opened).toEqual([{ label: 'Groceries', months: ['2026-06'] }]);
	});

	it('carries the dimension it was rolled up by', async () => {
		const opened: string[] = [];
		render(MonthComparisonCard, {
			transactions,
			focusMonth: newest,
			onselect: (_label, _months, dimension) => opened.push(dimension)
		});

		await page.getByRole('radio', { name: 'Merchant' }).click();
		await page.getByRole('button', { name: 'Shop, every month compared' }).click();

		expect(opened).toEqual(['merchant']);
	});

	it('opens the same rows from the table twin', async () => {
		const opened: { label: string; months: readonly string[] }[] = [];
		render(MonthComparisonCard, {
			transactions,
			focusMonth: newest,
			onselect: (label, months) => opened.push({ label, months })
		});

		await page.getByRole('radio', { name: 'Table' }).click();
		await page.getByRole('button', { name: /Groceries in Jun 2026/ }).click();

		expect(opened).toEqual([{ label: 'Groceries', months: ['2026-06'] }]);
	});

	it('offers no way into a month that took nothing', async () => {
		// An empty list is not an answer anyone clicked for.
		render(MonthComparisonCard, {
			transactions: [
				...transactions,
				makeTransaction({ date: '2026-07-02', amount: -70, category: 'Fuel', merchant: 'Garage' })
			],
			focusMonth: newest,
			onselect: () => {}
		});

		await page.getByRole('radio', { name: 'Table' }).click();

		await expect
			.element(page.getByRole('button', { name: /Fuel in Jul 2026/ }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: /Fuel in Jun 2026/ }))
			.not.toBeInTheDocument();
	});

	it('is a picture, not a way in, when nothing handles a click', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await expect
			.element(page.getByRole('button', { name: 'Groceries, every month compared' }))
			.not.toBeInTheDocument();
	});

	it('offers no window longer than the statement it has', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await expect.element(page.getByRole('radio', { name: 'Last 6' })).not.toBeInTheDocument();
	});
});

describe('MonthComparisonCard.svelte, opening the long tail', () => {
	/** Ten categories against a limit of eight, so two fall into the tail. */
	const wide = Array.from({ length: 10 }, (_, index) =>
		makeTransaction({
			date: '2026-07-01',
			amount: -(100 - index),
			category: `Category ${index}`,
			merchant: `Merchant ${index}`
		})
	);

	it('folds the tail into a row that says how many it stands for', async () => {
		render(MonthComparisonCard, { transactions: wide, focusMonth: newest });

		await expect.element(page.getByText('Other (2)')).toBeInTheDocument();
		await expect.element(page.getByText('Category 9')).not.toBeInTheDocument();
	});

	it('opens the fold rather than drilling into it', async () => {
		// "Other" names no category, so it can never open a list of transactions.
		const opened: string[] = [];
		render(MonthComparisonCard, {
			transactions: wide,
			focusMonth: newest,
			onselect: (label) => opened.push(label)
		});

		await page.getByRole('button', { name: /Other \(2\)/ }).click();

		expect(opened).toEqual([]);
		await expect.element(page.getByText('Category 9').first()).toBeInTheDocument();
		await expect.element(page.getByText('Other (2)')).not.toBeInTheDocument();
	});

	it('lets a label out of the tail open one month, like any other', async () => {
		const opened: { label: string; months: readonly string[] }[] = [];
		render(MonthComparisonCard, {
			transactions: wide,
			focusMonth: newest,
			onselect: (label, months) => opened.push({ label, months })
		});

		await page.getByRole('button', { name: /Other \(2\)/ }).click();
		await page.getByRole('button', { name: /Category 9 in Jul 2026/ }).click();

		expect(opened).toEqual([{ label: 'Category 9', months: ['2026-07'] }]);
	});

	it('folds back up again', async () => {
		render(MonthComparisonCard, { transactions: wide, focusMonth: newest });

		await page.getByRole('button', { name: /Other \(2\)/ }).click();
		await page.getByRole('button', { name: 'Show fewer' }).click();

		await expect.element(page.getByText('Other (2)')).toBeInTheDocument();
	});

	it('never folds a comparison short enough to show whole', async () => {
		render(MonthComparisonCard, { transactions, focusMonth: newest });

		await expect.element(page.getByText('Other (', { exact: false })).not.toBeInTheDocument();
	});
});
