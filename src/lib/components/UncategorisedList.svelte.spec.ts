import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UncategorisedList from './UncategorisedList.svelte';
import type { MerchantGroup } from '../categorise.ts';

const OPTIONS = ['Coffee', 'Groceries', 'Homeware'];

/**
 * The category picker is a combobox rather than a native select, so choosing
 * means opening it and pressing the option.
 */
async function chooseCategory(merchant: string, category: string): Promise<void> {
	await page.getByLabelText(`Category for ${merchant}`).click();
	await page.getByRole('option', { name: category }).click();
}

/**
 * Put the picker away before the test ends. Tearing the component down with it
 * still open leaves the panel mid-teardown, which is not a state a reader can
 * reach and only makes the run noisy.
 */
async function closePicker(): Promise<void> {
	await userEvent.keyboard('{Escape}');
	await expect.element(page.getByPlaceholder('Find a category…')).not.toBeInTheDocument();
}

function group(overrides: Partial<MerchantGroup> & Pick<MerchantGroup, 'merchant'>): MerchantGroup {
	return {
		count: 2,
		total: 200,
		lastSeen: '2026-01-09',
		example: '',
		suggestion: null,
		...overrides
	};
}

describe('UncategorisedList.svelte', () => {
	it('says what is unfiled, and what it costs', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP', count: 3, total: 1240.5 })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await expect.element(page.getByText('CORNER SHOP')).toBeInTheDocument();
		await expect.element(page.getByText('3 transactions', { exact: false })).toBeInTheDocument();
	});

	it('files every transaction from the merchant under the chosen category', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign
		});

		await chooseCategory('CORNER SHOP', 'Groceries');

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Groceries');
	});

	it('narrows the category list to what is typed into it', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign
		});

		await page.getByLabelText('Category for CORNER SHOP').click();
		await page.getByPlaceholder('Find a category…').fill('gro');

		await expect.element(page.getByRole('option', { name: 'Groceries' })).toBeInTheDocument();
		await expect.element(page.getByRole('option', { name: 'Coffee' })).not.toBeInTheDocument();

		await page.getByRole('option', { name: 'Groceries' }).click();

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Groceries');
	});

	it('says so rather than showing an empty list when nothing matches', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await page.getByLabelText('Category for CORNER SHOP').click();
		await page.getByPlaceholder('Find a category…').fill('zzz');

		await expect.element(page.getByText('No category by that name.')).toBeInTheDocument();

		await closePicker();
	});

	it('offers the categories last used before the alphabetical list', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			recent: ['Homeware', 'Coffee'],
			onassign: vi.fn()
		});

		await page.getByLabelText('Category for CORNER SHOP').click();

		// Shortlist first, in the order last used, then the rest alphabetically —
		// and nothing repeated between the two.
		await expect
			.element(page.getByRole('listbox'))
			.toHaveTextContent(/Recent.*Homeware.*Coffee.*All categories.*Groceries/s);
		expect(await page.getByRole('option', { name: 'Coffee' }).all()).toHaveLength(1);

		await closePicker();
	});

	it('files the merchant from the keyboard alone', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			recent: ['Homeware'],
			onassign
		});

		// The arrow that opens a listbox, then the first shortlisted category.
		await page.getByLabelText('Category for CORNER SHOP').element().focus();
		await userEvent.keyboard('{ArrowDown}');
		await expect.element(page.getByPlaceholder('Find a category…')).toBeInTheDocument();

		await userEvent.keyboard('{Enter}');

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Homeware');
	});

	it('walks the list with the arrow keys', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign
		});

		await page.getByLabelText('Category for CORNER SHOP').click();
		await expect.element(page.getByPlaceholder('Find a category…')).toBeInTheDocument();

		// Coffee is first alphabetically, so one step down lands on Groceries.
		await userEvent.keyboard('{ArrowDown}{Enter}');

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Groceries');
	});

	/**
	 * Focus is what moved the page: the panel is taller than the room under a
	 * trigger low down the list, so letting the browser focus into it scrolled the
	 * whole page. The picker takes focus itself instead, which is both why the page
	 * stays put and why typing works the moment it opens.
	 */
	it('puts the cursor in the search box, and hands it back on the way out', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		const trigger = page.getByLabelText('Category for CORNER SHOP');
		await trigger.click();

		await expect.element(page.getByPlaceholder('Find a category…')).toHaveFocus();

		await closePicker();

		await expect.element(trigger).toHaveFocus();
	});

	it('offers a category these files never use, so an earlier choice can be kept', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [],
			applied: [{ merchant: 'LANDLORD', category: 'Rent', count: 0 }],
			options: OPTIONS,
			onassign
		});

		await page.getByLabelText('Category for LANDLORD').click();

		await expect.element(page.getByRole('option', { name: 'Rent' })).toBeInTheDocument();

		await closePicker();
	});

	it('offers the category the merchant already carries as one press', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'GROCER', suggestion: 'Groceries' })],
			applied: [],
			options: OPTIONS,
			onassign
		});

		await page.getByRole('button', { name: 'Use Groceries' }).click();

		expect(onassign).toHaveBeenCalledWith('GROCER', 'Groceries');
	});

	it('files a merchant under a category of the reader’s own', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();
		await page.getByLabelText('New category (CORNER SHOP)').fill('School fees');
		await page.getByRole('button', { name: 'Add' }).click();

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'School fees');
	});

	it('will not add a name that says nothing', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();

		await expect.element(page.getByRole('button', { name: 'Add' })).toBeDisabled();
	});

	it('says so rather than quietly making a second Groceries', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();
		await page.getByLabelText('New category (CORNER SHOP)').fill('groceries');

		await expect.element(page.getByText('There is already a Groceries')).toBeInTheDocument();
	});

	it('refuses to make one out of what the rows already are', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();
		await page.getByLabelText('New category (CORNER SHOP)').fill('Uncategorised');

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Add' })).toBeDisabled();
	});

	it('gives up naming one and hands the list of categories back', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'CORNER SHOP' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect.element(page.getByLabelText('Category for CORNER SHOP')).toBeInTheDocument();
	});

	it('makes one for a merchant already filed, without clearing it first', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [],
			applied: [{ merchant: 'CORNER SHOP', category: 'Homeware', count: 2 }],
			options: OPTIONS,
			onassign
		});

		await page.getByRole('button', { name: 'New category (CORNER SHOP)' }).click();
		await page.getByLabelText('New category (CORNER SHOP)').fill('Groceries');
		await page.getByRole('button', { name: 'Add' }).click();

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Groceries');
	});

	it('shows the line a coded merchant name came from', async () => {
		render(UncategorisedList, {
			pending: [group({ merchant: 'ABC', example: 'ABC PTY LTD 998877' })],
			applied: [],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await expect.element(page.getByText('ABC PTY LTD 998877')).toBeInTheDocument();
	});

	it('keeps a long list short until it is asked to grow', async () => {
		const pending = Array.from({ length: 9 }, (_, index) =>
			group({ merchant: `MERCHANT ${index}`, total: 100 - index })
		);
		render(UncategorisedList, { pending, applied: [], options: OPTIONS, onassign: vi.fn() });

		await expect.element(page.getByText('MERCHANT 8')).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Show all 9' }).click();
		await expect.element(page.getByText('MERCHANT 8')).toBeInTheDocument();
	});

	it('lists the choices already made, so one can be changed', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [],
			applied: [{ merchant: 'CORNER SHOP', category: 'Homeware', count: 2 }],
			options: OPTIONS,
			onassign
		});

		await chooseCategory('CORNER SHOP', 'Coffee');

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', 'Coffee');
	});

	it('takes a choice back off again', async () => {
		const onassign = vi.fn();
		render(UncategorisedList, {
			pending: [],
			applied: [{ merchant: 'CORNER SHOP', category: 'Homeware', count: 2 }],
			options: OPTIONS,
			onassign
		});

		await page.getByRole('button', { name: 'Clear the choice for CORNER SHOP' }).click();

		expect(onassign).toHaveBeenCalledWith('CORNER SHOP', '');
	});

	it('still shows a choice made against a category these files never use', async () => {
		render(UncategorisedList, {
			pending: [],
			applied: [{ merchant: 'LANDLORD', category: 'Rent', count: 0 }],
			options: OPTIONS,
			onassign: vi.fn()
		});

		await expect.element(page.getByLabelText('Category for LANDLORD')).toHaveTextContent('Rent');
		await expect.element(page.getByText('nothing in these files')).toBeInTheDocument();
	});

	it('says so when there is nothing left to file', async () => {
		render(UncategorisedList, { pending: [], applied: [], options: OPTIONS, onassign: vi.fn() });

		await expect
			.element(page.getByText('Every transaction in this period is filed under something.'))
			.toBeInTheDocument();
	});
});
