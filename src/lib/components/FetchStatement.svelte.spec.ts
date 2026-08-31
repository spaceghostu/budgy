import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FetchStatement from './FetchStatement.svelte';
import { StatementState } from '../state/statement.svelte.ts';

/** A JWT whose payload alone is real — nothing here verifies a signature. */
function tokenExpiringIn(seconds: number): string {
	const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');

	return `header.${payload}.signature`;
}

describe('FetchStatement.svelte', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.unstubAllGlobals());

	it('will not fetch until a token is pasted', async () => {
		render(FetchStatement, { statement: new StatementState() });

		await expect.element(page.getByRole('button', { name: 'Fetch statement' })).toBeDisabled();
	});

	it('keeps the token out of sight while it is typed', async () => {
		render(FetchStatement, { statement: new StatementState() });

		const field = page.getByLabelText('Discovery access token');
		await field.fill(tokenExpiringIn(300));

		await expect.element(field).toHaveAttribute('type', 'password');
	});

	it('counts down the five minutes the token has', async () => {
		render(FetchStatement, { statement: new StatementState() });

		await page.getByLabelText('Discovery access token').fill(tokenExpiringIn(300));

		await expect.element(page.getByText(/Token good for \d+s\./)).toBeInTheDocument();
	});

	it('says a spent token is spent rather than sending it', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		render(FetchStatement, { statement: new StatementState() });

		await page.getByLabelText('Discovery access token').fill(tokenExpiringIn(-10));
		await page.getByRole('button', { name: 'Fetch statement' }).click();

		await expect.element(page.getByRole('alert')).toHaveTextContent(/already expired/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('shows the bank’s refusal in the reader’s own words', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
		render(FetchStatement, { statement: new StatementState() });

		await page.getByLabelText('Discovery access token').fill(tokenExpiringIn(300));
		await page.getByRole('button', { name: 'Fetch statement' }).click();

		await expect.element(page.getByRole('alert')).toHaveTextContent(/token was rejected/);
	});

	it('offers a year back', async () => {
		render(FetchStatement, { statement: new StatementState() });

		const year = new Date();
		year.setFullYear(year.getFullYear() - 1);

		await expect
			.element(page.getByLabelText('From', { exact: true }))
			.toHaveValue(year.toISOString().slice(0, 10));
	});

	it('pins the period once the reader sets one', async () => {
		render(FetchStatement, { statement: new StatementState() });

		await page.getByLabelText('From', { exact: true }).fill('2026-01-01');

		await expect.element(page.getByLabelText('From', { exact: true })).toHaveValue('2026-01-01');
	});

	it('clears the token once it has been spent on a statement', async () => {
		// A real PDF is not needed: this asserts the field empties, and the state
		// reports the parse failure through its own error channel.
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ FileData: btoa('%PDF-1.4 not really'), success: true }), {
					status: 200
				})
			)
		);
		render(FetchStatement, { statement: new StatementState() });

		const field = page.getByLabelText('Discovery access token');
		await field.fill(tokenExpiringIn(300));
		await page.getByRole('button', { name: 'Fetch statement' }).click();

		await expect.element(field).toHaveValue('');
	});

	it('does not claim a statement loaded when it would not parse', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ FileData: btoa('not a pdf at all'), success: true }), {
					status: 200
				})
			)
		);
		const statement = new StatementState();
		render(FetchStatement, { statement });

		await page.getByLabelText('Discovery access token').fill(tokenExpiringIn(300));
		await page.getByRole('button', { name: 'Fetch statement' }).click();

		// The state took the failure, so the card must not say it went well.
		await vi.waitFor(() => expect(statement.error).not.toBeNull());
		await expect.element(page.getByText(/^Loaded /)).not.toBeInTheDocument();
	});
});
