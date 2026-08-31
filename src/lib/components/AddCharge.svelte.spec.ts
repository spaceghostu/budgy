import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AddCharge from './AddCharge.svelte';
import type { Payee } from '../stats/forecast.ts';

const PAYEES: readonly Payee[] = [
	{ merchant: 'Vet', flow: 'expense', amount: 350, months: 2, arrived: false },
	{ merchant: 'Employer', flow: 'income', amount: 10_000, months: 6, arrived: false }
];

function draw(payees: readonly Payee[] = PAYEES, monthStart = 1, month = '2026-07') {
	const onadd = vi.fn();
	render(AddCharge, { props: { payees, monthStart, month, onadd } });

	return onadd;
}

async function openForm(): Promise<void> {
	await page.getByRole('button', { name: 'Add a payment' }).click();
}

describe('AddCharge.svelte', () => {
	it('vouches for a payee the statement already has', async () => {
		const onadd = draw();
		await openForm();

		await page.getByRole('button', { name: 'Pick from history' }).click();
		await page.getByRole('option', { name: /Vet/ }).click();

		// What it will be expected for is said before it is added.
		await expect.element(page.getByText(/R350\.00 a month across 2 months/)).toBeInTheDocument();

		await page.getByRole('button', { name: 'Add it' }).click();

		expect(onadd).toHaveBeenCalledWith({ kind: 'merchant', merchant: 'Vet', flow: 'expense' });
	});

	it('asks for nothing a vouched-for payee already answers', async () => {
		draw();
		await openForm();

		await expect.element(page.getByLabelText('Amount')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Pick from history' }).click();
		await page.getByRole('option', { name: /Vet/ }).click();

		expect(await page.getByLabelText('Amount').all()).toHaveLength(0);
	});

	it('takes a charge with nothing in the statement behind it', async () => {
		const onadd = draw();
		await openForm();

		await page.getByLabelText('Payee').fill('Rent');
		await page.getByLabelText('Amount').fill('8000');
		await page.getByLabelText('Day of the month').fill('25');
		await page.getByRole('button', { name: 'Add it' }).click();

		expect(onadd).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'custom',
				name: 'Rent',
				flow: 'expense',
				amount: 8000,
				day: 25
			})
		);
	});

	it('offers only the payees on the side of the money being added', async () => {
		draw();
		await openForm();

		await page.getByRole('button', { name: 'Pick from history' }).click();
		await expect.element(page.getByRole('option', { name: /Vet/ })).toBeInTheDocument();
		expect(await page.getByRole('option', { name: /Employer/ }).all()).toHaveLength(0);

		await userEvent.keyboard('{Escape}');
		await page.getByRole('radio', { name: 'Money in' }).click();
		await page.getByRole('button', { name: 'Pick from history' }).click();

		await expect.element(page.getByRole('option', { name: /Employer/ })).toBeInTheDocument();
	});

	it('says what is missing rather than taking half a charge', async () => {
		draw();
		await openForm();

		await expect
			.element(page.getByText('Name the payee, or pick one from the list.'))
			.toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Add it' })).toBeDisabled();

		await page.getByLabelText('Payee').fill('Rent');
		await expect.element(page.getByText('How much is it for?')).toBeVisible();

		await page.getByLabelText('Amount').fill('8000');
		await expect.element(page.getByText(/Which day of the month/)).toBeVisible();

		await page.getByLabelText('Day of the month').fill('25');
		await expect.element(page.getByRole('button', { name: 'Add it' })).toBeEnabled();
	});

	it('warns that a late day lands on the last day of a short month', async () => {
		draw();
		await openForm();

		await page.getByLabelText('Payee').fill('Rent');
		await page.getByLabelText('Day of the month').fill('31');

		await expect
			.element(page.getByText(/The 31st falls on the last day of a month that has none/))
			.toBeInTheDocument();
	});

	it('offers no list where the statement has no payees to offer', async () => {
		draw([]);
		await openForm();

		await expect.element(page.getByRole('button', { name: 'Pick from history' })).toBeDisabled();
	});

	it('says a payee that has already billed will have to wait for next month', async () => {
		draw([{ merchant: 'Vet', flow: 'expense', amount: 350, months: 2, arrived: true }]);
		await openForm();

		await page.getByRole('button', { name: 'Pick from history' }).click();
		await page.getByRole('option', { name: /Vet/ }).click();

		await expect
			.element(page.getByText(/already billed this month, so it will be expected from next month/))
			.toBeInTheDocument();
	});

	it('says which date a day of the month lands on', async () => {
		draw();
		await openForm();

		await page.getByLabelText('Day of the month').fill('15');

		await expect.element(page.getByText(/Lands on 15 Jul 2026 this month/)).toBeInTheDocument();
	});

	it('counts the day from the day the reader’s months open on', async () => {
		// Months from the 25th: the forecast reads this field as a day of *that*
		// month, so day 1 is the 25th and a bare "day of the month" would be a lie.
		draw(PAYEES, 25);
		await openForm();

		await expect.element(page.getByLabelText('Day of your month')).toBeInTheDocument();

		await page.getByLabelText('Day of your month').fill('1');

		await expect
			.element(page.getByText(/Day 1 is the 25th, so this lands on 25 Jun 2026 this month/))
			.toBeInTheDocument();
	});
});
