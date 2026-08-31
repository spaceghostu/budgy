/**
 * Budgy as a desktop app.
 *
 * The window is the same bundle the web build is — same parsing, same charts,
 * same "nothing leaves the machine". What the desktop adds is not a feature but
 * a place: statements live in one app the reader opens, rather than in whatever
 * browser profile happened to be open when they last uploaded one.
 *
 * Everything here is shell. There is no application logic in the main process
 * and no IPC, so there is no preload: the renderer is given nothing beyond a
 * normal web page, and the bundle is unchanged by being run this way.
 */

import path from 'node:path';
import { BrowserWindow, app, nativeTheme, net, session, shell } from 'electron';
import { bridgeCors } from './cors.js';
import { APP_ORIGIN, APP_URL, registerScheme, serveBuild } from './protocol.js';

/**
 * The dev URL as Chromium will spell it — `http://localhost:5173/`, slash and all.
 *
 * Canonicalised once, here, because the retry below compares what failed to load
 * against this string, and Chromium reports the address it normalised rather than
 * the one it was given. Comparing the two forms is a mismatch that never fires and
 * a window that waits forever.
 *
 * @param {string} url
 */
const normalise = (url) => (url === '' ? '' : new URL(url).href);

/**
 * The Vite dev server, when there is one.
 *
 * Set by `bun run desktop:dev`; unset everywhere else, including a plain
 * `electron .` against a build. Explicit rather than inferred from
 * `app.isPackaged`, so that the packaged bundle can be run and checked
 * unpackaged without the shell quietly reaching for a server that is not there.
 */
const DEV_URL = normalise(process.env.BUDGY_DEV_URL ?? '');

const BUILD_DIR = path.join(import.meta.dirname, '..', 'build');

/** How often to ask the dev server whether it has finished starting. */
const POLL_MS = 500;

/** The origins the window is allowed to be on. Everything else opens outside. */
const ALLOWED_ORIGINS = [APP_ORIGIN, ...(DEV_URL === '' ? [] : [new URL(DEV_URL).origin])];

/** Matches the app's own `--background`, so the first paint is not a white flash. */
const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#f9f9f7');

/**
 * Send a link somewhere a link belongs — a browser — and refuse the rest.
 *
 * The one external link in the app is the Anthropic console, which the reader
 * follows to fetch their own key. Opening it in a second Electron window would
 * put a page nobody audited inside the app that holds their statements.
 *
 * @param {string} url
 */
function openExternally(url) {
	if (url.startsWith('https://')) void shell.openExternal(url);
}

/** @param {import('electron').WebContents} contents */
function harden(contents) {
	contents.setWindowOpenHandler(({ url }) => {
		openExternally(url);
		return { action: 'deny' };
	});

	contents.on('will-navigate', (event, url) => {
		if (ALLOWED_ORIGINS.includes(new URL(url).origin)) return;

		event.preventDefault();
		openExternally(url);
	});

	// Nothing in the bundle asks for a camera, a location or a notification. A
	// request for one is a sign something is loaded that should not be.
	contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
		callback(false)
	);
}

/**
 * Load the dev server once it is answering, rather than racing it.
 *
 * `bun run dev` and `bun run desktop:dev` are two terminals, and whichever order
 * they are started in the window should end up on the page.
 *
 * It waits by asking the server whether it is there, not by navigating at it
 * repeatedly: a window told to load an address that is refusing connections
 * several times a second spends its time unwinding failed navigations, and a
 * Chromium busy doing that is a Chromium that answers nothing else. Any reply
 * at all means the server is up — a 404 is still someone home.
 *
 * The window is shown while it waits, because waiting is not the same as
 * nothing happening, and an app that opens no window looks like one that
 * failed to start.
 *
 * @param {BrowserWindow} window
 */
async function loadDevServer(window) {
	window.show();

	while (!window.isDestroyed()) {
		try {
			await net.fetch(DEV_URL, { method: 'HEAD' });
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
	}

	if (!window.isDestroyed()) await window.loadURL(DEV_URL);
}

function createWindow() {
	const window = new BrowserWindow({
		width: 1280,
		height: 880,
		minWidth: 640,
		minHeight: 520,
		backgroundColor: backgroundColor(),
		// Held back until the page has painted, so the app does not open on an
		// empty rectangle while the bundle boots.
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			// No preload and nothing to reach for: the renderer gets the web
			// platform and no more. These are Electron's defaults; they are written
			// out because they are the security posture, and a default that matters
			// is worth saying out loud.
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true
		}
	});

	harden(window.webContents);
	window.once('ready-to-show', () => window.show());

	if (DEV_URL === '') void window.loadURL(APP_URL);
	else void loadDevServer(window);

	return window;
}

/**
 * One instance, because there is one library.
 *
 * Two windows on the same IndexedDB would each hold a view of the statements
 * and each write over the other's. A second launch raises the window that is
 * already open instead.
 */
if (!app.requestSingleInstanceLock()) app.quit();
else {
	registerScheme();

	app.on('second-instance', () => {
		const [window] = BrowserWindow.getAllWindows();
		if (window === undefined) return;

		if (window.isMinimized()) window.restore();
		window.focus();
	});

	app.whenReady().then(() => {
		serveBuild(BUILD_DIR);
		bridgeCors(session.defaultSession, APP_ORIGIN);
		createWindow();

		// macOS keeps the app running with no windows; clicking the dock icon is
		// how a window comes back.
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}
