import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ANTHROPIC_VERSION,
	API_URL,
	AiRequestError,
	MODEL,
	requestSpendingReport,
	type ReportTurn
} from './client.ts';
import { buildAiPayload } from './payload.ts';
import { REPORT_TOOL, buildUserPrompt } from './prompt.ts';
import { buildInsights } from '../stats/insights.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';

function opening(note = ''): string {
	resetTransactionIds();
	return buildUserPrompt(
		buildAiPayload(buildInsights([makeTransaction({ date: '2026-01-05', amount: -400 })], 600)),
		note
	);
}

const REPORT = {
	headline: 'One purchase, R400.',
	findings: [{ title: 'Only outgoing', detail: 'R400 at Something.', tone: 'neutral' }],
	actions: []
};

function toolUseResponse(input: unknown = REPORT, id = 'tu_1'): Response {
	return new Response(
		JSON.stringify({
			content: [
				{ type: 'text', text: 'Let me look.' },
				{ type: 'tool_use', id, name: REPORT_TOOL.name, input }
			],
			stop_reason: 'tool_use'
		}),
		{ status: 200 }
	);
}

/** A finished exchange, as the card would have kept it. */
function turn(question: string, id = 'tu_1'): ReportTurn {
	return {
		question,
		report: REPORT as ReportTurn['report'],
		content: [{ type: 'tool_use', id, name: REPORT_TOOL.name, input: REPORT }],
		toolUseId: id
	};
}

/** The messages of the one request that was made. */
function sentMessages(fetchMock: ReturnType<typeof vi.fn>): { role: string; content: unknown }[] {
	const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
	return (JSON.parse(init.body as string) as { messages: { role: string; content: unknown }[] })
		.messages;
}

