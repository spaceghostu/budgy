import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MonthStartPicker from './MonthStartPicker.svelte';
import { StatementState } from '../state/statement.svelte.ts';

describe('MonthStartPicker.svelte', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('says the months are the calendar’s until they are not', async () => {
		const state = new StatementState();

		render(MonthStartPicker, { state });

		await expect.element(page.getByText('Calendar months')).toBeInTheDocument();
	});

	it('names the day the reader’s months open on', async () => {
		const state = new StatementState();
		state.setMonthStart(25);

		render(MonthStartPicker, { state });

		await expect.element(page.getByText('Months from the 25th')).toBeInTheDocument();
	});

	it('moves the whole app’s months, and keeps the choice', async () => {
		const state = new StatementState();

		render(MonthStartPicker, { state });
		await page.getByLabelText('Day the month starts on').click();
		await page.getByRole('option', { name: 'Months from the 25th' }).click();

		expect(state.monthStart).toBe(25);
		expect(localStorage.getItem('budgy:month-start')).toBe('25');
	});
});
