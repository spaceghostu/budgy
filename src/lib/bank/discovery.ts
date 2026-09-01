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
 * A statement is a *pair* — the certified PDF carries the running balance for
 * every account, and the Smart Search CSV carries the bank's own categories.
 * Two endpoints, so two requests, and {@link fetchStatementSources} makes both
 * on the one token rather than making the reader paste it twice. Either half
 * arriving is useful on its own, so a half that fails does not discard the half
 * that did not — but it is always *reported*, because a fetch that quietly
 * returned balances with no categories looks exactly like one that worked.
 *
 * What this deliberately does NOT do is log in. There is no password here and
 * no refresh token — only the short-lived access token the reader pastes, which
 * Discovery issues with a five-minute life. That is a real constraint, not an
 * oversight: a five-minute credential cannot be stored usefully, so it is never
 * stored at all. See {@link tokenExpiry} for how that expiry is checked before
 * a request is spent on a token that is already dead.
 */

const HOST = 'https://api.discoverybank.co.za/portalserver/services/api';

export const STATEMENTS_URL = `${HOST}/wpDocuments/V0/RW_GetCertifiedStatementsByDateRangeBulk`;

/**
 * Where the Smart Search export comes from.
 *
 * A different service *and* a different version to the certified statement —
 * `wpTransactions/V1` rather than `wpDocuments/V0` — which is why the two are
 * spelled out in full rather than sharing a base. Transcribed from the bank's
 * own request; the path is not a pattern to extend.
 */
export const SMART_SEARCH_URL = `${HOST}/wpTransactions/V1/RW_DownloadTransactionsBySearch`;

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
	/** Only the Smart Search half reads this. See {@link SmartSearchScope}. */
	readonly scope?: SmartSearchScope;
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

	const response = await post(
		STATEMENTS_URL,
		token,
		// `fromdate` and `toDate` really are cased differently. Verbatim from the
		// bank's own request — do not "fix" either one.
		JSON.stringify({ fromdate: request.range.from, toDate: request.range.to }),
		request.signal
	);
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

/**
 * The widest amount either way, so the search filters by date alone.
 *
 * The captured request carried the top of that session's own slider. That is a
 * property of one reader's balances, not of the endpoint, so a fixed ceiling
 * high enough to be no ceiling replaces it — filtering by amount is not
 * something this app is asking the bank to do.
 */
const NO_AMOUNT_LIMIT = 1_000_000_000;

/** Discovery's eight transaction groups, all of them — i.e. no group filter. */
const ALL_GROUPS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

/**
 * Which accounts to search, and who the bank thinks is asking.
 *
 * Both come out of the reader's own session and neither is in this source, on
 * purpose: the account ids are opaque handles to *their* accounts and the
 * address is personal data, so committing either would put one person's details
 * in a public repository for no gain.
 *
 * Both are optional here because it is not yet established that the bank needs
 * them — an empty `AccountsList` may well mean "all accounts", which is what
 * this app wants anyway. See {@link smartSearchBody}.
 */
export interface SmartSearchScope {
	/** Discovery's own account ids. Empty asks the bank for its default. */
	readonly accounts?: readonly string[];
	/** The address on the account, where the bank insists on being told. */
	readonly emailAddress?: string;
}

/**
 * Account ids out of whatever the reader pasted.
 *
 * They arrive by copy-and-paste from devtools, which means they arrive in
 * whatever shape the surrounding JSON left them: one per line, comma-separated,
 * still wrapped in quotes and brackets. None of that is the reader making a
 * mistake, so all of it is accepted and none of it is an error message — the
 * same courtesy {@link normaliseToken} extends to the token.
 *
 * Order is kept and duplicates are dropped, so pasting the same list twice
 * cannot quietly ask the bank for one account eight times.
 */
