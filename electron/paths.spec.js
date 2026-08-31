import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, assetCandidates, contentType, shellRoute } from './paths.js';

describe('assetCandidates', () => {
	it('answers the root with the prerendered index', () => {
		expect(assetCandidates('/')).toEqual(['index.html']);
	});

	it('maps a route onto the file adapter-static named after it', () => {
		expect(assetCandidates('/forecast')).toContain('forecast.html');
	});

	it('falls back to the index for a route, so a deep link still opens', () => {
		expect(assetCandidates('/net-worth').at(-1)).toBe('index.html');
	});

	it('ignores a trailing slash rather than insisting on a directory', () => {
		expect(assetCandidates('/history/')).toEqual(assetCandidates('/history'));
	});

	it('gives a named file one chance, so a missing asset fails as one', () => {
		expect(assetCandidates('/_app/immutable/entry/app.js')).toEqual([
			'_app/immutable/entry/app.js'
		]);
	});

	it('decodes escapes, because the filesystem never saw them', () => {
		expect(assetCandidates('/_app/a%20b.css')).toEqual(['_app/a b.css']);
	});

	it('refuses to climb out of the build', () => {
		expect(assetCandidates('/../../../etc/passwd')).toEqual([]);
	});

	it('refuses an escaped climb as well as a plain one', () => {
		expect(assetCandidates('/%2e%2e/%2e%2e/etc/passwd')).toEqual([]);
	});

	it('refuses a Windows separator smuggled through a segment', () => {
		expect(assetCandidates('/_app/..\\..\\secrets')).toEqual([]);
	});

	it('refuses malformed escaping instead of guessing at it', () => {
		expect(assetCandidates('/%E0%A4%A')).toEqual([]);
	});
});

describe('contentType', () => {
	it('names the types the bundle is made of', () => {
		expect(contentType('index.html')).toBe('text/html; charset=utf-8');
		expect(contentType('app.js')).toBe('text/javascript; charset=utf-8');
		expect(contentType('style.css')).toBe('text/css; charset=utf-8');
	});

	it('does not put a charset on bytes that are not text', () => {
		expect(contentType('icon.png')).toBe('image/png');
		expect(contentType('pdf.wasm')).toBe('application/wasm');
	});

	it('reads the extension case-insensitively', () => {
		expect(contentType('LOGO.SVG')).toBe('image/svg+xml');
	});

	it('falls back to bytes for anything it does not know', () => {
		expect(contentType('statement.xyz')).toBe('application/octet-stream');
		expect(contentType('LICENSE')).toBe('application/octet-stream');
	});
});

describe('CONTENT_SECURITY_POLICY', () => {
	it('lets the window reach the two hosts the app calls, and no others', () => {
		const connect = CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith('connect-src'));

		expect(connect).toBe(
			"connect-src 'self' https://api.anthropic.com https://api.discoverybank.co.za"
		);
	});

	it('does not hand the window eval', () => {
		expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
	});

	it('closes the openings a local bundle has no use for', () => {
		expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
		expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
		expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
	});
});

describe('shellRoute', () => {
	it('names the endpoints the window asks the shell for', () => {
		expect(shellRoute('/-/update/status')).toBe('update/status');
		expect(shellRoute('/-/update/check')).toBe('update/check');
		expect(shellRoute('/-/update/download')).toBe('update/download');
		expect(shellRoute('/-/update/install')).toBe('update/install');
	});

	it('leaves an ordinary page to the bundle', () => {
		expect(shellRoute('/')).toBeNull();
		expect(shellRoute('/forecast')).toBeNull();
		expect(shellRoute('/_app/immutable/entry/app.js')).toBeNull();
	});

	it('refuses an endpoint it does not have, rather than guessing', () => {
		expect(shellRoute('/-/update/uninstall')).toBeNull();
		expect(shellRoute('/-/quit')).toBeNull();
		expect(shellRoute('/-')).toBeNull();
	});

	it('reads an escaped prefix as the prefix', () => {
		// %2d is `-`. A route that only matched the literal would let the same
		// request through as a page and serve index.html to a fetch for JSON.
		expect(shellRoute('/%2d/update/status')).toBe('update/status');
	});

	it('says nothing for a path that is not decodable', () => {
		expect(shellRoute('/%ZZ/update/status')).toBeNull();
	});
});

describe('the shell prefix is never a file', () => {
	it('offers no candidate under it, so a bad endpoint cannot become the app', () => {
		// Without this an unknown endpoint would fall through to index.html, and
		// a fetch expecting JSON would be handed the app's own HTML with a 200.
		expect(assetCandidates('/-/update/status')).toEqual([]);
		expect(assetCandidates('/-/anything')).toEqual([]);
		expect(assetCandidates('/-')).toEqual([]);
	});
});
