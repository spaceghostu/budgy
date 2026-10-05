import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FetchCreditReport from './FetchCreditReport.svelte';
import { formatDate } from '../format.ts';
import { FAKE_SECRETS, finance365Response } from '../testing/finance365.ts';

function draw() {
	const onreport = vi.fn();
	render(FetchCreditReport, { props: { onreport } });

	return { onreport };
}

function answer(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('FetchCreditReport.svelte', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('will not fetch until a token is pasted', async () => {
		draw();

		await expect.element(page.getByRole('button', { name: 'Fetch report' })).toBeDisabled();
	});

	it('keeps the token out of sight while it is typed', async () => {
		draw();

		await expect
			.element(page.getByLabelText('Finance365 token'))
			.toHaveAttribute('type', 'password');
	});

	it('hands on the reduced report, says what it read, and clears the token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(finance365Response())));
		const { onreport } = draw();

		const field = page.getByLabelText('Finance365 token');
		await field.fill('abc.def.ghi');
		await page.getByRole('button', { name: 'Fetch report' }).click();

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent(`Read 2 accounts from the report dated ${formatDate('2026-09-28')}.`);
		await expect.element(field).toHaveValue('');

		expect(onreport).toHaveBeenCalledOnce();
		const handed = JSON.stringify(onreport.mock.calls[0][0]);
		for (const secret of Object.values(FAKE_SECRETS)) expect(handed).not.toContain(secret);
	});

	it('clears the token even when Finance365 turns it down, and says why', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer({ success: false }, 401)));
		const { onreport } = draw();

		const field = page.getByLabelText('Finance365 token');
		await field.fill('stale');
		await page.getByRole('button', { name: 'Fetch report' }).click();

		await expect.element(page.getByRole('alert')).toHaveTextContent(/token was rejected/);
		await expect.element(field).toHaveValue('');
		expect(onreport).not.toHaveBeenCalled();
	});

	it('reads a pasted response without a request, and empties the box', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { onreport } = draw();

		await page.getByRole('button', { name: /Paste the response instead/ }).click();
		const box = page.getByLabelText('Response to the credit-report request');
		await box.fill(JSON.stringify(finance365Response()));
		await page.getByRole('button', { name: 'Read report' }).click();

		await expect.element(page.getByRole('status')).toHaveTextContent(/Read 2 accounts/);
		await expect.element(box).toHaveValue('');
		expect(onreport).toHaveBeenCalledOnce();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a paste that is not a report, shows none of it back, and empties the box', async () => {
		draw();

		await page.getByRole('button', { name: /Paste the response instead/ }).click();
		await page
			.getByLabelText('Response to the credit-report request')
			.fill(`{"id_number":"${FAKE_SECRETS.idNumber}"}`);
		await page.getByRole('button', { name: 'Read report' }).click();

		const alert = page.getByRole('alert');
		await expect.element(alert).toHaveTextContent(/does not look like a Finance365 credit report/);
		await expect.element(alert).not.toHaveTextContent(FAKE_SECRETS.idNumber);
		await expect
			.element(page.getByLabelText('Response to the credit-report request'))
			.toHaveValue('');
	});
});