export function parseAccountIds(pasted: string): readonly string[] {
	const seen = new Set<string>();

	for (const piece of pasted.split(/[\s,[\]"']+/)) {
		if (piece !== '') seen.add(piece);
	}

	return [...seen];
}

/**
 * The search body, verbatim in shape from the bank's own request.
 *
 * The field names are Discovery's and are copied exactly — including `FromDate`
 * and `ToDate`, which are capitalised here and *not* in the certified-statement
 * call next door, where the same two days are `fromdate` and `toDate`. That
 * inconsistency is the bank's. Do not tidy either one.
 *
 * Every filter is set to its widest value so the only thing narrowing the
 * result is the period the reader asked for.
 */
function smartSearchBody(range: DateRange, scope: SmartSearchScope): string {
	return JSON.stringify({
		SearchTerm: '',
		Offset: null,
		FromDate: range.from,
		ToDate: range.to,
		FromAmount: 0,
		ToAmount: NO_AMOUNT_LIMIT,
		Debit: true,
		Credit: true,
		AccountsList: scope.accounts ?? [],
		CardList: [],
		WithDocumentsOnly: null,
		groupFilterList: ALL_GROUPS,
		emailAddress: scope.emailAddress ?? '',
		fileFormat: 'CSV'
	});
}

/**
 * Fetch the Smart Search export for a period, as a CSV file ready to be read.
 *
 * Named `.csv` deliberately: `loadFile` routes on the extension, so the name is
 * what puts this in the categories slot rather than the balances one.
 *
 * @throws {BankRequestError} With a message written for the reader.
 */
export async function fetchSmartSearch(request: StatementRequest): Promise<File> {
	const token = normaliseToken(request.token);
	if (token === '') throw new BankRequestError('Paste your Discovery token first.');

	if (isExpired(token)) {
		throw new BankRequestError(
			'That token has already expired — they last about five minutes. Copy a fresh one from your logged-in browser tab.'
		);
	}

	const response = await post(
		SMART_SEARCH_URL,
		token,
		smartSearchBody(request.range, request.scope ?? {}),
		request.signal
	);
	if (!response.ok) throw new BankRequestError(describeFailure(response.status));

	return smartSearchFile(await readSmartSearchBody(response), request.range);
}

/**
 * The CSV text out of whichever shape Smart Search answers in.
 *
 * Discovery serves the certified statement as base64 in a JSON envelope, so the
 * same is likely here — but "likely" is not "verbatim", and this endpoint has
 * not been captured. Both shapes are therefore accepted: a JSON envelope with
 * `FileData`, or the CSV served as text. Whichever it turns out to be, the
 * other branch costs nothing and neither guesses at the wire format.
 */
async function readSmartSearchBody(response: Response): Promise<string> {
	const text = await response.text();
	const trimmed = text.trim();

	if (!trimmed.startsWith('{')) {
		if (trimmed === '')
			throw new BankRequestError('Discovery returned no Smart Search export for that period.');
		return text;
	}

	const envelope = parseEnvelope(trimmed);
	if (envelope === null) {
		throw new BankRequestError('Discovery replied in a shape this app could not read.');
	}

	if (envelope.success === false) throw new BankRequestError(refusal(envelope));

	if (typeof envelope.FileData !== 'string' || envelope.FileData === '') {
		throw new BankRequestError('Discovery returned no Smart Search export for that period.');
	}

	return decodeBase64Text(envelope.FileData);
}

function parseEnvelope(text: string): StatementEnvelope | null {
	try {
		return JSON.parse(text) as StatementEnvelope;
	} catch {
		return null;
	}
}

/** Base64 to text, decoded as UTF-8 so a merchant’s accents survive the trip. */
function decodeBase64Text(encoded: string): string {
	try {
		const binary = atob(encoded);
		return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
	} catch {
		throw new BankRequestError('The Smart Search export Discovery returned could not be decoded.');
	}
}

function smartSearchFile(text: string, range: DateRange): File {
	return new File([text], `Discovery Bank Smart Search ${range.from} to ${range.to}.csv`, {
		type: 'text/csv'
	});
}

/**
 * Both halves of a statement, and what became of each.
 *
 * Not a `File[]`, because "two files" and "one file plus a failure" have to be
 * tellable apart by the caller — that distinction is the whole point. A half
 * that failed carries the reader-facing reason rather than being dropped.
 */
export interface StatementSources {
	readonly pdf: File | null;
	readonly csv: File | null;
	/** Reader-facing reasons, one per half that did not arrive. */
	readonly failures: readonly string[];
}

/**
 * Fetch both halves of a statement on one token.
 *
 * The two are fetched *concurrently*, which is not premature cleverness: the
 * token they share lasts five minutes, and spending two round trips back to
 * back on a bank that is not always quick narrows a window that is already
 * narrow. `allSettled` rather than `all` because one half failing is not a
 * reason to throw away the other — a certified PDF with no categories still
 * draws every balance in the app.
 *
 * This never throws for a bank-side failure. It reports. A caller that got one
 * half and no word of the other would be back to the bug this exists to fix.
 */
export async function fetchStatementSources(request: StatementRequest): Promise<StatementSources> {
	const [pdf, csv] = await Promise.allSettled([
		fetchCertifiedStatement(request),
		fetchSmartSearch(request)
	]);

	// An abort is the reader's own doing, not a failure to report at them.
	for (const half of [pdf, csv]) {
		if (half.status === 'rejected' && isAbort(half.reason)) throw half.reason;
	}

	return {
		pdf: pdf.status === 'fulfilled' ? pdf.value : null,
		csv: csv.status === 'fulfilled' ? csv.value : null,
		failures: [
			...(pdf.status === 'rejected' ? [describeHalf('certified statement', pdf.reason)] : []),
			...(csv.status === 'rejected' ? [describeHalf('Smart Search export', csv.reason)] : [])
		]
	};
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** One half's failure, said in a way that names which half it was. */
function describeHalf(half: string, error: unknown): string {
	const reason =
		error instanceof BankRequestError ? error.message : 'Something went wrong fetching it.';

	return `The ${half} did not arrive. ${reason}`;
}

/**
 * One POST to Discovery, with the headers both of its endpoints want.
 *
 * The body is the caller's, because the two endpoints do not agree on one —
 * see {@link smartSearchBody} for the casing that differs between them.
 */
async function post(
	url: string,
	token: string,
	body: string,
	signal: AbortSignal | undefined
): Promise<Response> {
	try {
		return await fetch(url, {
			method: 'POST',
			signal,
			headers: {
				accept: 'application/json, text/plain, */*',
				authorization: `Bearer ${token}`,
				// Discovery's own site sends `text/plain` for this JSON body, on both
				// endpoints. It is copied rather than corrected: they are what they
				// are, and a tidier content type is not worth a request that might be
				// refused.
				'content-type': 'text/plain'
			},
			body
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