function errorResponse(status: number, message = 'nope'): Response {
	return new Response(JSON.stringify({ type: 'error', error: { type: 'x', message } }), { status });
}

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(() =>
		response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('requestSpendingReport', () => {
	it('returns the report from the forced tool call', async () => {
		stubFetch(toolUseResponse());

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).resolves.toMatchObject({ report: REPORT });
	});

	it('keeps the reply whole, so the conversation can be continued from it', async () => {
		stubFetch(toolUseResponse());

		const reply = await requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' });

		// The prose block beside the tool call is kept too: the API wants its own
		// words back unedited, not the part this app happened to render.
		expect(reply.toolUseId).toBe('tu_1');
		expect(reply.content).toEqual([
			{ type: 'text', text: 'Let me look.' },
			{ type: 'tool_use', id: 'tu_1', name: REPORT_TOOL.name, input: REPORT }
		]);
	});

	it('posts to the Messages API with the key and the browser opt-in header', async () => {
		const fetchMock = stubFetch(toolUseResponse());
		await requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(API_URL);
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({
			'x-api-key': 'sk-ant-key',
			'anthropic-version': ANTHROPIC_VERSION,
			'anthropic-dangerous-direct-browser-access': 'true',
			'content-type': 'application/json'
		});
	});

	it('forces the report tool, so the answer is structured rather than prose', async () => {
		const fetchMock = stubFetch(toolUseResponse());
		await requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' });

		const body: Record<string, unknown> = JSON.parse(
			(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
		);
		expect(body.model).toBe(MODEL);
		expect(body.tool_choice).toEqual({ type: 'tool', name: REPORT_TOOL.name });
		expect(body).toHaveProperty('max_tokens');
	});

	it('sends the reader’s note along with the figures', async () => {
		const fetchMock = stubFetch(toolUseResponse());
		await requestSpendingReport({
			opening: opening('Saving for a deposit in June.'),
			apiKey: 'sk-ant-key'
		});

		const messages = sentMessages(fetchMock);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ role: 'user' });
		expect(messages[0].content).toContain('Saving for a deposit in June.');
	});

	it('continues the conversation: reply back verbatim, answered, then the question', async () => {
		const fetchMock = stubFetch(toolUseResponse(REPORT, 'tu_2'));
		const first = turn('Why was January so bad?');

		await requestSpendingReport({
			opening: opening('Why was January so bad?'),
			apiKey: 'sk-ant-key',
			turns: [first],
			question: 'Break down those bank fees.'
		});

		const messages = sentMessages(fetchMock);
		expect(messages).toHaveLength(3);
		expect(messages[0]).toMatchObject({ role: 'user' });

		// The API will not carry a conversation past a tool call that was never
		// answered, so the follow-up rides with the tool_result for the call above
		// it rather than arriving as a message of its own.
		expect(messages[1]).toEqual({ role: 'assistant', content: first.content });
		expect(messages[2]).toEqual({
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: 'tu_1', content: expect.any(String) },
				{ type: 'text', text: 'Break down those bank fees.' }
			]
		});
	});

	it('sends the figures once, however long the conversation runs', async () => {
		const fetchMock = stubFetch(toolUseResponse(REPORT, 'tu_3'));

		await requestSpendingReport({
			opening: opening(),
			apiKey: 'sk-ant-key',
			turns: [turn('', 'tu_1'), turn('And the subscriptions?', 'tu_2')],
			question: 'Which is newest?'
		});

		const messages = sentMessages(fetchMock);
		expect(messages).toHaveLength(5);
		expect(
			messages.filter((message) => JSON.stringify(message.content).includes('largestExpenses'))
		).toHaveLength(1);

		// Each question sits with the answer to the call before it, in order.
		expect(messages[2]).toMatchObject({
			content: [
				{ type: 'tool_result', tool_use_id: 'tu_1' },
				{ type: 'text', text: 'And the subscriptions?' }
			]
		});
		expect(messages[4]).toMatchObject({
			content: [
				{ type: 'tool_result', tool_use_id: 'tu_2' },
				{ type: 'text', text: 'Which is newest?' }
			]
		});
	});

	it('refuses to send a follow-up with nothing in it', async () => {
		const fetchMock = stubFetch(toolUseResponse());

		await expect(
			requestSpendingReport({
				opening: opening(),
				apiKey: 'sk-ant-key',
				turns: [turn('')],
				question: '   '
			})
		).rejects.toThrow(AiRequestError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses to send anything without a key', async () => {
		const fetchMock = stubFetch(toolUseResponse());

		await expect(requestSpendingReport({ opening: opening(), apiKey: '  ' })).rejects.toThrow(
			AiRequestError
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('explains a rejected key rather than showing the raw status', async () => {
		stubFetch(errorResponse(401, 'invalid x-api-key'));

		await expect(requestSpendingReport({ opening: opening(), apiKey: 'bad' })).rejects.toThrow(
			/key/i
		);
	});

	it('names rate limiting for what it is', async () => {
		stubFetch(errorResponse(429));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/too many|rate/i);
	});

	it('reports a server-side failure as Anthropic’s, not the reader’s', async () => {
		stubFetch(errorResponse(503));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/Anthropic/i);
	});

	it('passes the API’s own message through on a bad request', async () => {
		stubFetch(errorResponse(400, 'max_tokens: must be greater than 0'));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/max_tokens/);
	});

	it('survives an error body that is not JSON', async () => {
		stubFetch(new Response('<html>gateway</html>', { status: 502 }));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('turns a network failure into something a reader can act on', async () => {
		stubFetch(new TypeError('Failed to fetch'));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/reach|connection/i);
	});

	it('fails when the reply carries no tool call', async () => {
		stubFetch(
			new Response(JSON.stringify({ content: [{ type: 'text', text: 'I cannot.' }] }), {
				status: 200
			})
		);

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('fails when the tool call is the wrong shape', async () => {
		stubFetch(toolUseResponse({ headline: 'Nothing else' }));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('lets an abort during the body read through as an abort, not a bad reply', async () => {
		const aborted = new Response('{}', { status: 200 });
		vi.spyOn(aborted, 'json').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		stubFetch(aborted);

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key' })
		).rejects.not.toBeInstanceOf(AiRequestError);
	});

	it('lets an abort through untouched, so a cancel is not shown as an error', async () => {
		const controller = new AbortController();
		controller.abort();
		stubFetch(new DOMException('Aborted', 'AbortError'));

		await expect(
			requestSpendingReport({ opening: opening(), apiKey: 'sk-ant-key', signal: controller.signal })
		).rejects.not.toBeInstanceOf(AiRequestError);
	});
});
