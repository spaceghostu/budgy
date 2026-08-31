/**
 * Keeping the installed app up to date, on the reader's say-so.
 *
 * The app is handed out as an installer, and an installer that is never
 * replaced is a version of this app that keeps whatever was wrong with it. So
 * the desktop build checks GitHub for a newer release.
 *
 * That is the one thing in this app that reaches the network without the reader
 * asking, and it is worth being exact about what it does and does not send. A
 * check is a GET of the release metadata for a public repository: the request
 * carries no statement, no figure, no key and no identifier of any kind beyond
 * what any HTTP request carries. Nothing about the library goes near it. The
 * README says so where a reader will look, and this is the module that has to
 * keep that true.
 *
 * Consent is where the size is. A check is a few kilobytes and happens on
 * launch; the *download* is the better part of a hundred megabytes, so nothing
 * is fetched until the reader has seen that an update exists and asked for it.
 * That is the same shape as the Ask Claude card: the app says what it could do
 * and waits to be told to.
 *
 * Everything that decides what the reader is shown is in `update-state.js`,
 * which is specced. This file holds the calls to Electron that a spec cannot
 * make, and is kept as thin as that split allows.
 */

import electronUpdater from 'electron-updater';
import { failureReason, updateState } from './update-state.js';

const { autoUpdater } = electronUpdater;

/**
 * The current state, and the only copy of it.
 *
 * Held here rather than passed about because two things read it — the route the
 * window polls and the launch check — and they must agree. A phase is only ever
 * written through {@link set}.
 *
 * @type {import('./update-state.js').UpdateState}
 */
let state = updateState({ phase: 'idle', version: '0.0.0' });

/** True once {@link startUpdates} has found a build that can update itself. */
let live = false;

/** @param {Parameters<typeof updateState>[0]} input */
function set(input) {
	state = updateState(input);
}

/** What the window is shown. A copy, so nothing outside here can write it. */
export function updateStatus() {
	return { ...state };
}

/**
 * Ask GitHub whether there is a newer release.
 *
 * Safe to call again while one is already running: electron-updater answers a
 * second check from the same promise, and the reader pressing the button twice
 * should not start two of anything.
 *
 * @returns {Promise<import('./update-state.js').UpdateState>}
 */
export async function checkForUpdates() {
	if (!live) return updateStatus();
	// A download in flight is not a thing to interrupt with a fresh check: the
	// reader has already said yes to this version, and re-checking would throw
	// the progress away to arrive at the same answer.
	if (state.phase === 'downloading' || state.phase === 'ready') return updateStatus();

	set({ phase: 'checking', version: state.version });

	try {
		await autoUpdater.checkForUpdates();
	} catch (error) {
		set({ phase: 'failed', version: state.version, reason: failureReason(error) });
	}

	// The phase itself is set by the events below — `update-available` and
	// `update-not-available` both fire before this resolves — so what is
	// returned is whatever they made of it.
	return updateStatus();
}

/**
 * Fetch the update the reader has just agreed to.
 *
 * Only from `available`: a download started from any other phase is either one
 * already running or one for a version nobody has been shown.
 *
 * @returns {Promise<import('./update-state.js').UpdateState>}
 */
export async function downloadUpdate() {
	if (!live || state.phase !== 'available') return updateStatus();

	set({ phase: 'downloading', version: state.version, latest: state.latest, percent: 0 });

	try {
		await autoUpdater.downloadUpdate();
	} catch (error) {
		set({
			phase: 'failed',
			version: state.version,
			latest: state.latest,
			reason: failureReason(error)
		});
	}

	return updateStatus();
}

/**
 * Quit and install what has been downloaded.
 *
 * Refused unless there is something staged, because `quitAndInstall` on an
 * empty stage is simply a quit — and an app that closes itself when a reader
 * presses "install" is the worst possible answer to that press.
 */
export function installUpdate() {
	if (!live || state.phase !== 'ready') return updateStatus();

	// Left to the next tick so the window has answered the request that asked
	// for this before the app goes away underneath it.
	setImmediate(() => autoUpdater.quitAndInstall());

	return updateStatus();
}

/**
 * Wire the updater up, and say whether this build can update itself at all.
 *
 * A build run from source has no installer behind it and no version worth
 * comparing, so it is marked `unsupported` and every route below becomes a
 * no-op. That is a state the window is told about rather than a button that
 * does nothing when pressed.
 *
 * @param {object} options
 * @param {boolean} options.isPackaged Electron's `app.isPackaged`.
 * @param {string} options.version The running app's version.
 * @param {() => void} [options.onChange] Called whenever the phase moves.
 */
export function startUpdates(options) {
	state = updateState({
		phase: options.isPackaged ? 'idle' : 'unsupported',
		version: options.version
	});

	if (!options.isPackaged) return;

	const changed = options.onChange ?? (() => {});
	/** @param {Parameters<typeof updateState>[0]} input */
	const move = (input) => {
		set(input);
		changed();
	};

	// Both off: the reader is asked before a hundred megabytes is fetched, and
	// asked again before the app replaces itself. Defaults would do neither.
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;

	autoUpdater.on('update-available', (info) =>
		move({ phase: 'available', version: options.version, latest: info.version })
	);
	autoUpdater.on('update-not-available', () =>
		move({ phase: 'current', version: options.version })
	);
	autoUpdater.on('download-progress', (progress) =>
		move({
			phase: 'downloading',
			version: options.version,
			latest: state.latest,
			percent: progress.percent
		})
	);
	autoUpdater.on('update-downloaded', (info) => {
		// Staged rather than installed: `autoInstallOnAppQuit` is off above, so
		// the update goes in when the reader presses install, and a quit on any
		// other day leaves the app exactly as it was.
		move({ phase: 'ready', version: options.version, latest: info.version });
	});
	autoUpdater.on('error', (error) =>
		move({
			phase: 'failed',
			version: options.version,
			latest: state.latest,
			reason: failureReason(error)
		})
	);

	live = true;
}
