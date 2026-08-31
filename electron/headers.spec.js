import { describe, expect, it } from 'vitest';
import { BRIDGED_URLS, allowOrigin, preflightStatus } from './headers.js';

const ORIGIN = 'app://budgy';

describe('BRIDGED_URLS', () => {
	it('covers the two hosts the app calls, and only those', () => {
		expect(BRIDGED_URLS).toEqual([
			'https://api.anthropic.com/*',
			'https://api.discoverybank.co.za/*'
		]);
	});
});

describe('allowOrigin', () => {
	it('names the window as the allowed origin', () => {
		const headers = allowOrigin({}, ORIGIN);

		expect(headers['access-control-allow-origin']).toEqual([ORIGIN]);
	});

	it('replaces the origin the server sent rather than adding a second', () => {
		const headers = allowOrigin({ 'Access-Control-Allow-Origin': ['*'] }, ORIGIN);

		const origins = Object.keys(headers).filter(
			(name) => name.toLowerCase() === 'access-control-allow-origin'
		);
		expect(origins).toEqual(['access-control-allow-origin']);
		expect(headers['access-control-allow-origin']).toEqual([ORIGIN]);
	});

	it('allows authorization by name, which the wildcard would not cover', () => {
		const allowed = allowOrigin({}, ORIGIN)['access-control-allow-headers'];

		expect(String(allowed)).toContain('authorization');
	});

	it('allows the headers the Anthropic call sends', () => {
		const allowed = String(allowOrigin({}, ORIGIN)['access-control-allow-headers']);

		expect(allowed).toContain('x-api-key');
		expect(allowed).toContain('anthropic-version');
		expect(allowed).toContain('anthropic-dangerous-direct-browser-access');
	});

	it('leaves every other header the server sent alone', () => {
		const headers = allowOrigin({ 'Content-Type': ['application/json'] }, ORIGIN);

		expect(headers['Content-Type']).toEqual(['application/json']);
	});

	it('copes with a response that carried no headers at all', () => {
		expect(allowOrigin(undefined, ORIGIN)['access-control-allow-origin']).toEqual([ORIGIN]);
	});
});

describe('preflightStatus', () => {
	it('leaves the status of a real request alone', () => {
		expect(preflightStatus('POST', 401)).toBeUndefined();
	});

	it('leaves a preflight the host already accepted alone', () => {
		expect(preflightStatus('OPTIONS', 204)).toBeUndefined();
	});

	it('rescues a preflight the host refused', () => {
		expect(preflightStatus('OPTIONS', 403)).toBe('HTTP/1.1 200 OK');
	});
});
