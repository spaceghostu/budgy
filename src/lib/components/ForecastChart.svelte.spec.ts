import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ForecastChart from './ForecastChart.svelte';
import { formatCurrency, formatCurrencyShort } from '../format.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildMonthlyTotals } from '../stats/monthly.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/** Two whole months, a gym on the 20th, and a July that stops on the 10th. */
const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-05-25', amount: -300, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-03', amount: -200, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
];

function draw(transactions: readonly Transaction[] = STATEMENT, showMonths = true) {
	const forecast = buildForecast(transactions, { metric: 'out' });
	const months = buildMonthlyTotals(transactions, 'out').filter(
		(month) => month.month !== forecast.month
	);

	return render(ForecastChart, { props: { forecast, months, showMonths } });
}

describe('ForecastChart.svelte', () => {
	it('labels the line with where the month is expected to end', async () => {
		draw();

		await expect.element(page.getByText(formatCurrencyShort(850))).toBeInTheDocument();
	});

	it('says how much history the projection was learned from', async () => {
		draw();

		await expect.element(page.getByText(/learned from 2 complete months/)).toBeInTheDocument();
	});

	it('names the payment expected on the day under the cursor', async () => {
		draw();

		const cursor = page.getByRole('slider', { name: 'Day of the month' });
		await cursor.click();
		await userEvent.keyboard('{Home}');
		await userEvent.keyboard('{ArrowRight>19/}');

		await expect.element(page.getByText('Day 20 · 20 Jul 2026')).toBeInTheDocument();
		await expect.element(page.getByText('Gym')).toBeInTheDocument();
		await expect.element(page.getByText(formatCurrency(500))).toBeInTheDocument();
	});

	it('reads the projection out to someone who cannot see it', async () => {
		draw();

		const cursor = page.getByRole('slider', { name: 'Day of the month' });
		await cursor.click();
		await userEvent.keyboard('{End}');

		await expect
			.element(cursor)
			.toHaveAttribute('aria-valuetext', expect.stringContaining('Projected'));
	});

	it('projects nothing once the month is over', async () => {
		draw([...STATEMENT, makeTransaction({ date: '2026-07-31', amount: -50, merchant: 'Shop' })]);

		await expect
			.element(page.getByText('The month is over, so nothing is projected.'))
			.toBeInTheDocument();
	});

	it('holds where the statement stops when no whole month sits behind it', async () => {
		draw([makeTransaction({ date: '2026-07-04', amount: -150, merchant: 'Shop' })]);

		await expect
			.element(page.getByText(/no complete month behind this one yet/))
			.toBeInTheDocument();
	});

	it('says so rather than drawing an empty plot', async () => {
		draw([]);

		await expect.element(page.getByText('No transactions to forecast.')).toBeInTheDocument();
	});

	it('fades the months behind rather than taking them away', async () => {
		const { container } = draw(STATEMENT, false);

		// Still drawn, and still holding the axis they are drawn against — a line
		// that left would move the plot under the one being read.
		const behind = [...container.querySelectorAll('path.context')];
		expect(behind).toHaveLength(2);
		expect(behind.every((line) => line.classList.contains('faded'))).toBe(true);

		await expect.element(page.getByText('2 past months, faded')).toBeInTheDocument();
	});

	it('draws them at full strength until asked otherwise', async () => {
		const { container } = draw();

		expect([...container.querySelectorAll('path.context.faded')]).toHaveLength(0);
		await expect.element(page.getByText('2 past months')).toBeInTheDocument();
	});
});
