/**
 * A fetch that answers each endpoint separately, as the network would.
 *
 * The two halves come from different URLs, so one blanket response cannot tell
 * the "both arrived" case from "one did" — which is the distinction every test
 * below turns on.
 */
function routed(answers: { pdf?: () => Response; csv?: () => Response }) {
	return vi.fn((url: string) => {
		const answer = url === SMART_SEARCH_URL ? answers.csv : answers.pdf;
		return answer === undefined
			? Promise.resolve(new Response('', { status: 500 }))
			: Promise.resolve(answer());
	});
}

const CSV_TEXT = '"Value Date","Amount"\n2026-08-13,-299.00';

describe('fetchStatementSources', () => {
	it('brings back both halves on the one token', async () => {
		const fetchMock = routed({
			pdf: () => envelope('%PDF-1.4'),
			csv: () => new Response(CSV_TEXT, { status: 200 })
		});
		vi.stubGlobal('fetch', fetchMock);

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(await sources.pdf?.text()).toBe('%PDF-1.4');
		expect(await sources.csv?.text()).toBe(CSV_TEXT);
		expect(sources.failures).toEqual([]);
		// One paste, two requests — the reader is not asked to find a second token.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('reports the half that failed instead of returning the other in silence', async () => {
		vi.stubGlobal(
			'fetch',
			routed({ pdf: () => envelope('%PDF-1.4'), csv: () => new Response('', { status: 500 }) })
		);

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(sources.pdf).not.toBeNull();
		expect(sources.csv).toBeNull();
		// The whole bug: a fetch that got balances and no categories must say so.
		expect(sources.failures).toHaveLength(1);
		expect(sources.failures[0]).toMatch(/Smart Search export did not arrive/);
	});

	it('keeps the certified statement even though the other half failed', async () => {
		vi.stubGlobal(
			'fetch',
			routed({ pdf: () => envelope('%PDF-1.4'), csv: () => new Response('', { status: 500 }) })
		);

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(await sources.pdf?.text()).toBe('%PDF-1.4');
	});

	it('keeps the categories when it is the certified statement that failed', async () => {
		vi.stubGlobal(
			'fetch',
			routed({
				pdf: () => new Response('', { status: 500 }),
				csv: () => new Response(CSV_TEXT, { status: 200 })
			})
		);

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(sources.pdf).toBeNull();
		expect(await sources.csv?.text()).toBe(CSV_TEXT);
		expect(sources.failures[0]).toMatch(/certified statement did not arrive/);
	});

	it('names both halves when the bank refuses the token outright', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(sources.pdf).toBeNull();
		expect(sources.csv).toBeNull();
		expect(sources.failures).toHaveLength(2);
		expect(sources.failures[0]).toMatch(/certified statement did not arrive/);
	});

	it('lets the reader’s own cancel through rather than reporting it as a failure', async () => {
		const abort = new DOMException('aborted', 'AbortError');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

		await expect(fetchStatementSources({ token: LIVE, range: RANGE })).rejects.toBe(abort);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BankRequestError,
	SMART_SEARCH_URL,
	STATEMENTS_URL,
	fetchCertifiedStatement,
	fetchSmartSearch,
	fetchStatementSources,
	isExpired,
	normaliseToken,
	parseAccountIds,
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

describe('fetchSmartSearch', () => {
	it('sends the bank its own search request, verbatim', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await fetchSmartSearch({ token: LIVE, range: RANGE });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(SMART_SEARCH_URL);
		expect(url).toContain('wpTransactions/V1/RW_DownloadTransactionsBySearch');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>)['content-type']).toBe('text/plain');

		// The capitalised pair, which the certified-statement call spells in
		// lowercase. Both are the bank's; neither is a typo to tidy.
		expect(JSON.parse(init.body as string)).toMatchObject({
			FromDate: RANGE.from,
			ToDate: RANGE.to,
			fileFormat: 'CSV'
		});
	});

	it('asks for a search no narrower than the period itself', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await fetchSmartSearch({ token: LIVE, range: RANGE });

		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toMatchObject({ SearchTerm: '', Debit: true, Credit: true, FromAmount: 0 });
		expect(body.groupFilterList).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it('carries nobody’s account ids or address unless it is given them', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await fetchSmartSearch({ token: LIVE, range: RANGE });

		// Nothing personal is baked into this module; an unscoped call says so.
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.AccountsList).toEqual([]);
		expect(body.emailAddress).toBe('');
	});

	it('passes the reader’s own scope through when it has one', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await fetchSmartSearch({
			token: LIVE,
			range: RANGE,
			scope: { accounts: ['ACCOUNT-ONE'], emailAddress: 'reader@example.com' }
		});

		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body.AccountsList).toEqual(['ACCOUNT-ONE']);
		expect(body.emailAddress).toBe('reader@example.com');
	});

	it('takes the CSV when the bank serves it as plain text', async () => {
		const csv = '"Value Date","Amount"\n2026-08-13,-299.00';
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(csv, { status: 200 })));

		const file = await fetchSmartSearch({ token: LIVE, range: RANGE });

		expect(await file.text()).toBe(csv);
	});

	it('takes the CSV when it arrives base64 inside an envelope instead', async () => {
		const csv = '"Value Date","Amount"\n2026-08-13,-299.00';
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ FileData: btoa(csv), success: true }), { status: 200 })
				)
		);

		const file = await fetchSmartSearch({ token: LIVE, range: RANGE });

		expect(await file.text()).toBe(csv);
	});

	it('names it .csv, which is what files it as the categories half', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('a,b\n1,2', { status: 200 })));

		const file = await fetchSmartSearch({ token: LIVE, range: RANGE });

		expect(file.name).toMatch(/\.csv$/);
		expect(file.name).toContain(RANGE.from);
	});

	it('says so when the period simply held nothing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('   ', { status: 200 })));

		await expect(fetchSmartSearch({ token: LIVE, range: RANGE })).rejects.toThrow(
			/no Smart Search export/
		);
	});

	it('reads a 401 as the five minutes having run out', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		await expect(fetchSmartSearch({ token: LIVE, range: RANGE })).rejects.toThrow(
			/token was rejected/
		);
	});
});

