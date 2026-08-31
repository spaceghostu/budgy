/**
 * Asking the desktop shell about updates, from inside the window.
 *
 * The same bundle runs in a browser tab and in the desktop app, and only one of
 * those has a shell to ask. So everything here is written to be *absent* rather
 * than broken on the web: {@link isDesktop} is false there, the card is never
 * rendered, and no request is ever made. A reader on the web is not shown a
 * button that cannot work.
 *
 * The shell is reached by an ordinary same-origin `fetch` of a reserved path —
 * there is no preload, nothing injected on `window`, and no IPC. See
 * `electron/protocol.js`. That means this module has no Electron types, no
 * globals to feature-detect and nothing that would fail to compile for the web
 * build; it is a fetch client for a small local API that happens to be answered
 * by the process hosting the window.
 */

/** Where an update has got to. Mirrors `electron/update-state.js`. */
export type UpdatePhase =
	| 'unsupported'
	| 'idle'
	| 'checking'
	| 'current'
	| 'available'
	| 'downloading'
	| 'ready'
	| 'failed';

export interface UpdateState {
	readonly phase: UpdatePhase;
	/** The version this app is running. */
	readonly version: string;
	/** The newer version, or `''` where there is none. */
	readonly latest: string;
	/** Whole percent downloaded, `0` outside a download. */
	readonly percent: number;
	/** One sentence, already worded by the shell for the reader. */
	readonly message: string;
}

/** The origin the desktop shell serves the bundle on. */
const DESKTOP_ORIGIN = 'app://budgy';

/** The reserved prefix the shell answers on, rather than a page of the app. */
const SHELL = '/-/update';

/**
 * Whether this window is the desktop app rather than a browser tab.
 *
 * Read from the origin, which the shell owns and a page cannot change, rather
 * than by sniffing a user agent — Electron's contains `Chrome`, and a check on
 * that would call every browser a desktop app.
 *
 * Guarded for the server, because these pages are prerendered: at build time
 * there is no `location` at all, and a module that read one would take the
 * whole build down.
 */
export function isDesktop(): boolean {
	return typeof location !== 'undefined' && location.origin === DESKTOP_ORIGIN;
}

/** The state to show where there is no shell to ask — and nothing to ask it. */
const ABSENT: UpdateState = {
	phase: 'unsupported',
	version: '',
	latest: '',
	percent: 0,
	message: ''
};

/**
 * One state from the shell, or a failure worded for the card.
 *
 * Every call goes through here so that a shell that answers with something
 * unexpected — a 404 from an older build, HTML from a route that fell through —
 * becomes a `failed` phase rather than an exception in a component. A finance
 * app should not show a stack trace because a version check went wrong.
 */
async function ask(path: string, method: 'GET' | 'POST'): Promise<UpdateState> {
	if (!isDesktop()) return ABSENT;

	try {
		const response = await fetch(`${SHELL}${path}`, { method });
		if (!response.ok) {
			return {
				...ABSENT,
				phase: 'failed',
				message: `The app could not be asked (${response.status}).`
			};
		}

		return parseState(await response.json());
	} catch (error) {
		return {
			...ABSENT,
			phase: 'failed',
			message: error instanceof Error ? error.message : 'The app could not be asked.'
		};
	}
}

/**
 * A reply read as a state, with every field checked.
 *
 * The shell is the only thing that can answer this origin, so this is not a
 * trust boundary in the way an API response is — but it is a *version*
 * boundary: an installed app that has updated its shell and not its bundle, or
 * the other way about, is exactly the situation an updater creates. A reply
 * missing a field it once had should degrade to a sentence, not to `undefined`
 * rendered into the card.
 */
function parseState(value: unknown): UpdateState {
	if (typeof value !== 'object' || value === null) {
		return {
			...ABSENT,
			phase: 'failed',
			message: 'The app gave an answer that could not be read.'
		};
	}

	const reply = value as Record<string, unknown>;
	const phase = reply.phase;

	if (typeof phase !== 'string' || !isPhase(phase)) {
		return {
			...ABSENT,
			phase: 'failed',
			message: 'The app gave an answer that could not be read.'
		};
	}

	return {
		phase,
		version: typeof reply.version === 'string' ? reply.version : '',
		latest: typeof reply.latest === 'string' ? reply.latest : '',
		percent:
			typeof reply.percent === 'number' && Number.isFinite(reply.percent) ? reply.percent : 0,
		message: typeof reply.message === 'string' ? reply.message : ''
	};
}

const PHASES: readonly string[] = [
	'unsupported',
	'idle',
	'checking',
	'current',
	'available',
	'downloading',
	'ready',
	'failed'
];

function isPhase(value: string): value is UpdatePhase {
	return PHASES.includes(value);
}

/**
 * Whether a phase is one the shell is still moving through.
 *
 * The two transient phases are the ones nothing in the window can resolve: the
 * shell is mid-request, and the state it settles on arrives without the window
 * asking again. Anything reading a state on a timer has to know which those
 * are, or it stops re-reading and shows a step of the process as if it were the
 * result — a card that says "Checking…" forever because the answer landed a
 * moment after it last looked.
 *
 * `idle` is deliberately not one of them: it means nothing has been asked, so
 * there is nothing on its way and nothing to wait for.
 */
export function isSettling(phase: UpdatePhase): boolean {
	return phase === 'checking' || phase === 'downloading';
}

/** What the shell says right now, without asking it to do anything. */
export function updateStatus(): Promise<UpdateState> {
	return ask('/status', 'GET');
}

/** Ask GitHub whether there is a newer release. */
export function checkForUpdates(): Promise<UpdateState> {
	return ask('/check', 'POST');
}

/** Fetch the update — only after the reader has been shown that there is one. */
export function downloadUpdate(): Promise<UpdateState> {
	return ask('/download', 'POST');
}

/** Quit and install what has been downloaded. */
export function installUpdate(): Promise<UpdateState> {
	return ask('/install', 'POST');
}
