import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ANTHROPIC_VERSION,
	API_URL,
	AiRequestError,
	MODEL,
	requestSpendingReport
} from './client.ts';
import { buildAiPayload } from './payload.ts';
import { REPORT_TOOL } from './prompt.ts';
import { buildInsights } from '../stats/insights.ts';
import { makeTransaction, resetTransactionIds } from '../testing/transaction.ts';

function payload() {
	resetTransactionIds();
	return buildAiPayload(
		buildInsights([makeTransaction({ date: '2026-01-05', amount: -400 })], 600)
	);
}

const REPORT = {
	headline: 'One purchase, R400.',
	findings: [{ title: 'Only outgoing', detail: 'R400 at Something.', tone: 'neutral' }],
	actions: []
};

function toolUseResponse(input: unknown = REPORT): Response {
	return new Response(
		JSON.stringify({
			content: [
				{ type: 'text', text: 'Let me look.' },
				{ type: 'tool_use', id: 'tu_1', name: REPORT_TOOL.name, input }
			],
			stop_reason: 'tool_use'
		}),
		{ status: 200 }
	);
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
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).resolves.toEqual(REPORT);
	});

	it('posts to the Messages API with the key and the browser opt-in header', async () => {
		const fetchMock = stubFetch(toolUseResponse());
		await requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' });

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
		await requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' });

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
			payload: payload(),
			apiKey: 'sk-ant-key',
			note: 'Saving for a deposit in June.'
		});

		const body: { messages: { content: string }[] } = JSON.parse(
			(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
		);
		expect(body.messages[0].content).toContain('Saving for a deposit in June.');
	});

	it('refuses to send anything without a key', async () => {
		const fetchMock = stubFetch(toolUseResponse());

		await expect(requestSpendingReport({ payload: payload(), apiKey: '  ' })).rejects.toThrow(
			AiRequestError
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('explains a rejected key rather than showing the raw status', async () => {
		stubFetch(errorResponse(401, 'invalid x-api-key'));

		await expect(requestSpendingReport({ payload: payload(), apiKey: 'bad' })).rejects.toThrow(
			/key/i
		);
	});

	it('names rate limiting for what it is', async () => {
		stubFetch(errorResponse(429));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/too many|rate/i);
	});

	it('reports a server-side failure as Anthropic’s, not the reader’s', async () => {
		stubFetch(errorResponse(503));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/Anthropic/i);
	});

	it('passes the API’s own message through on a bad request', async () => {
		stubFetch(errorResponse(400, 'max_tokens: must be greater than 0'));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/max_tokens/);
	});

	it('survives an error body that is not JSON', async () => {
		stubFetch(new Response('<html>gateway</html>', { status: 502 }));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('turns a network failure into something a reader can act on', async () => {
		stubFetch(new TypeError('Failed to fetch'));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(/reach|connection/i);
	});

	it('fails when the reply carries no tool call', async () => {
		stubFetch(
			new Response(JSON.stringify({ content: [{ type: 'text', text: 'I cannot.' }] }), {
				status: 200
			})
		);

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('fails when the tool call is the wrong shape', async () => {
		stubFetch(toolUseResponse({ headline: 'Nothing else' }));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.toThrow(AiRequestError);
	});

	it('lets an abort during the body read through as an abort, not a bad reply', async () => {
		const aborted = new Response('{}', { status: 200 });
		vi.spyOn(aborted, 'json').mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		stubFetch(aborted);

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key' })
		).rejects.not.toBeInstanceOf(AiRequestError);
	});

	it('lets an abort through untouched, so a cancel is not shown as an error', async () => {
		const controller = new AbortController();
		controller.abort();
		stubFetch(new DOMException('Aborted', 'AbortError'));

		await expect(
			requestSpendingReport({ payload: payload(), apiKey: 'sk-ant-key', signal: controller.signal })
		).rejects.not.toBeInstanceOf(AiRequestError);
	});
});
