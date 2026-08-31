import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BarList from './BarList.svelte';
import { bucketBy } from '../stats/insights.ts';
import { makeTransaction } from '../testing/transaction.ts';

const buckets = bucketBy(
	[
		makeTransaction({ date: '2026-06-01', amount: -300, category: 'Groceries' }),
		makeTransaction({ date: '2026-06-02', amount: -100, category: 'Coffee' }),
		makeTransaction({ date: '2026-06-03', amount: -50, category: '' })
	],
	(transaction) => transaction.category
);

/** Twelve buckets against a limit of eight, so four fall into the tail. */
const many = bucketBy(
	Array.from({ length: 12 }, (_, index) =>
		makeTransaction({
			date: '2026-06-01',
			amount: -(100 - index),
			category: `Category ${index}`
		})
	),
	(transaction) => transaction.category
);

describe('BarList.svelte', () => {
	it('is a picture, not a way in, when nothing handles a click', async () => {
		render(BarList, { buckets });

		await expect.element(page.getByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
	});

	it('opens the rows behind a bar', async () => {
		let opened = '';
		render(BarList, { buckets, onselect: (label) => (opened = label) });

		await page.getByRole('button', { name: /Groceries/ }).click();

		expect(opened).toBe('Groceries');
	});

	it('hands back the name the bank left blank, not an empty string', async () => {
		// The bar counts a blank category under this name, so the click has to
		// carry the same one or the list behind it comes back empty.
		let opened = '';
		render(BarList, { buckets, onselect: (label) => (opened = label) });

		await page.getByRole('button', { name: /Uncategorised/ }).click();

		expect(opened).toBe('Uncategorised');
	});

	it('opens the folded row rather than drilling into it', async () => {
		// "Other" names no category, so it can never open a list of transactions.
		// It opens the rows it stands for instead, and must not be mistaken for
		// the way in that every row beside it offers.
		let opened = '';
		render(BarList, { buckets: many, onselect: (label) => (opened = label) });

		await page.getByRole('button', { name: /Other \(4\)/ }).click();

		expect(opened).toBe('');
		await expect.element(page.getByText('Category 11')).toBeInTheDocument();
	});

	it('shows every row once the tail is open', async () => {
		render(BarList, { buckets: many });

		await expect.element(page.getByText('Category 8')).not.toBeInTheDocument();

		await page.getByRole('button', { name: /Other \(4\)/ }).click();

		for (const index of [8, 9, 10, 11]) {
			await expect.element(page.getByText(`Category ${index}`)).toBeInTheDocument();
		}
		await expect.element(page.getByText('Other (4)')).not.toBeInTheDocument();
	});

	it('lets a row out of the tail open its transactions like any other', async () => {
		let opened = '';
		render(BarList, { buckets: many, onselect: (label) => (opened = label) });

		await page.getByRole('button', { name: /Other \(4\)/ }).click();
		await page.getByRole('button', { name: /Category 11/ }).click();

		expect(opened).toBe('Category 11');
	});

	it('folds back up again', async () => {
		render(BarList, { buckets: many });

		await page.getByRole('button', { name: /Other \(4\)/ }).click();
		await page.getByRole('button', { name: 'Show fewer' }).click();

		await expect.element(page.getByText('Other (4)')).toBeInTheDocument();
		await expect.element(page.getByText('Category 11')).not.toBeInTheDocument();
	});

	it('never folds a list short enough to show whole', async () => {
		render(BarList, { buckets });

		await expect.element(page.getByText('Other', { exact: false })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Show fewer' })).not.toBeInTheDocument();
	});
});
