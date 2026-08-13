/**
 * The call to Anthropic.
 *
 * Straight `fetch` rather than the SDK: this app ships as a static bundle with
 * two runtime dependencies, and one POST does not justify a third.
 *
 * There is no server to hide a key behind — the whole product is a page that
 * reads your files locally — so the key is the reader's own, entered by them
 * and held on their device. That is what
 * `anthropic-dangerous-direct-browser-access` is for: it opts into CORS from
 * the browser, and it is only defensible because the key belongs to the person
 * typing it. Do not use it to ship a key of your own to other people's browsers.
 */

import type { AiPayload } from './payload.ts';
import { REPORT_TOOL, SYSTEM_PROMPT, buildUserPrompt } from './prompt.ts';
import { parseReport, type SpendingReport } from './report.ts';

export const API_URL = 'https://api.anthropic.com/v1/messages';

/** The API's own version header, not this app's version. */
export const ANTHROPIC_VERSION = '2023-06-01';

export const MODEL = 'claude-sonnet-5';

/** Enough for a headline, five findings and four actions, with room to spare. */
export const MAX_TOKENS = 1500;

/** A failure worth showing the reader, already worded for them. */
export class AiRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiRequestError';
	}
}

export interface SpendingRequest {
	readonly payload: AiPayload;
	/** The reader's own Anthropic key. */
	readonly apiKey: string;
	/** What they typed in the note box, if anything. Sent verbatim. */
	readonly note?: string;
	/**
	 * Aborts the request. An abort is rethrown as-is rather than wrapped, so the
	 * caller can tell "the reader cancelled" from "it failed".
	 */
	readonly signal?: AbortSignal;
}

/**
 * Ask Claude to read the period and report what stands out.
 *
 * @throws {AiRequestError} With a message written for the reader.
 */
export async function requestSpendingReport(request: SpendingRequest): Promise<SpendingReport> {
	const key = request.apiKey.trim();
	if (key === '') throw new AiRequestError('Enter your Anthropic API key first.');

	const response = await send(request, key);
	if (!response.ok) throw new AiRequestError(await describeFailure(response));

	const report = parseReport(findToolInput(await readBody(response)));
	if (report === null) {
		throw new AiRequestError('Claude replied in a shape this app could not read. Try again.');
	}

	return report;
}

/**
 * The reply's JSON, or `null` if it is not JSON at all.
 *
 * A cancel can land between the headers arriving and the body finishing, which
 * rejects here rather than at the fetch. Letting that through as `null` would
 * report the reader's own cancel as a malformed reply.
 */
async function readBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return null;
	}
}

async function send(request: SpendingRequest, key: string): Promise<Response> {
	try {
		return await fetch(API_URL, {
			method: 'POST',
			signal: request.signal,
			headers: {
				'content-type': 'application/json',
				'x-api-key': key,
				'anthropic-version': ANTHROPIC_VERSION,
				'anthropic-dangerous-direct-browser-access': 'true'
			},
			body: JSON.stringify({
				model: MODEL,
				max_tokens: MAX_TOKENS,
				system: SYSTEM_PROMPT,
				tools: [REPORT_TOOL],
				// Forced, so the answer is a validated object every time.
				tool_choice: { type: 'tool', name: REPORT_TOOL.name },
				messages: [{ role: 'user', content: buildUserPrompt(request.payload, request.note) }]
			})
		});
	} catch (error: unknown) {
		// An abort is the reader's own doing — let it past untouched.
		if (error instanceof DOMException && error.name === 'AbortError') throw error;

		throw new AiRequestError(
			'Could not reach Anthropic. Check your connection, or whether a browser extension is blocking the request.'
		);
	}
}

/**
 * Turn a failed response into one sentence.
 *
 * The status is what the reader can act on — a rejected key and a rate limit
 * need different things from them — so each is worded rather than reported as a
 * number. The API's own message is passed through only where it says something
 * this code cannot know.
 */
async function describeFailure(response: Response): Promise<string> {
	const detail = await errorMessage(response);

	switch (response.status) {
		case 401:
			return 'That API key was rejected. Check it and try again.';
		case 403:
			return 'That API key is not allowed to use this model.';
		case 404:
			return `Anthropic does not know the model ${MODEL}. This app may need updating.`;
		case 413:
			return 'That period is too large to send. Narrow it and try again.';
		case 429:
			return 'Too many requests — Anthropic is rate-limiting this key. Wait a moment and try again.';
		default:
			break;
	}

	if (response.status >= 500) {
		return `Anthropic had a problem (${response.status}). Try again shortly.`;
	}

	return detail === null
		? `Anthropic refused the request (${response.status}).`
		: `Anthropic refused the request: ${detail}`;
}

async function errorMessage(response: Response): Promise<string | null> {
	try {
		const body: unknown = await response.json();
		const error = (body as { error?: { message?: unknown } } | null)?.error;
		return typeof error?.message === 'string' ? error.message : null;
	} catch {
		// A gateway between here and Anthropic can answer in HTML.
		return null;
	}
}

/** The forced tool call's input, or `null` if the reply has no such block. */
function findToolInput(body: unknown): unknown {
	const content = (body as { content?: unknown } | null)?.content;
	if (!Array.isArray(content)) return null;

	const block = content.find(
		(item: unknown) =>
			typeof item === 'object' &&
			item !== null &&
			(item as { type?: unknown }).type === 'tool_use' &&
			(item as { name?: unknown }).name === REPORT_TOOL.name
	);

	return (block as { input?: unknown } | undefined)?.input ?? null;
}
