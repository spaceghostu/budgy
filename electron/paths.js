/**
 * Which file in the static build answers a request path.
 *
 * The desktop build is the same static bundle the web build is, served to the
 * window over a custom scheme rather than over HTTP. That leaves one job a web
 * server would normally do unowned: deciding that `/forecast` means
 * `forecast.html`. `adapter-static` prerenders one file per route and names it
 * after the route, so the mapping is small — but it has to be exact, because
 * getting it wrong shows a blank window rather than an error.
 *
 * Pure on purpose. Everything here is a string in and strings out, so the rule
 * is specced rather than discovered by launching the app.
 */

/** Extensions the build emits, plus the ones a future asset would arrive as. */
const TYPES = Object.freeze({
	html: 'text/html',
	js: 'text/javascript',
	mjs: 'text/javascript',
	css: 'text/css',
	json: 'application/json',
	map: 'application/json',
	webmanifest: 'application/manifest+json',
	txt: 'text/plain',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	avif: 'image/avif',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	wasm: 'application/wasm',
	pdf: 'application/pdf'
});

/**
 * A path segment that must never reach the filesystem.
 *
 * `..` is the one that matters — a window that can be talked into requesting
 * `app://budgy/../../../etc/passwd` would read outside the build. It is checked
 * here, on the decoded segments, so that `%2e%2e` is caught with `..`; the
 * caller checks the resolved path against the build directory as well, because
 * one guard on a filesystem path is not a guard.
 *
 * @param {string} segment
 */
const isUnsafe = (segment) =>
	segment === '..' || segment === '.' || segment.includes('\\') || segment.includes('\0');

/** `%20` and friends, or `undefined` where the escaping is malformed. */
const decode = (/** @type {string} */ pathname) => {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
};

/** Whether the last segment names a file rather than a route. */
const hasExtension = (/** @type {string} */ relative) =>
	/\.[^./]+$/.test(relative.slice(relative.lastIndexOf('/') + 1));

/**
 * The path prefix reserved for the shell, rather than for the bundle.
 *
 * `adapter-static` names its files after routes, and a route is a word — so a
 * segment that could never be one is what keeps the shell's own endpoints from
 * ever colliding with a page. `-` is not a legal route name here and never
 * will be, which is the point of choosing it.
 */
const SHELL_PREFIX = '-';

/**
 * The shell endpoint a request names, or `null` where it names a page.
 *
 * This is how the window talks to the main process. There is no preload and no
 * IPC: the renderer makes an ordinary same-origin `fetch`, and the protocol
 * handler that already answers every other request answers these too. The
 * renderer is still a plain web page with the web platform and nothing else —
 * which is the whole security posture of this shell, and worth keeping while
 * adding an update button to it.
 *
 * Only the names below are answered. An unknown one under the same prefix is
 * `null`, and so 404s as a missing page would, rather than falling through to
 * `index.html` and handing a script the app's own HTML where it asked for JSON.
 *
 * @param {string} pathname The URL's path, `/` first.
 * @returns {'update/status' | 'update/check' | 'update/download' | 'update/install' | null}
 */
export function shellRoute(pathname) {
	const decoded = decode(pathname);
	if (decoded === undefined) return null;

	const segments = decoded.split('/').filter((segment) => segment !== '');
	if (segments[0] !== SHELL_PREFIX) return null;

	const name = segments.slice(1).join('/');

	return name === 'update/status' ||
		name === 'update/check' ||
		name === 'update/download' ||
		name === 'update/install'
		? name
		: null;
}

/**
 * The files to try, in order, for a request path — first one that exists wins.
 *
 * A path that already names a file gets exactly one candidate: an asset that is
 * missing should fail as a missing asset, not quietly render the home page. A
 * path that names a route gets `index.html` as its last resort instead, so that
 * a link into the app lands somewhere the router can take over from.
 *
 * Empty where the path escapes the build, which the caller answers with 404.
 *
 * @param {string} pathname The URL's path, `/` first, query and hash already off.
 * @returns {readonly string[]} Paths relative to the build directory.
 */
export function assetCandidates(pathname) {
	const decoded = decode(pathname);
	if (decoded === undefined) return [];

	const segments = decoded.split('/').filter((segment) => segment !== '');
	if (segments.some(isUnsafe)) return [];
	// The shell's own endpoints are not files, and must not fall back to
	// `index.html` when one is misspelled — see {@link shellRoute}.
	if (segments[0] === SHELL_PREFIX) return [];

	const relative = segments.join('/');
	if (relative === '') return ['index.html'];
	if (hasExtension(relative)) return [relative];

	return [relative, `${relative}.html`, `${relative}/index.html`, 'index.html'];
}

/**
 * What the window is allowed to load and reach, once it is on `app://budgy`.
 *
 * Electron asks for this and is right to: a window with no policy will fetch
 * anything any script in it asks for, and this one holds bank statements. The
 * bundle is entirely local, so almost everything is `'self'`; `connect-src` is
 * the exception, and it names the same two hosts the CORS bridge does — the
 * report and the statement fetch — so a script that tried to send a statement
 * anywhere else would be stopped by the window before it left.
 *
 * `'unsafe-inline'` is there for scripts because SvelteKit boots the app from an
 * inline `<script>` in each prerendered page, and for styles because component
 * styles arrive as `style` attributes. `'unsafe-eval'` is deliberately absent:
 * pdf.js asks whether it may `eval` and does without when the answer is no.
 *
 * Set on documents only. Sub-resources inherit the document's policy.
 */
export const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"worker-src 'self' blob:",
	"connect-src 'self' https://api.anthropic.com https://api.discoverybank.co.za",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'"
].join('; ');

/**
 * The `content-type` for a file the build emitted.
 *
 * A custom scheme has no server to sniff on its behalf, and Chromium will not
 * guess: a stylesheet served as `application/octet-stream` is simply dropped.
 *
 * @param {string} name A file name or path.
 * @returns {string}
 */
export function contentType(name) {
	const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	const type = Object.hasOwn(TYPES, extension) ? TYPES[/** @type {never} */ (extension)] : null;

	// Text without a charset is decoded by Chromium's guess. The bundle is UTF-8,
	// so say so rather than let a name with an accent in it come out wrong.
	if (type === null) return 'application/octet-stream';
	return type.startsWith('text/') || type === 'application/json' ? `${type}; charset=utf-8` : type;
}
