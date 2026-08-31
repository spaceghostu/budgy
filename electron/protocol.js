/**
 * Serving the static build to the window over `app://budgy`.
 *
 * The obvious way to open a built page in Electron is `file://`, and it is the
 * wrong one here. Chromium gives a `file://` page an opaque origin, and an
 * opaque origin has no `localStorage` and no IndexedDB — which is where every
 * statement this app has ever read is kept. The window would open, look right,
 * and forget the library on the way in.
 *
 * A custom scheme registered as `standard` has a real origin, and the same one
 * on every launch: `app://budgy` today and after an update, so what the reader
 * saved is still theirs. That stability is the whole reason this is a scheme
 * and not a local HTTP server on some port — a port that moves is a new origin,
 * and a new origin is an empty library.
 *
 * The dev server is a different origin again (`http://localhost:5173`), so what
 * `bun run dev` remembers and what the packaged app remembers are separate. That
 * is the same separation a browser gives two sites, and it is the right one:
 * development should not be reading the reader's statements.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { protocol } from 'electron';
import { CONTENT_SECURITY_POLICY, assetCandidates, contentType } from './paths.js';

export const SCHEME = 'app';
export const HOST = 'budgy';

/** Where the window is pointed, and the origin its storage is filed under. */
export const APP_ORIGIN = `${SCHEME}://${HOST}`;
export const APP_URL = `${APP_ORIGIN}/`;

/**
 * Tell Chromium what kind of scheme this is, before it starts.
 *
 * This has to run before `app.whenReady()`. Registered late it fails silently:
 * pages still load, and storage is simply missing.
 *
 * `standard` is what gives the scheme an origin at all. `secure` makes it a
 * secure context, which service workers, `crypto.subtle` and a fair amount of
 * modern DOM quietly require. `supportFetchAPI` and `corsEnabled` let the
 * bundle's own `fetch` calls leave the window — see `headers.js` for the two
 * hosts they are allowed to reach.
 */
export function registerScheme() {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: SCHEME,
			privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
		}
	]);
}

/** A file inside `root`, or `null` where it is missing or outside it. */
async function read(root, relative) {
	const file = path.resolve(root, relative);

	// `assetCandidates` has already refused `..`, on the decoded segments. This
	// is the second check, on the resolved path, because a guard on a filesystem
	// path that exists in only one place is a guard one refactor from being gone.
	if (file !== root && !file.startsWith(root + path.sep)) return null;

	try {
		return await readFile(file);
	} catch {
		return null;
	}
}

/**
 * Answer every `app://budgy/...` request out of the build directory.
 *
 * Whole-file reads rather than streams: the bundle is a couple of megabytes of
 * HTML, JavaScript and CSS on local disk, and reading it whole keeps this
 * honest about failure — a file either arrives or it does not, with no half a
 * response to unwind. It also reads straight through an `asar` archive, which
 * is how the packaged app stores it.
 *
 * @param {string} buildDir Absolute path to the static build.
 */
export function serveBuild(buildDir) {
	const root = path.resolve(buildDir);

	protocol.handle(SCHEME, async (request) => {
		const { pathname } = new URL(request.url);

		for (const candidate of assetCandidates(pathname)) {
			const body = await read(root, candidate);
			if (body === null) continue;

			const type = contentType(candidate);
			const csp = type.startsWith('text/html')
				? { 'content-security-policy': CONTENT_SECURITY_POLICY }
				: {};

			return new Response(body, { headers: { 'content-type': type, ...csp } });
		}

		return new Response('Not found', {
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	});
}
