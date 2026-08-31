import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FilterBar from './FilterBar.svelte';
import { StatementState } from '../state/statement.svelte.ts';

const HEADER =
	'"Value Date","Value Time","Account Nickname","Type","Transaction Description",' +
	'"Beneficiary or CardHolder","Amount","Category","SubCategory","Note"';

function row(date: string, amount: number): string {
	return `${date},12:00:00,Cheque account,"Card on file","GROCER","",${amount},"Food and Drink","Groceries",""`;
}

/** Newest first, the way banks export. */
const CSV = [HEADER, row('2026-08-09', -100), row('2026-07-15', -300)].join('\n');

async function loadedState(): Promise<StatementState> {
	const state = new StatementState();
	await state.loadFile(new File([CSV], 'statement.csv', { type: 'text/csv' }));
	state.range = 'month';

	return state;
}

describe('FilterBar.svelte', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('names the month on its own while the months are the calendar’s', async () => {
		const state = await loadedState();

		render(FilterBar, { state });

		await expect.element(page.getByText('Showing')).toBeInTheDocument();
		await expect.element(page.getByText('1 Aug 2026', { exact: false })).not.toBeInTheDocument();
	});

	it('spells out which days a month covers once it does not open on the 1st', async () => {
		const state = await loadedState();
		state.setMonthStart(25);

		render(FilterBar, { state });

		await expect
			.element(page.getByText('25 Jul 2026 – 24 Aug 2026', { exact: false }))
			.toBeInTheDocument();
	});
});
