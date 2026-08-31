import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RunwayChart from './RunwayChart.svelte';
import { formatCurrencyShort } from '../format.ts';
import { buildForecast } from '../stats/forecast.ts';
import { buildRunway } from '../stats/runway.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/**
 * Two whole months, a gym debit order on the 10th, and a July that stops on the
 * 5th. The shop and the cafe swing too far to read as fixed prices, so they
 * stay in the everyday channel and give the line its drift.
 */
const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-05-20', amount: -60, merchant: 'Cafe' }),
	makeTransaction({ date: '2026-06-01', amount: -140, merchant: 'Shop' }),
	makeTransaction({ date: '2026-06-10', amount: -300, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-20', amount: -100, merchant: 'Cafe' }),
	makeTransaction({ date: '2026-07-05', amount: -100, merchant: 'Shop' })
];

function draw(
	transactions: readonly Transaction[] = STATEMENT,
	balance = 5000,
	isRelative = false
) {
	const forecast = buildForecast(transactions, { metric: 'net' });
	const runway = buildRunway(forecast, { balance });

	return render(RunwayChart, { props: { runway, isRelative } });
}

describe('RunwayChart.svelte', () => {
	it('names the two ends of the stretch it draws', async () => {
		draw();

		await expect.element(page.getByText('Today', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('The day before payday')).toBeInTheDocument();
	});

	it('labels the line with the balance it is expected to end on', async () => {
		draw();

		await expect.element(page.getByText(formatCurrencyShort(4620))).toBeInTheDocument();
	});

	it('names the charges the line steps down on', async () => {
		draw();

		await expect.element(page.getByText(/Gym/)).toBeInTheDocument();
	});

	it('says how much history the projection was learned from', async () => {
		draw();

		await expect.element(page.getByText(/learned from 2 complete months/)).toBeInTheDocument();
	});

	it('reads a day out to someone who cannot see it', async () => {
		draw();

		const cursor = page.getByRole('slider', { name: 'Day between now and payday' });
		await cursor.click();
		await userEvent.keyboard('{Home}');

		await expect
			.element(cursor)
			.toHaveAttribute('aria-valuetext', expect.stringContaining('Balance now'));

		await userEvent.keyboard('{End}');
		await expect
			.element(cursor)
			.toHaveAttribute('aria-valuetext', expect.stringContaining('Projected'));
	});

	it('calls the line net change when there is no balance behind it', async () => {
		draw(STATEMENT, 0, true);

		await expect
			.element(page.getByText(/Net change from today, not a balance/))
			.toBeInTheDocument();
	});

	it('projects nothing once the month is over', async () => {
		draw([...STATEMENT, makeTransaction({ date: '2026-07-31', amount: -10, merchant: 'Cafe' })]);

		await expect.element(page.getByText(/The month is over/)).toBeInTheDocument();
	});

	it('moves nothing but the named charges without a whole month behind it', async () => {
		draw([makeTransaction({ date: '2026-07-05', amount: -150, merchant: 'Shop' })]);

		await expect
			.element(page.getByText(/no complete month behind this one yet/))
			.toBeInTheDocument();
	});

	it('has nothing to draw without a statement', async () => {
		draw([]);

		await expect.element(page.getByText('No transactions to project from.')).toBeInTheDocument();
	});
});
