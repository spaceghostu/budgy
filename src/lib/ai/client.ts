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

import { REPORT_TOOL, SYSTEM_PROMPT, buildFollowUp } from './prompt.ts';
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

/**
 * What the report tool "returns".
 *
 * It has no implementation — calling it *is* the answer, and the card renders
 * the call's own input. But the API will not carry a conversation past a tool
 * call that was never answered, so every reply is answered with the one true
 * thing there is to say about it.
 */
const TOOL_RESULT = 'Shown to the reader.';

/** A reply from Claude, kept whole so the conversation can continue from it. */
export interface ReportReply {
	/** The part the card draws. */
	readonly report: SpendingReport;
	/**
	 * The reply's own content blocks, verbatim.
	 *
	 * Sent straight back as the assistant's turn when the reader asks something
	 * else — the API wants its own words returned to it unedited, and the
	 * `tool_use` block inside carries the id that {@link toolUseId} answers.
	 */
	readonly content: readonly unknown[];
	/** The forced tool call's id. The next message has to answer this one. */
	readonly toolUseId: string;
}

/** A finished exchange: what the reader asked, and what came back. */
export interface ReportTurn extends ReportReply {
	/** What the reader typed. Blank where they asked for a plain read. */
	readonly question: string;
}

export interface SpendingRequest {
	/** The reader's own Anthropic key. */
	readonly apiKey: string;
	/**
	 * The message that opens the conversation: the figures, framed, and whatever
	 * note the reader added. Built by `buildUserPrompt`.
	 *
	 * Passed in rather than rebuilt here so that a conversation keeps talking
	 * about the figures it started on. The reader can change the filters under a
	 * report — rebuilding this from what is now on screen would rewrite the
	 * question Claude has already answered, and leave its first reply describing
	 * numbers that were never sent.
	 */
	readonly opening: string;
	/** Finished exchanges, oldest first. Empty on the first ask. */
	readonly turns?: readonly ReportTurn[];
	/**
	 * The follow-up. Sent word for word, after everything in `turns`, capped by
	 * `buildFollowUp` exactly as the opening note is.
	 *
	 * Ignored when there are no turns yet: the opening is the question then, and
	 * the reader's note is already inside it.
	 */
	readonly question?: string;
	/**
	 * Aborts the request. An abort is rethrown as-is rather than wrapped, so the
	 * caller can tell "the reader cancelled" from "it failed".
	 */
	readonly signal?: AbortSignal;
}

/**
 * Ask Claude to read the period, or to answer a follow-up about a read it has
 * already written.
 *
 * @throws {AiRequestError} With a message written for the reader.
 */
export async function requestSpendingReport(request: SpendingRequest): Promise<ReportReply> {
	const key = request.apiKey.trim();
	if (key === '') throw new AiRequestError('Enter your Anthropic API key first.');

	if ((request.turns ?? []).length > 0 && buildFollowUp(request.question ?? '') === '') {
		throw new AiRequestError('Type a follow-up question first.');
	}

	const response = await send(request, key);
	if (!response.ok) throw new AiRequestError(await describeFailure(response));

	const reply = toReply(await readBody(response));
	if (reply === null) {
		throw new AiRequestError('Claude replied in a shape this app could not read. Try again.');
	}

	return reply;
}

/**
 * The conversation so far, in the shape the Messages API takes.
 *
 * The alternation is fixed by the API: an assistant turn holding a `tool_use`
 * has to be followed by a user turn holding a `tool_result` for the same id. So
 * each follow-up question travels *with* the answer to the call before it,
 * rather than as a message of its own.
 */
function buildMessages(request: SpendingRequest): readonly unknown[] {
	const turns = request.turns ?? [];
	const messages: unknown[] = [{ role: 'user', content: request.opening }];

	turns.forEach((turn, index) => {
		const next = turns[index + 1];
		messages.push(
			{ role: 'assistant', content: turn.content },
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: turn.toolUseId, content: TOOL_RESULT },
					{
						type: 'text',
						text: buildFollowUp(next === undefined ? (request.question ?? '') : next.question)
					}
				]
			}
		);
	});

	return messages;
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
				// Forced, so every turn — the opening read and each follow-up — comes
				// back as a validated object the card can draw the same way.
				tool_choice: { type: 'tool', name: REPORT_TOOL.name },
				messages: buildMessages(request)
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

/**
 * The reply, read as a report plus everything needed to answer it.
 *
 * `null` where the reply carries no usable report — no tool call, an id the
 * next turn could not answer, or a call whose input {@link parseReport} rejects.
 * All three land in front of the reader the same way, as a reply this app could
 * not read.
 */
function toReply(body: unknown): ReportReply | null {
	const content = (body as { content?: unknown } | null)?.content;
	if (!Array.isArray(content)) return null;

	const block = content.find(
		(item: unknown) =>
			typeof item === 'object' &&
			item !== null &&
			(item as { type?: unknown }).type === 'tool_use' &&
			(item as { name?: unknown }).name === REPORT_TOOL.name
	) as { id?: unknown; input?: unknown } | undefined;

	if (typeof block?.id !== 'string') return null;

	const report = parseReport(block.input);
	return report === null ? null : { report, content, toolUseId: block.id };
}
