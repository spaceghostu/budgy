/**
 * What the window is told about an update, and nothing about how it is fetched.
 *
 * The updater proper talks to GitHub, writes a hundred megabytes to disk and
 * restarts the app. None of that is testable in a spec, and all of it is easy
 * to get wrong in ways a reader only discovers when an update is actually
 * waiting. So the part that decides *what the reader is shown* lives here, as
 * strings and objects in and one object out, and `updater.js` is left holding
 * only the calls to Electron.
 *
 * The shape below is the whole conversation between the two processes. It is
 * deliberately small: a phase, a version where there is one, and a sentence
 * already written for the window to show. The renderer does no reasoning about
 * update state — it has no business knowing what a differential download is —
 * it renders what it is handed.
 */

/**
 * Where an update has got to.
 *
 * - `unsupported` — this build cannot update itself. A development run, or a
 *   package format that has no updater behind it. Said plainly rather than
 *   dressed up as "up to date", which would be a lie of a useful kind.
 * - `idle` — nothing has been asked yet.
 * - `checking` — asking GitHub.
 * - `current` — asked, and this is the newest there is.
 * - `available` — there is a newer one, and nothing has been downloaded. The
 *   reader is asked before anything is fetched.
 * - `downloading` — fetching it, with a percentage.
 * - `ready` — downloaded and staged; it goes in when the app is next quit.
 * - `failed` — the check or the download did not work, with a reason.
 *
 * @typedef {'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'failed'} UpdatePhase
 */

/**
 * @typedef {object} UpdateState
 * @property {UpdatePhase} phase
 * @property {string} version The version this app is running.
 * @property {string} latest The newer version, or `''` where there is none.
 * @property {number} percent Whole percent downloaded, `0` outside a download.
 * @property {string} message One sentence, already worded for the reader.
 */

/** The sentence shown for each phase that does not need a number in it. */
const PLAIN = Object.freeze({
	unsupported: 'This build does not update itself — it was run from source rather than installed.',
	idle: '',
	checking: 'Checking for updates…'
});

/**
 * One update state, with its sentence already written.
 *
 * Every field is given a value rather than left off, so the window never has to
 * decide what a missing one meant. A reader looking at a stale percentage from
 * the last attempt is a reader being told something untrue.
 *
 * @param {object} input
 * @param {UpdatePhase} input.phase
 * @param {string} input.version
 * @param {string} [input.latest]
 * @param {number} [input.percent]
 * @param {string} [input.reason] Why it failed, for the `failed` phase.
 * @returns {UpdateState}
 */
export function updateState(input) {
	const latest = input.latest ?? '';
	const percent = clampPercent(input.percent);

	return {
		phase: input.phase,
		version: input.version,
		latest,
		percent,
		message: describe(input.phase, {
			version: input.version,
			latest,
			percent,
			reason: input.reason ?? ''
		})
	};
}

/**
 * A percentage the window can show without checking it.
 *
 * electron-updater reports a float, and reports it from a download that can
 * stall, resume and occasionally overshoot its own total. Rounded and clamped
 * here so that a progress bar is never asked to draw 101.4%.
 *
 * @param {number | undefined} value
 */
function clampPercent(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;

	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * The one sentence for a phase.
 *
 * Written here rather than in the component for the same reason the phases are:
 * what the app says about its own updates should be one thing said in one
 * place, not a switch in the window that drifts from the states behind it.
 *
 * @param {UpdatePhase} phase
 * @param {{ version: string, latest: string, percent: number, reason: string }} data
 */
function describe(phase, data) {
	if (phase === 'current') return `Budgy ${data.version} is the latest version.`;
	if (phase === 'available') return `Budgy ${data.latest} is available — you have ${data.version}.`;
	if (phase === 'downloading') return `Downloading Budgy ${data.latest} — ${data.percent}%.`;
	if (phase === 'ready') return `Budgy ${data.latest} is ready, and installs when you quit.`;
	// The reason comes from the network or from GitHub and is not always a
	// sentence. It is still the only thing that distinguishes "you are offline"
	// from "the release is malformed", so it is shown rather than swallowed.
	if (phase === 'failed') {
		return data.reason === ''
			? 'Could not check for updates.'
			: `Could not check for updates: ${data.reason}`;
	}

	return PLAIN[/** @type {keyof typeof PLAIN} */ (phase)] ?? '';
}

/**
 * What went wrong, as a line rather than a stack.
 *
 * An updater failure arrives as anything from a DNS error to an HTML error page
 * GitHub served instead of JSON. The window gets the first line and no more:
 * enough to tell being offline from a broken release, without pasting a stack
 * trace into a card in a finance app.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function failureReason(error) {
	const raw =
		error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
	const line = raw.split('\n')[0].trim();

	return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
