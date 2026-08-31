/**
 * Pulling a certified statement straight from Discovery Bank.
 *
 * The alternative this replaces is a manual round trip: log in, pick a date
 * range, download the PDF, find it, drag it onto the page. This does the same
 * thing in one paste — but it is worth being exact about what "the same thing"
 * means, because a bank is involved.
 *
 * This is the browser making the *same request the bank's own site makes*, with
 * a token the reader copied out of their own logged-in session. Discovery
 * reflects the requesting origin back in `access-control-allow-origin`, so the
 * call works from this page without a proxy. Nothing is added, nothing is
 * intercepted, and there is still no server: the PDF lands in memory here and
 * goes into the same reader the file picker feeds.
 *
 * What this deliberately does NOT do is log in. There is no password here and
 * no refresh token — only the short-lived access token the reader pastes, which
 * Discovery issues with a five-minute life. That is a real constraint, not an
 * oversight: a five-minute credential cannot be stored usefully, so it is never
 * stored at all. See {@link tokenExpiry} for how that expiry is checked before
 * a request is spent on a token that is already dead.
 */

const BASE = 'https://api.discoverybank.co.za/portalserver/services/api/wpDocuments/V0';

export const STATEMENTS_URL = `${BASE}/RW_GetCertifiedStatementsByDateRangeBulk`;

/** A failure worth showing the reader, already worded for them. */
export class BankRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BankRequestError';
	}
}

/** An inclusive span of days, as `YYYY-MM-DD`. */
export interface DateRange {
	readonly from: string;
	readonly to: string;
}

export interface StatementRequest {
	/** The access token from a logged-in Discovery session. */
	readonly token: string;
	readonly range: DateRange;
	/** Aborts the request. An abort is rethrown as-is rather than wrapped. */
	readonly signal?: AbortSignal;
}

/**
 * The envelope Discovery answers with.
 *
 * `success` is its own word on whether the work happened, and it is not the
 * same question as whether the HTTP call did: a 200 can carry `success: false`
 * with the reason in `ProcessingResult.userMessage`.
 */
interface StatementEnvelope {
	readonly FileData?: unknown;
	readonly downloadName?: unknown;
	readonly success?: unknown;
	readonly message?: unknown;
	readonly ProcessingResult?: { readonly userMessage?: unknown } | null;
}

/**
 * When the token stops being accepted, or `null` if it cannot be read.
 *
 * The token is a JWT, so its expiry is legible here without asking anyone. That
 * is worth doing: the window is five minutes, and telling the reader their
 * token died *before* spending a request on it explains the failure better than
 * a 401 does.
 *
 * `null` means only "this app could not read an expiry" — it is not a verdict
 * that the token is bad, so the caller should still let the request happen and
 * let the bank be the judge.
 */
export function tokenExpiry(token: string): Date | null {
	const payload = token.trim().split('.')[1];
	if (payload === undefined) return null;

	try {
		// base64url, which `atob` does not take: its two substituted characters
		// have to go back, and the padding it dropped has to be restored.
		const padded = payload.replaceAll('-', '+').replaceAll('_', '/');
		const claims: unknown = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')));
		const exp = (claims as { exp?: unknown } | null)?.exp;

		return typeof exp === 'number' && Number.isFinite(exp) ? new Date(exp * 1000) : null;
	} catch {
		return null;
	}
}

/** Whether the token has already expired. Unreadable expiries are not expired. */
export function isExpired(token: string, now: Date = new Date()): boolean {
	const expiry = tokenExpiry(token);
	return expiry !== null && expiry.getTime() <= now.getTime();
}

/**
 * A token as pasted, cleaned up.
 *
 * Copying from devtools tends to bring along the `Bearer ` prefix, surrounding
 * quotes, or the newlines a wrapped cell introduces. None of those are the
 * reader making a mistake, so none of them are worth an error message.
 */
