import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CategoryOutlookList from './CategoryOutlookList.svelte';
import { formatCurrency } from '../format.ts';
import type { CategoryOutlook } from '../stats/runway.ts';

/** A row built by hand, so a case can be aimed at exactly one property. */
function row(
	overrides: Partial<CategoryOutlook> & Pick<CategoryOutlook, 'category'>
): CategoryOutlook {
	const named = overrides.named ?? 0;
	const everyday = overrides.everyday ?? 0;

	return {
		named,
		everyday,
		total: named + everyday,
		count: overrides.count ?? (named > 0 ? 1 : 0),
		share: 0.5,
		...overrides
	};
}

const ROWS: readonly CategoryOutlook[] = [
	row({ category: 'Gym', named: 300 }),
	row({ category: 'Groceries', everyday: 240 }),
	row({ category: 'Coffee', named: 50, everyday: 30, count: 2 })
];

describe('CategoryOutlookList.svelte', () => {
	it('names a category and what it still has to take', async () => {
		const rendered = render(CategoryOutlookList, { props: { rows: ROWS, everydayOn: true } });

		await expect.element(rendered.getByText('Gym')).toBeInTheDocument();
		await expect.element(rendered.getByText(formatCurrency(300)).first()).toBeInTheDocument();
	});

	it('says a named-only row is charges rather than usual spending', async () => {
		// The distinction is the point of the list: one is a debit order with a
		// date on it, the other is a habit the reader can still choose about.
		const rendered = render(CategoryOutlookList, {
			props: { rows: [row({ category: 'Gym', named: 300 })], everydayOn: true }
		});

		await expect.element(rendered.getByText('1 charge', { exact: false })).toBeInTheDocument();
	});

	it('calls an everyday-only row usual spending', async () => {
		const rendered = render(CategoryOutlookList, {
			props: { rows: [row({ category: 'Groceries', everyday: 240 })], everydayOn: true }
		});

		await expect
			.element(rendered.getByText('of usual spending', { exact: false }))
			.toBeInTheDocument();
	});

	it('says both halves where a category has both', async () => {
		const rendered = render(CategoryOutlookList, {
			props: {
				rows: [row({ category: 'Coffee', named: 50, everyday: 30, count: 2 })],
				everydayOn: true
			}
		});

		await expect.element(rendered.getByText('2 charges', { exact: false })).toBeInTheDocument();
		await expect.element(rendered.getByText('plus', { exact: false })).toBeInTheDocument();
	});

	it('folds a long tail into one row, and opens it', async () => {
		const many = Array.from({ length: 12 }, (_, index) =>
			row({ category: `Category ${index}`, everyday: 100 - index })
		);
		const rendered = render(CategoryOutlookList, { props: { rows: many, everydayOn: true } });

		expect(rendered.getByText('Category 9', { exact: true }).elements()).toHaveLength(0);

		await rendered.getByRole('button', { name: 'Show all 12' }).click();

		await expect.element(rendered.getByText('Category 9', { exact: true })).toBeInTheDocument();
	});

	it('says which question it is answering when it has nothing to show', async () => {
		const rendered = render(CategoryOutlookList, { props: { rows: [], everydayOn: false } });

		await expect
			.element(rendered.getByText('No named charges left before payday.'))
			.toBeInTheDocument();
	});
});
