import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BankRequestError,
	STATEMENTS_URL,
	fetchCertifiedStatement,
	isExpired,
	normaliseToken,
	suggestRange,
	tokenExpiry
} from './discovery.ts';

/** A JWT with the given `exp`. Only the payload is ever read, so it alone is real. */
function tokenExpiringAt(seconds: number): string {
	const payload = btoa(JSON.stringify({ sub: '1', exp: seconds }))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');

	return `header.${payload}.signature`;
}

const LIVE = tokenExpiringAt(Math.floor(Date.now() / 1000) + 300);
const RANGE = { from: '2025-08-01', to: '2026-08-28' } as const;

/** Discovery's success envelope, carrying `body` as the PDF. */
function envelope(body: string, overrides: Record<string, unknown> = {}): Response {
	return new Response(
		JSON.stringify({
			FileData: btoa(body),
			mimetype: 'application/pdf',
			downloadName: 'CertifiedStatements',
			success: true,
			ProcessingResult: { userMessage: 'Success' },
			...overrides
		}),
		{ status: 200 }
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('normaliseToken', () => {
	it('strips the Bearer prefix devtools copies along', () => {
		expect(normaliseToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
	});

	it('strips quotes and the newlines a wrapped cell introduces', () => {
		expect(normaliseToken('  "abc.d\nef.ghi"  ')).toBe('abc.def.ghi');
	});
});

describe('tokenExpiry', () => {
	it('reads the expiry out of the payload', () => {
		expect(tokenExpiry(tokenExpiringAt(1787909359))?.getTime()).toBe(1787909359000);
	});

	it('is null for something that is not a JWT, rather than throwing', () => {
		expect(tokenExpiry('not-a-token')).toBeNull();
	});

	it('treats an unreadable expiry as not expired, leaving the bank to judge', () => {
		expect(isExpired('not-a-token')).toBe(false);
	});

	it('knows a spent token', () => {
		expect(isExpired(tokenExpiringAt(1787909359), new Date('2026-08-28T09:35:00Z'))).toBe(true);
	});
});

describe('fetchCertifiedStatement', () => {
	it('sends the bank its own request, verbatim', async () => {
		const fetchMock = vi.fn().mockResolvedValue(envelope('%PDF-1.4'));
		vi.stubGlobal('fetch', fetchMock);

		await fetchCertifiedStatement({ token: `Bearer ${LIVE}`, range: RANGE });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(STATEMENTS_URL);
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${LIVE}`);
		// The casing here is the bank's, not a typo, and is load-bearing.
		expect(init.body).toBe('{"fromdate":"2025-08-01","toDate":"2026-08-28"}');
	});

	it('decodes the base64 body into the actual PDF bytes', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope('%PDF-1.4 hello')));

		const file = await fetchCertifiedStatement({ token: LIVE, range: RANGE });

		expect(file.type).toBe('application/pdf');
		expect(file.name).toBe('CertifiedStatements 2025-08-01 to 2026-08-28.pdf');
		await expect(file.text()).resolves.toBe('%PDF-1.4 hello');
	});

	it('refuses a token that is already spent without troubling the bank', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			fetchCertifiedStatement({ token: tokenExpiringAt(1), range: RANGE })
		).rejects.toThrow(/already expired/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reads a 401 as the five minutes having run out', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			/rejected — they expire/
		);
	});

	it('passes on the reason behind a 200 that still refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					envelope('', { success: false, ProcessingResult: { userMessage: 'No accounts found' } })
				)
		);

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			'Discovery refused the request: No accounts found'
		);
	});

	it('says so when the period simply held no statement', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope('', { FileData: '' })));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			/no statement for that period/
		);
	});

	it.each([
		[400, /rejected that date range/],
		[429, /rate-limiting/],
		[503, /had a problem \(503\)/],
		[418, /refused the request \(418\)/]
	])('words a %i for the reader', async (status, expected) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(expected);
	});

	it('refuses an empty token before it builds a request', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(fetchCertifiedStatement({ token: '   ', range: RANGE })).rejects.toThrow(
			'Paste your Discovery token first.'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('says so when the reply is not JSON at all', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway</html>')));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			/shape this app could not read/
		);
	});

	it('falls back to a general refusal when the bank gives no reason', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(envelope('', { success: false, ProcessingResult: null, message: '' }))
		);

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			'Discovery refused the request without saying why.'
		);
	});

	it('names the file from the range when the bank sends no download name', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope('%PDF', { downloadName: '' })));

		const file = await fetchCertifiedStatement({ token: LIVE, range: RANGE });

		expect(file.name).toBe('CertifiedStatements 2025-08-01 to 2026-08-28.pdf');
	});

	it('words a network failure for the reader', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toThrow(
			BankRequestError
		);
	});

	it('lets the reader own cancel through untouched', async () => {
		const abort = new DOMException('Aborted', 'AbortError');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

		await expect(fetchCertifiedStatement({ token: LIVE, range: RANGE })).rejects.toBe(abort);
	});
});

describe('suggestRange', () => {
	it('asks for the year up to today', () => {
		expect(suggestRange(new Date('2026-08-28T10:00:00'))).toEqual({
			from: '2025-08-28',
			to: '2026-08-28'
		});
	});

	it('lands on the last day of February when today is a leap day a year on', () => {
		expect(suggestRange(new Date('2028-02-29T10:00:00'))).toEqual({
			from: '2027-03-01',
			to: '2028-02-29'
		});
	});
});
