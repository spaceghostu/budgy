import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CREDIT_REPORT_URL,
	CreditRequestError,
	fetchCreditReport,
	readToken
} from './finance365.ts';
import { CreditFormatError } from './parse.ts';
import { finance365Response } from '../testing/finance365.ts';

function answer(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function stubFetch(response: Response | Error) {
	const fetchMock = vi.fn(() =>
		response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
	);
	vi.stubGlobal('fetch', fetchMock);

	return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('readToken', () => {
	it('takes a bare token, or the authorization header it was copied from', () => {
		expect(readToken('  abc.def.ghi \n')).toBe('abc.def.ghi');
		expect(readToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
	});

	it('takes the token out of the dashboard’s session cookie, and only the token', () => {
		const cookie = JSON.stringify({ authToken: 'abc.def.ghi', id_number: '9001015800085' });

		expect(readToken(cookie)).toBe('abc.def.ghi');
		expect(readToken(encodeURIComponent(cookie))).toBe('abc.def.ghi');
	});
});

describe('readToken, given a cookie with no token in it', () => {
	it('sends nothing rather than the reader’s identity as a bearer token', () => {
		const cookie = JSON.stringify({ loggedIn: true, id_number: '9001015800085' });

		expect(readToken(cookie)).toBe('');
		expect(readToken(encodeURIComponent(cookie))).toBe('');
	});

	it('reads through the cookie’s own name when that is copied too', () => {
		const cookie = encodeURIComponent(JSON.stringify({ authToken: 'abc.def.ghi' }));

		expect(readToken(`userstore=${cookie}`)).toBe('abc.def.ghi');
	});
});

describe('fetchCreditReport', () => {
	it('asks for the latest report with the token as a bearer header', async () => {
		const fetchMock = stubFetch(answer(finance365Response()));

		const report = await fetchCreditReport({ token: 'Bearer abc.def.ghi' });

		expect(report.accounts).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(CREDIT_REPORT_URL);
		expect(init.method).toBe('GET');
		expect(init.headers).toMatchObject({ authorization: 'Bearer abc.def.ghi' });
	});

	it('never asks Finance365 to draw a new report', async () => {
		const fetchMock = stubFetch(answer(finance365Response()));
		await fetchCreditReport({ token: 'abc' });

		const [url] = fetchMock.mock.calls[0] as unknown as [string];
		expect(url).not.toContain('create');
	});

	it('does not spend a request on no token at all', async () => {
		const fetchMock = stubFetch(answer(finance365Response()));

		await expect(fetchCreditReport({ token: '   ' })).rejects.toThrow(/There is no token in that/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('says a rejected token has expired, rather than reporting a number', async () => {
		stubFetch(answer({ success: false, message: 'Unauthorized.', status: 401 }, 401));

		await expect(fetchCreditReport({ token: 'abc' })).rejects.toThrow(/token was rejected/);
	});

	it('passes on Finance365’s own reason when it answers 200 and still says no', async () => {
		stubFetch(answer({ success: false, message: 'Consent required.' }));

		await expect(fetchCreditReport({ token: 'abc' })).rejects.toThrow(
			'Finance365 refused the request: Consent required.'
		);
	});

	it('points to pasting the response when Finance365 cannot be reached', async () => {
		stubFetch(new TypeError('Failed to fetch'));

		const failure = fetchCreditReport({ token: 'abc' });
		await expect(failure).rejects.toThrow(CreditRequestError);
		await expect(failure).rejects.toThrow(/paste the response/);
	});

	it('rethrows an abort as it is', async () => {
		stubFetch(new DOMException('Aborted', 'AbortError'));

		await expect(fetchCreditReport({ token: 'abc' })).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('says so when the answer is not a report', async () => {
		stubFetch(new Response('<html>maintenance</html>', { status: 200 }));

		await expect(fetchCreditReport({ token: 'abc' })).rejects.toThrow(CreditFormatError);
	});
});
