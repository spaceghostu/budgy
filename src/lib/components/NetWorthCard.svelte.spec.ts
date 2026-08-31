import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NetWorthCard from './NetWorthCard.svelte';
import { formatCurrency } from '../format.ts';
import { buildNetWorth } from '../stats/networth.ts';
import { makeTransaction } from '../testing/transaction.ts';

/** Two accounts the bank printed balances for, across three months. */
const certified = buildNetWorth([
	makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque', balance: 900 }),
	makeTransaction({ date: '2026-07-04', amount: -200, account: 'Savings', balance: 4800 }),
	makeTransaction({ date: '2026-08-02', amount: -300, account: 'Cheque', balance: 600 })
]);

describe('NetWorthCard.svelte', () => {
	it('draws every month the statement spans, newest in front', async () => {
		render(NetWorthCard, { worth: certified, focusMonth: '2026-08' });

		await expect.element(page.getByText('Net worth, month against month')).toBeInTheDocument();
		await expect.element(page.getByText('all 3 months', { exact: false })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Aug 2026' })).toBeInTheDocument();
	});

	it('says the lines carry over rather than resetting', async () => {
		render(NetWorthCard, { worth: certified, focusMonth: '2026-08' });

		await expect
			.element(page.getByText('Nothing resets at the start of a month', { exact: false }))
			.toBeInTheDocument();
	});

	it('names the accounts with no balance rather than passing the total off as money', async () => {
		const relative = buildNetWorth([
			makeTransaction({ date: '2026-06-10', amount: -100, account: 'Cheque' }),
			makeTransaction({ date: '2026-07-04', amount: -200, account: 'Savings' })
		]);

		render(NetWorthCard, { worth: relative, focusMonth: '2026-07' });

		await expect
			.element(page.getByText('Cheque and Savings have no balance set', { exact: false }))
			.toBeInTheDocument();
	});

	it('walks the months up an ordinal ramp so the newest reads as the strongest', async () => {
		render(NetWorthCard, { worth: certified, focusMonth: '2026-08' });

		await expect
			.element(page.getByText('The stronger the colour, the more recent the month.'))
			.toBeInTheDocument();

		const tones = [...document.querySelectorAll<SVGPathElement>('path.line')].map((line) =>
			line.style.getPropertyValue('--line').trim()
		);

		// Three months across five steps: the ends and the middle of the ramp.
		expect(tones).toEqual(['var(--recency-1)', 'var(--recency-3)', 'var(--recency-5)']);
	});

	it('names the ends of the ramp so the shading is not read by colour alone', async () => {
		render(NetWorthCard, { worth: certified, focusMonth: '2026-08' });

		const legend = document.querySelector('ul.legend');

		expect(legend?.textContent).toContain('Jun 2026');
		expect(legend?.textContent).toContain('Aug 2026');
	});

	it('shows the figures as text for a reader who cannot see the plot', async () => {
		render(NetWorthCard, { worth: certified, focusMonth: '2026-08' });

		await page.getByRole('radio', { name: 'Table' }).click();

		await expect
			.element(page.getByText('Net worth on each day of the month, one column per month.'))
			.toBeInTheDocument();
		// What August stops at, with both accounts counted.
		await expect.element(page.getByText(formatCurrency(5400)).first()).toBeInTheDocument();
	});
});
