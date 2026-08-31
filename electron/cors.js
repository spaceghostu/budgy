/**
 * Wiring the CORS bridge described in `headers.js` onto a session.
 *
 * Scoped to the two hosts by the filter, so no other request in the app is even
 * seen by this handler.
 */

import { BRIDGED_URLS, allowOrigin, preflightStatus } from './headers.js';

/**
 * @param {import('electron').Session} session
 * @param {string} origin The window's own origin.
 */
export function bridgeCors(session, origin) {
	session.webRequest.onHeadersReceived({ urls: [...BRIDGED_URLS] }, (details, callback) => {
		callback({
			responseHeaders: allowOrigin(details.responseHeaders, origin),
			statusLine: preflightStatus(details.method, details.statusCode)
		});
	});
}
