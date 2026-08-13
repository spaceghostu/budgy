/**
 * Local-only persistence.
 *
 * Everything this app knows lives in the browser — no statement is ever sent
 * anywhere. Storage is still opt-in for the statement itself, because a bank
 * statement on a shared machine is worth an explicit yes.
 */

const KEYS = {
	anchors: 'budgy:anchors',
	theme: 'budgy:theme',
	files: 'budgy:files',
	apiKey: 'budgy:anthropic-key'
} as const;

export type Theme = 'light' | 'dark' | 'system';

/**
 * A balance the user typed in, plus the statement date it described.
 *
 * The date is what makes the anchor safe to reuse: next month's export ends on
 * a later date, so an anchor stamped with the old one is stale and must not be
 * silently applied to the new file.
 */
export interface Anchor {
	readonly balance: number;
	/** ISO date of the last transaction the balance was measured after. */
	readonly asOf: string;
}

/**
 * The source files, kept verbatim so reopening them costs nothing and the
 * parsers stay the single place that interprets them.
 */
export interface StoredFiles {
	readonly csv?: { readonly name: string; readonly text: string };
	/** The PDF's bytes, base64-encoded — local storage holds strings only. */
	readonly pdf?: { readonly name: string; readonly base64: string };
	/** Set on write, so a stale statement is recognisable later. */
	readonly savedAt?: string;
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		// Private browsing modes throw on access rather than returning null.
		return null;
	}
}

function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
	const store = storage();
	if (store === null) return null;

	try {
		const raw = store.getItem(key);
		if (raw === null) return null;

		const parsed: unknown = JSON.parse(raw);
		return isValid(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function writeJson(key: string, value: unknown): boolean {
	const store = storage();
	if (store === null) return false;

	try {
		store.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// Quota exceeded, or storage disabled mid-session.
		return false;
	}
}

export function clearKey(key: keyof typeof KEYS): void {
	storage()?.removeItem(KEYS[key]);
}

/** Balance anchors, keyed by account nickname. */
export function loadAnchors(): Record<string, Anchor> {
	return readJson(KEYS.anchors, isAnchorMap) ?? {};
}

export function saveAnchors(anchors: Record<string, Anchor>): void {
	writeJson(KEYS.anchors, anchors);
}

export function loadTheme(): Theme {
	const stored = readJson(KEYS.theme, isTheme);
	return stored ?? 'system';
}

export function saveTheme(theme: Theme): void {
	writeJson(KEYS.theme, theme);
}

export function loadFiles(): StoredFiles {
	return readJson(KEYS.files, isStoredFiles) ?? {};
}

/**
 * @returns false when the browser refused to store them. A certified statement
 * runs to hundreds of kilobytes, and base64 makes it a third larger again, so
 * hitting the quota is a real outcome rather than a theoretical one.
 */
export function saveFiles(files: StoredFiles): boolean {
	const present = files.csv === undefined && files.pdf === undefined;
	if (present) {
		clearKey('files');
		return true;
	}

	return writeJson(KEYS.files, { ...files, savedAt: new Date().toISOString() });
}

/**
 * The reader's own Anthropic key, when they asked for it to be kept.
 *
 * Storing a credential is a bigger ask than storing a statement, so nothing
 * calls this unless the reader ticked the box: without it the key lives in the
 * page for the session and is gone on reload. Local storage is readable by any
 * script on this origin — this page loads none — and by anyone at this browser,
 * which is why it stays opt-in and revocable from the same control.
 */
export function loadApiKey(): string {
	return readJson(KEYS.apiKey, isString) ?? '';
}

/** @param key A blank key clears the stored one rather than storing nothing. */
export function saveApiKey(key: string): void {
	if (key.trim() === '') {
		clearKey('apiKey');
		return;
	}

	writeJson(KEYS.apiKey, key);
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isAnchorMap(value: unknown): value is Record<string, Anchor> {
	return typeof value === 'object' && value !== null && Object.values(value).every(isAnchor);
}

function isAnchor(value: unknown): value is Anchor {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.balance === 'number' &&
		Number.isFinite(candidate.balance) &&
		typeof candidate.asOf === 'string'
	);
}

function isTheme(value: unknown): value is Theme {
	return value === 'light' || value === 'dark' || value === 'system';
}

function isStoredFiles(value: unknown): value is StoredFiles {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		hasStringFields(candidate.csv, ['name', 'text']) &&
		hasStringFields(candidate.pdf, ['name', 'base64'])
	);
}

/** Absent is fine; present but the wrong shape is not. */
function hasStringFields(value: unknown, fields: readonly string[]): boolean {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return fields.every((field) => typeof candidate[field] === 'string');
}
