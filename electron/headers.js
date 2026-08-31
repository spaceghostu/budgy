/**
 * Letting the app's own two calls out of the window.
 *
 * The renderer runs on `app://budgy`, and the two requests this app exists to
 * make — Anthropic for a report, Discovery for a statement — are cross-origin
 * from there. In a browser that check is the whole point: it protects a bank
 * from a page the reader merely visited. In a desktop app there is no such
 * page. The window can only ever load this bundle, and this bundle only ever
 * calls the two hosts below, both of them chosen and documented in the modules
 * that call them (`src/lib/ai/client.ts`, `src/lib/bank/discovery.ts`).
 *
 * So the origin check is lifted for exactly those two hosts and nothing else.
 * `webSecurity` stays on, every other origin is still refused, and the list is
 * a literal in this file rather than a wildcard, so widening it is an edit
 * somebody has to make on purpose.
 *
 * Pure: headers in, new headers out. The wiring is in `cors.js`.
 */

/** The hosts the bridge covers, as Electron `webRequest` URL patterns. */
export const BRIDGED_URLS = Object.freeze([
	'https://api.anthropic.com/*',
	'https://api.discoverybank.co.za/*'
]);

/**
 * The request headers the two calls send.
 *
 * Listed rather than answered with `*`, because the wildcard does not cover
 * `authorization` — the spec excludes it — and that is the one Discovery needs.
 * A new header on either call has to be added here or its preflight will fail.
 */
const ALLOWED_HEADERS = [
	'accept',
	'authorization',
	'content-type',
	'x-api-key',
	'anthropic-version',
	'anthropic-dangerous-direct-browser-access'
].join(', ');

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

/** Every name CORS decides on, so the server's own answer cannot conflict. */
const OWNED = [
	'access-control-allow-origin',
	'access-control-allow-headers',
	'access-control-allow-methods',
	'access-control-max-age'
];

/**
 * The response's headers with the CORS answer replaced by ours.
 *
 * Replaced, not added: two `access-control-allow-origin` headers fail the check
 * outright, and Anthropic already sends one of its own. Electron hands the
 * names back in whatever case the server used, so the match is case-insensitive
 * and the header this returns is the only one left.
 *
 * @param {Record<string, string[] | string> | undefined} responseHeaders
 * @param {string} origin The window's own origin, e.g. `app://budgy`.
 * @returns {Record<string, string[] | string>}
 */
export function allowOrigin(responseHeaders, origin) {
	const kept = Object.entries(responseHeaders ?? {}).filter(
		([name]) => !OWNED.includes(name.toLowerCase())
	);

	return {
		...Object.fromEntries(kept),
		'access-control-allow-origin': [origin],
		'access-control-allow-headers': [ALLOWED_HEADERS],
		'access-control-allow-methods': [ALLOWED_METHODS],
		'access-control-max-age': ['600']
	};
}

/**
 * The status line to answer a preflight with, or `undefined` to leave it be.
 *
 * A preflight only passes on a 2xx, and neither host is obliged to give one to
 * a scheme it has never heard of — Discovery in particular answers whatever it
 * answers. Forcing the status is safe because a preflight carries no body and
 * no side effect: it is the browser asking a question that, here, is already
 * settled by {@link BRIDGED_URLS}. Real requests keep their own status,
 * including the failures the app words for the reader.
 *
 * @param {string} method
 * @param {number} statusCode
 */
export function preflightStatus(method, statusCode) {
	if (method !== 'OPTIONS') return undefined;
	return statusCode >= 200 && statusCode < 300 ? undefined : 'HTTP/1.1 200 OK';
}
