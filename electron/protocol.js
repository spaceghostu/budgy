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
import { CONTENT_SECURITY_POLICY, assetCandidates, contentType, shellRoute } from './paths.js';

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
 * A JSON answer to one of the shell's own endpoints.
 *
 * `no-store` because every one of these is a live answer about what the app is
 * doing right now, and a cached "checking…" would strand the card mid-sentence.
 *
 * @param {unknown} body
 */
function json(body) {
	return new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
	});
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
 * Requests under the reserved prefix are the shell's own — see
 * {@link shellRoute}. They are how the window asks about updates, and they are
 * answered here rather than over IPC so that the renderer stays an ordinary web
 * page: no preload, nothing on `window`, and a `fetch` that a browser would
 * make the same way.
 *
 * @param {string} buildDir Absolute path to the static build.
 * @param {object} [shell] The shell's own endpoints. Omitted, they all 404.
 * @param {() => unknown} [shell.status]
 * @param {() => Promise<unknown>} [shell.check]
 * @param {() => Promise<unknown>} [shell.download]
 * @param {() => unknown} [shell.install]
 */
export function serveBuild(buildDir, shell = {}) {
	const root = path.resolve(buildDir);

	protocol.handle(SCHEME, async (request) => {
		const { pathname } = new URL(request.url);

		const route = shellRoute(pathname);
		if (route !== null) {
			// A check, a download and an install all change something, and a GET
			// that does is a GET something else can trigger. There is no other
			// origin that can reach this scheme, but the method is the cheapest
			// place to say so.
			const handler = {
				'update/status': shell.status,
				'update/check': request.method === 'POST' ? shell.check : undefined,
				'update/download': request.method === 'POST' ? shell.download : undefined,
				'update/install': request.method === 'POST' ? shell.install : undefined
			}[route];

			if (handler === undefined) {
				return new Response('Not found', {
					status: 404,
					headers: { 'content-type': 'text/plain; charset=utf-8' }
				});
			}

			return json(await handler());
		}

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
