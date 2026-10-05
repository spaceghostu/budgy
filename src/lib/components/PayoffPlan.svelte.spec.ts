import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PayoffPlan from './PayoffPlan.svelte';
import type { PayoffDebt } from '../stats/payoff.ts';

const CARD: PayoffDebt = {
	id: 'card',
	name: 'Contoso card',
	balance: 6000,
	instalment: 300,
	annualRate: 21
};
const LOAN: PayoffDebt = {
	id: 'loan',
	name: 'Northwind loan',
	balance: 3000,
	instalment: 300,
	annualRate: 9
};

function draw(debts: readonly PayoffDebt[] = [CARD, LOAN], extra = 500) {
	const onextra = vi.fn();
	render(PayoffPlan, { props: { debts, extra, from: '2026-09-01', onextra } });

	return { onextra };
}

describe('PayoffPlan.svelte', () => {
	it('puts the highest rate first until asked otherwise', async () => {
		draw();

		const rows = page.getByRole('listitem');
		await expect.element(rows.nth(0)).toHaveTextContent('Contoso card');
		await expect.element(rows.nth(1)).toHaveTextContent('Northwind loan');
	});

	it('reorders by balance when the reader asks for the smallest first', async () => {
		draw();
		await page.getByRole('radio', { name: 'Smallest balance' }).click();

		await expect.element(page.getByRole('listitem').nth(0)).toHaveTextContent('Northwind loan');
	});

	it('names the month the last debt goes', async () => {
		// 1 050 at no interest and 500 a month is three months on from September.
		draw([{ id: 'loan', name: 'Loan', balance: 1050, instalment: 500, annualRate: 0 }], 0);

		await expect.element(page.getByText('Debt-free')).toBeInTheDocument();
		await expect.element(page.getByText(/Dec(ember)? 2026/)).toBeInTheDocument();
	});

	it('says plainly when rates are missing and what that does to the answer', async () => {
		draw([{ ...CARD, annualRate: null }, LOAN]);

		await expect.element(page.getByText('1 debt has no interest rate')).toBeInTheDocument();
		await expect
			.element(page.getByText(/no rate entered, so no interest counted/))
			.toBeInTheDocument();
	});

	it('warns about a debt whose instalment does not cover its interest', async () => {
		draw(
			[{ id: 'sinking', name: 'Sinking', balance: 10_000, instalment: 150, annualRate: 24 }],
			400
		);

		await expect
			.element(page.getByText(/its instalment does not cover the interest/))
			.toBeInTheDocument();
	});

	it('passes on the extra amount the reader types', async () => {
		const { onextra } = draw();

		const extra = page.getByLabelText('Extra each month, over the instalments');
		await extra.fill('750');
		await extra.element().dispatchEvent(new Event('change', { bubbles: true }));

		expect(onextra).toHaveBeenCalledWith(750);
	});
});