export function normaliseToken(pasted: string): string {
	return pasted
		.trim()
		.replace(/^["']|["']$/g, '')
		.replace(/^Bearer\s+/i, '')
		.replaceAll(/\s+/g, '');
}

/**
 * Fetch the certified statement for a period, as a file ready to be read.
 *
 * Returned as a `File` rather than as parsed rows so that it enters the app
 * through the one door every statement already comes through — the same
 * `loadFile` the picker calls. Fetching is a *way of getting the PDF*, not a
 * second kind of statement, and keeping it to that means parsing, merging,
 * de-duplicating and saving all stay in one place.
 *
 * @throws {BankRequestError} With a message written for the reader.
 */
export async function fetchCertifiedStatement(request: StatementRequest): Promise<File> {
	const token = normaliseToken(request.token);
	if (token === '') throw new BankRequestError('Paste your Discovery token first.');

	if (isExpired(token)) {
		throw new BankRequestError(
			'That token has already expired — they last about five minutes. Copy a fresh one from your logged-in browser tab.'
		);
	}

	const response = await send(request, token);
	if (!response.ok) throw new BankRequestError(describeFailure(response.status));

	const envelope = (await readBody(response)) as StatementEnvelope | null;
	if (envelope === null) {
		throw new BankRequestError('Discovery replied in a shape this app could not read.');
	}

	if (envelope.success === false) throw new BankRequestError(refusal(envelope));

	if (typeof envelope.FileData !== 'string' || envelope.FileData === '') {
		throw new BankRequestError('Discovery returned no statement for that period.');
	}

	return toFile(envelope, request.range);
}

async function send(request: StatementRequest, token: string): Promise<Response> {
	try {
		return await fetch(STATEMENTS_URL, {
			method: 'POST',
			signal: request.signal,
			headers: {
				accept: 'application/json, text/plain, */*',
				authorization: `Bearer ${token}`,
				// Discovery's own site sends `text/plain` for this JSON body. It is
				// copied rather than corrected: the endpoint is what it is, and a
				// tidier content type is not worth a request that might be refused.
				'content-type': 'text/plain'
			},
			// `fromdate` and `toDate` really are cased differently. Verbatim from
			// the bank's own request — do not "fix" either one.
			body: JSON.stringify({ fromdate: request.range.from, toDate: request.range.to })
		});
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;

		throw new BankRequestError(
			'Could not reach Discovery. Check your connection, or whether a browser extension is blocking the request.'
		);
	}
}

async function readBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return null;
	}
}

/** Discovery's own reason for a refusal, or a general one where it gave none. */
function refusal(envelope: StatementEnvelope): string {
	const detail = envelope.ProcessingResult?.userMessage ?? envelope.message;

	return typeof detail === 'string' && detail.trim() !== '' && detail !== 'Success'
		? `Discovery refused the request: ${detail}`
		: 'Discovery refused the request without saying why.';
}

/**
 * A failed status, worded as something the reader can act on.
 *
 * 401 and 403 are the ones that will actually happen, and they mean the same
 * thing in practice here — the five minutes ran out — so they say so rather
 * than reporting a number.
 */
function describeFailure(status: number): string {
	switch (status) {
		case 400:
			return 'Discovery rejected that date range. Try a narrower one.';
		case 401:
		case 403:
			return 'That token was rejected — they expire after about five minutes. Copy a fresh one from your logged-in browser tab.';
		case 429:
			return 'Discovery is rate-limiting this session. Wait a moment and try again.';
		default:
			break;
	}

	return status >= 500
		? `Discovery had a problem (${status}). Try again shortly.`
		: `Discovery refused the request (${status}).`;
}

function toFile(envelope: StatementEnvelope, range: DateRange): File {
	const name =
		typeof envelope.downloadName === 'string' && envelope.downloadName.trim() !== ''
			? envelope.downloadName.trim()
			: 'CertifiedStatements';

	return new File(
		[decodeBase64(envelope.FileData as string)],
		`${name} ${range.from} to ${range.to}.pdf`,
		{
			type: 'application/pdf'
		}
	);
}

/**
 * The PDF's bytes, as a buffer a `File` will take.
 *
 * `Uint8Array.from` allocates its own buffer, so it is never the shared kind
 * that `BlobPart` rules out — the same reasoning behind `toArrayBuffer` in
 * `state/statement.svelte.ts`.
 */
function decodeBase64(encoded: string): ArrayBuffer {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		throw new BankRequestError('The statement Discovery returned could not be decoded.');
	}

	return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

/**
 * The period the fetch asks for unless the reader says otherwise.
 *
 * Always the last year, whether or not a statement is already loaded — enough
 * to fill the charts on a first run, and no reason to ask for less on a
 * refresh: the bank bills a range rather than a diff, and an overlap with what
 * is on screen costs nothing here, because `parse/merge.ts` de-duplicates on
 * the way in. Asking for the whole year also catches transactions that posted
 * late and so were missing from an earlier pull.
 */
export function suggestRange(today: Date = new Date()): DateRange {
	const start = new Date(today);
	start.setFullYear(start.getFullYear() - 1);

	return { from: toIsoDate(start), to: toIsoDate(today) };
}

function toIsoDate(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');

	return `${date.getFullYear()}-${month}-${day}`;
}
