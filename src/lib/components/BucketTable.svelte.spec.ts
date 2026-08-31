import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BucketTable from './BucketTable.svelte';
import { bucketBy } from '../stats/insights.ts';
import { makeTransaction } from '../testing/transaction.ts';

const buckets = bucketBy(
	[
		makeTransaction({ date: '2026-06-01', amount: -300, category: 'Groceries' }),
		makeTransaction({ date: '2026-06-02', amount: -100, category: 'Coffee' })
	],
	(transaction) => transaction.category
);

describe('BucketTable.svelte', () => {
	it('reads as plain text when nothing handles a click', async () => {
		render(BucketTable, { buckets, heading: 'Category' });

		await expect.element(page.getByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
		await expect.element(page.getByText('Groceries')).toBeInTheDocument();
	});

	it('offers the same way in as the chart it stands for', async () => {
		// The two views of a card cannot disagree about what a reader may do.
		let opened = '';
		render(BucketTable, {
			buckets,
			heading: 'Category',
			onselect: (label) => (opened = label)
		});

		await page.getByRole('button', { name: /Groceries/ }).click();

		expect(opened).toBe('Groceries');
	});
});
