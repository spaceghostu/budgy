/**
 * Asking Finance365 for the reader's credit report.
 *
 * Finance365 has no public API. Its dashboard is a single page that asks one
 * endpoint for the report it draws, with the session's token as a bearer
 * header, and this module makes that same request — once, on a button press,
 * with a token the reader pasted from their own logged-in session. It is the
 * Discovery fetch again, for a different document.
 *
 * Two things it is careful not to do:
 *
 * - **It never asks for a new report.** The dashboard sends `create=1`, which
 *   has Finance365 draw a fresh report from the bureau. That is the reader's
 *   decision to make on Finance365's own page, not a side effect of budgeting,
 *   so this asks for the latest one that already exists and nothing more.
 * - **It never keeps the token, or the answer.** The token is used for the one
 *   request and dropped. The answer goes straight to {@link parseCreditReport},
 *   which returns the reduced report and lets the rest go.
 *
 * Finance365 answers every origin, so this works from a plain browser tab as
 * well as from the desktop app.
 */

import { normaliseToken } from '../bank/discovery.ts';
import { CreditFormatError, parseCreditReport } from './parse.ts';
import type { CreditReport } from './types.ts';

/** Transcribed from Finance365's own dashboard; the path is not a pattern to extend. */
export const CREDIT_REPORT_URL = 'https://api.finance365.co.za/credit-report';

/** A failure worth showing the reader, already worded for them. */
export class CreditRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CreditRequestError';
	}
}

export interface CreditReportRequest {
	/** The access token from a logged-in Finance365 session, as pasted. */
	readonly token: string;
	/** Aborts the request. An abort is rethrown as-is rather than wrapped. */
	readonly signal?: AbortSignal;
	/** `YYYY-MM-DD`, for a report that does not date itself. Defaults to today. */
	readonly today?: string;
}

/**
 * The token out of whatever the reader copied.
 *
 * The dashboard keeps its session in a cookie called `userstore`, a JSON object
 * with the token under `authToken` — beside the reader's identity and phone
 * numbers. Copying that whole cookie is the easiest thing to do and is accepted
 * here, and the token is the only part of it that is read. Anything else is
 * treated as a bare token, or an `authorization` header, as Discovery's is.
 */
export function readToken(pasted: string): string {
	const text = pasted.trim().replace(/^userstore=/, '');

	for (const candidate of [text, decoded(text)]) {
		if (!candidate.startsWith('{')) continue;

		try {
			const token = (JSON.parse(candidate) as { authToken?: unknown } | null)?.authToken;
			// A cookie with no token in it is not sent as though it were one: the
			// rest of it is the reader's identity, and has no place in a header.
			return typeof token === 'string' ? normaliseToken(token) : '';
		} catch {
			// Not the cookie after all; fall through to reading it as a token.
		}
	}

	return text.startsWith('{') || text.startsWith('%7B') ? '' : normaliseToken(text);
}

/** A cookie value copied from devtools is usually still percent-encoded. */
function decoded(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/**
 * Fetch the latest report and reduce it.
 *
 * @throws {CreditRequestError} When Finance365 could not be reached or refused.
 * @throws {CreditFormatError} When it answered with something that is not a report.
 */
export async function fetchCreditReport(request: CreditReportRequest): Promise<CreditReport> {
	const token = readToken(request.token);
	if (token === '')
		throw new CreditRequestError(
			'There is no token in that. Paste the authorization header, or the whole userstore cookie.'
		);

	let response: Response;
	try {
		response = await fetch(CREDIT_REPORT_URL, {
			method: 'GET',
			signal: request.signal,
			// The token rides in a header, so it is not followed anywhere else.
			redirect: 'error',
			headers: { accept: 'application/json', authorization: `Bearer ${token}` }
		});
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;

		throw new CreditRequestError(
			'Could not reach Finance365. Check your connection, or paste the response from the Network tab instead.'
		);
	}

	if (!response.ok) throw new CreditRequestError(describeFailure(response.status));

	const body = await readBody(response);
	const refused = refusal(body);
	if (refused !== null) throw new CreditRequestError(refused);

	return parseCreditReport(body, request.today ?? new Date().toISOString().slice(0, 10));
}

async function readBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;

		throw new CreditFormatError('Finance365 answered with something that is not a credit report.');
	}
}

/**
 * Finance365's own word that the work did not happen, or `null` when it did.
 *
 * Like Discovery, it can answer 200 and still say no: `success` is its verdict
 * and `message` its reason.
 */
function refusal(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;

	const envelope = body as { success?: unknown; message?: unknown };
	if (envelope.success !== false) return null;

	return typeof envelope.message === 'string' && envelope.message.trim() !== ''
		? `Finance365 refused the request: ${envelope.message.trim().slice(0, MAX_REASON_LENGTH)}`
		: 'Finance365 refused the request without saying why.';
}

/** A reason is a sentence. Anything longer is not one worth showing. */
const MAX_REASON_LENGTH = 200;

/** A failed status, worded as something the reader can act on. */
function describeFailure(status: number): string {
	switch (status) {
		case 401:
		case 403:
			return 'That token was rejected — a Finance365 session lasts a day at most. Log in again and copy a fresh one.';
		case 429:
			return 'Finance365 is rate-limiting this session. Wait a minute and try again.';
		default:
			return status >= 500
				? 'Finance365 is having trouble right now. Try again in a few minutes.'
				: `Finance365 turned the request down (${status}).`;
	}
}
