import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebtTable from './DebtTable.svelte';
import type { CreditAccount } from '../credit/types.ts';
import { formatCurrency } from '../format.ts';
import type { DebtSetting } from '../state/persistence.ts';
import type { DebtMatch } from '../stats/debt-match.ts';
import { makeCreditAccount } from '../testing/credit.ts';

const LOAN = makeCreditAccount({
	id: 'loan',
	creditor: 'Northwind',
	balance: 42_000,
	instalment: 1500
});

interface DrawOptions {
	readonly accounts?: readonly CreditAccount[];
	readonly match?: Partial<DebtMatch>;
	readonly settings?: Record<string, DebtSetting>;
}

function draw(options: DrawOptions = {}) {
	const handlers = {
		onrate: vi.fn(),
		onday: vi.fn(),
		onlink: vi.fn(),
		onunlink: vi.fn(),
		onignore: vi.fn()
	};
	const accounts = options.accounts ?? [LOAN];

	render(DebtTable, {
		props: {
			accounts,
			matches: accounts.map((account) => ({
				accountId: account.id,
				merchant: null,
				score: 0,
				origin: 'none' as const,
				...options.match
			})),
			settings: options.settings ?? {},
			payees: ['NORTHWIND PL', 'Gym'],
			...handlers
		}
	});

	return handlers;
}

describe('DebtTable.svelte', () => {
	it('names each debt, what is owed and what it takes a month', async () => {
		draw();

		const row = page.getByRole('listitem');
		await expect.element(row.getByText('Northwind')).toBeInTheDocument();
		await expect.element(row.getByText(formatCurrency(42_000))).toBeInTheDocument();
		await expect.element(row.getByText(`${formatCurrency(1500)} a month`)).toBeInTheDocument();
	});

	it('flags what is in arrears', async () => {
		draw({ accounts: [{ ...LOAN, arrears: 300, status: 'arrears' }] });

		await expect.element(page.getByText(`${formatCurrency(300)} in arrears`)).toBeInTheDocument();
	});

	it('passes on a rate the reader types', async () => {
		const { onrate } = draw();

		const rate = page.getByLabelText('Interest rate (% a year)');
		await rate.fill('21.5');
		await rate.element().dispatchEvent(new Event('change', { bubbles: true }));

		expect(onrate).toHaveBeenCalledWith('loan', 21.5);
	});

	it('holds a rate to what a lender could charge, and shows what it kept', async () => {
		const { onrate } = draw();

		const rate = page.getByLabelText('Interest rate (% a year)');
		await rate.fill('150');
		await rate.element().dispatchEvent(new Event('change', { bubbles: true }));

		expect(onrate).toHaveBeenCalledWith('loan', 100);
		await expect.element(rate).toHaveValue(100);
	});

	it('reads a rate cleared as not known, rather than as nought', async () => {
		const { onrate } = draw({ settings: { loan: { rate: 18 } } });

		const rate = page.getByLabelText('Interest rate (% a year)');
		await rate.fill('');
		await rate.element().dispatchEvent(new Event('change', { bubbles: true }));

		expect(onrate).toHaveBeenCalledWith('loan', null);
	});

	it('calls a pairing it worked out an assumption, and offers to confirm it', async () => {
		const { onlink } = draw({
			match: { merchant: 'NORTHWIND PL', score: 0.9, origin: 'suggested' }
		});

		await expect.element(page.getByText('Paid by NORTHWIND PL (assumed)')).toBeInTheDocument();
		await page.getByRole('button', { name: 'Confirm' }).click();

		expect(onlink).toHaveBeenCalledWith('loan', 'NORTHWIND PL');
	});

	it('stops calling it an assumption once the reader has confirmed it', async () => {
		draw({ match: { merchant: 'NORTHWIND PL', score: 1, origin: 'confirmed' } });

		await expect
			.element(page.getByText('Paid by NORTHWIND PL', { exact: true }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
	});

	it('asks which day an instalment leaves on only where no payee says', async () => {
		draw();
		await expect.element(page.getByLabelText('Leaves on day')).toBeInTheDocument();
	});

	it('does not ask the day of a debt its own debit order already places', async () => {
		draw({ match: { merchant: 'NORTHWIND PL', score: 1, origin: 'confirmed' } });

		await expect.element(page.getByLabelText('Leaves on day')).not.toBeInTheDocument();
	});

	it('lets a debt be left out', async () => {
		const { onignore } = draw();
		await page.getByRole('button', { name: 'Leave out' }).click();

		expect(onignore).toHaveBeenCalledWith('loan');
	});

	it('says so when the report has no open debts', async () => {
		draw({ accounts: [] });

		await expect.element(page.getByText('No open debts on this report.')).toBeInTheDocument();
	});
});