describe('fetchStatementSources', () => {
	it('reports the half that failed instead of returning the other in silence', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope('%PDF-1.4')));

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(sources.pdf).not.toBeNull();
		expect(sources.csv).toBeNull();
		// The whole bug: a fetch that got balances and no categories must say so.
		expect(sources.failures).toHaveLength(1);
		expect(sources.failures[0]).toMatch(/Smart Search export did not arrive/);
	});

	it('keeps the certified statement even though the other half failed', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope('%PDF-1.4')));

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(await sources.pdf?.text()).toBe('%PDF-1.4');
	});

	it('names both halves when the bank refuses the token outright', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));

		const sources = await fetchStatementSources({ token: LIVE, range: RANGE });

		expect(sources.pdf).toBeNull();
		expect(sources.csv).toBeNull();
		expect(sources.failures).toHaveLength(2);
		expect(sources.failures[0]).toMatch(/certified statement did not arrive/);
	});

	it('lets the reader’s own cancel through rather than reporting it as a failure', async () => {
		const abort = new DOMException('aborted', 'AbortError');
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

		await expect(fetchStatementSources({ token: LIVE, range: RANGE })).rejects.toBe(abort);
	});
});

describe('parseAccountIds', () => {
	it('takes one id per line, as the field asks for', () => {
		expect(parseAccountIds('ONE\nTWO\nTHREE')).toEqual(['ONE', 'TWO', 'THREE']);
	});

	it('takes them straight out of the request they were copied from', () => {
		// Exactly what a devtools copy of `AccountsList` leaves on the clipboard.
		expect(parseAccountIds('["ONE","TWO"]')).toEqual(['ONE', 'TWO']);
	});

	it('drops a repeat rather than asking the bank for it twice', () => {
		expect(parseAccountIds('ONE\nTWO\nONE')).toEqual(['ONE', 'TWO']);
	});

	it('is empty for an empty paste, which is a real answer', () => {
		expect(parseAccountIds('   \n  ')).toEqual([]);
	});
});
