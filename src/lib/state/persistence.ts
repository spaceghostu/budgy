/**
 * Local-only persistence.
 *
 * Everything this app knows lives in the browser — no statement is ever sent
 * anywhere. Storage is still opt-in for the statement itself, because a bank
 * statement on a shared machine is worth an explicit yes.
 */

import type { AddedCharge } from '../stats/forecast.ts';
import { readMonthStart } from '../stats/cycle.ts';

const KEYS = {
	anchors: 'budgy:anchors',
	theme: 'budgy:theme',
	monthStart: 'budgy:month-start',
	files: 'budgy:files',
	active: 'budgy:active',
	keepUploads: 'budgy:keep-uploads',
	apiKey: 'budgy:anthropic-key',
	categories: 'budgy:subcategories',
	ownCategories: 'budgy:own-categories',
	recentCategories: 'budgy:recent-categories',
	droppedCharges: 'budgy:dropped-charges',
	addedCharges: 'budgy:added-charges',
	bankAccounts: 'budgy:discovery-accounts'
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
 * The source files of the one statement older versions could keep.
 *
 * Superseded by the library in `library.ts`, which holds many. Kept only so a
 * statement remembered under the old scheme can be read once and filed into it;
 * nothing writes this any more.
 *
 * @deprecated Read for migration only.
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

/**
 * The day of the month the reader's months open on.
 *
 * Read through {@link readMonthStart} rather than trusted: local storage is
 * editable, and a start day nothing can be cut on would break every month-shaped
 * figure in the app rather than one setting.
 */
export function loadMonthStart(): number {
	return readMonthStart(readJson(KEYS.monthStart, isNumber));
}

export function saveMonthStart(day: number): void {
	writeJson(KEYS.monthStart, readMonthStart(day));
}

export function loadTheme(): Theme {
	const stored = readJson(KEYS.theme, isTheme);
	return stored ?? 'system';
}

export function saveTheme(theme: Theme): void {
	writeJson(KEYS.theme, theme);
}

/**
 * The statement an older version of the app was keeping, if any.
 *
 * @deprecated Read once on startup and filed into the library, then cleared.
 */
export function loadFiles(): StoredFiles {
	return readJson(KEYS.files, isStoredFiles) ?? {};
}

/**
 * Which saved statement was last open, so a reload comes back to it.
 *
 * Kept beside the library rather than in it: it describes this browser's place
 * in the history, not the history itself, and it is one short string.
 */
export function loadActiveId(): string {
	return readJson(KEYS.active, isString) ?? '';
}

export function saveActiveId(id: string): void {
	if (id === '') {
		clearKey('active');
		return;
	}

	writeJson(KEYS.active, id);
}

/**
 * Whether uploads are kept on this device. On unless turned off.
 *
 * The default is the other way round from where this app started. Keeping one
 * statement was a convenience worth asking about; a history is the feature —
 * uploading a file only to lose it on reload would make the record it builds
 * impossible. So it is stated plainly, and revocable from the same control,
 * which also clears what has already been kept.
 */
export function loadKeepUploads(): boolean {
	return readJson(KEYS.keepUploads, isBoolean) ?? true;
}

export function saveKeepUploads(keep: boolean): void {
	writeJson(KEYS.keepUploads, keep);
}

/**
 * The categories the reader chose for merchants the bank left unfiled, keyed by
 * merchant.
 *
 * The key predates the app settling on the bank's finer label as its category;
 * the values it holds are those labels either way, so it is left alone rather
 * than renamed into a key that once held something else.
 *
 *
 * Kept without asking, unlike the statement itself: a merchant name and a
 * category are the reader's own labelling rather than their bank's record, and
 * the work of filing a month's stray rows is worth carrying into next month's
 * export. Clearing the files leaves these behind, and each is removable from
 * the card that set it.
 */
export function loadCategoryRules(): Record<string, string> {
	return readJson(KEYS.categories, isCategoryRules) ?? {};
}

export function saveCategoryRules(rules: Record<string, string>): void {
	if (Object.keys(rules).length === 0) {
		clearKey('categories');
		return;
	}

	writeJson(KEYS.categories, rules);
}

/**
 * Categories the reader named themselves.
 *
 * Kept in their own right rather than inferred from the rules that use them: a
 * category invented for one merchant and then re-filed elsewhere would otherwise
 * vanish from the list it was added to, and have to be typed again. Naming one
 * is the expensive act; using it should not be what keeps it alive.
 */
export function loadOwnCategories(): readonly string[] {
	return readJson(KEYS.ownCategories, isStringArray) ?? [];
}

export function saveOwnCategories(categories: readonly string[]): void {
	if (categories.length === 0) {
		clearKey('ownCategories');
		return;
	}

	writeJson(KEYS.ownCategories, categories);
}

/** How many categories the picker offers before the full list — a shortlist. */
export const MAX_RECENT_CATEGORIES = 6;

/**
 * The categories last chosen, most recent first.
 *
 * Filing a month's stray rows means reaching for the same handful of categories
 * over and over, which an alphabetical list of sixty makes needlessly slow. This
 * is the shortlist that goes above it.
 */
export function loadRecentCategories(): readonly string[] {
	return readJson(KEYS.recentCategories, isStringArray) ?? [];
}

export function saveRecentCategories(categories: readonly string[]): void {
	if (categories.length === 0) {
		clearKey('recentCategories');
		return;
	}

	writeJson(KEYS.recentCategories, categories);
}

/**
 * Charges the reader has told the forecast are not coming.
 *
 * Kept, rather than reset on every visit, because the fact behind the tick
 * outlives the page: a gym membership cancelled this morning is still cancelled
 * next month, and next month's export will arrive with the same history saying
 * it bills on the 20th. It is a short-lived override either way — a charge that
 * really has stopped drops out of the forecast on its own once it has missed
 * two months, and one that comes back arrives as a real transaction.
 *
 * Keyed by {@link ExpectedPayment.key}, so a merchant that both charges and
 * pays can have one side dropped without the other.
 */
export function loadDroppedCharges(): readonly string[] {
	return readJson(KEYS.droppedCharges, isStringArray) ?? [];
}

export function saveDroppedCharges(keys: readonly string[]): void {
	if (keys.length === 0) {
		clearKey('droppedCharges');
		return;
	}

	writeJson(KEYS.droppedCharges, keys);
}

/**
 * Charges the reader added to the forecast themselves.
 *
 * The recurring test is deliberately conservative, so a quarterly premium or a
 * loan that moves about never qualifies — and a bill paid from another account
 * is not in these files at all. Both are the reader's to add, and neither
 * should have to be added again next month.
 *
 * See {@link AddedCharge} for the two kinds and what each one keeps.
 */
export function loadAddedCharges(): readonly AddedCharge[] {
	return readJson(KEYS.addedCharges, isAddedCharges) ?? [];
}

export function saveAddedCharges(charges: readonly AddedCharge[]): void {
	if (charges.length === 0) {
		clearKey('addedCharges');
		return;
	}

	writeJson(KEYS.addedCharges, charges);
}

/**
 * The shortlist with `category` at its head.
 *
 * Compared case-insensitively so re-picking a category cannot leave two
 * spellings of it on the list, and capped, since a shortlist that grows to the
 * length of the full one has stopped being a shortcut.
 */
export function withRecentCategory(recent: readonly string[], category: string): readonly string[] {
	const key = category.trim().toLowerCase();
	if (key === '') return recent;

	const rest = recent.filter((entry) => entry.trim().toLowerCase() !== key);
	return [category, ...rest].slice(0, MAX_RECENT_CATEGORIES);
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

/**
 * Discovery's own account ids, as the reader pasted them.
 *
 * The bank identifies accounts by opaque handles that appear nowhere in a
 * statement it issues — not on the PDF's cover page, not in the CSV's account
 * column — so the app has no way to work them out and the reader has to supply
 * them once. Kept here so that is genuinely once, rather than every five-minute
 * token.
 *
 * They are not a credential: on their own they open nothing, and every request
 * carrying them still needs the reader's live session token. They are still
 * personal — they name somebody's accounts — which is why they live in this
 * browser and are never written into the app's own source.
 */
export function loadBankAccounts(): readonly string[] {
	return readJson(KEYS.bankAccounts, isStringArray) ?? [];
}

/** @param accounts An empty list clears the stored one rather than storing nothing. */
export function saveBankAccounts(accounts: readonly string[]): void {
	if (accounts.length === 0) {
		clearKey('bankAccounts');
		return;
	}

	writeJson(KEYS.bankAccounts, accounts);
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every(isString);
}

/**
 * Read back a stored charge, or refuse it.
 *
 * Checked field by field rather than trusted, like every other stored value:
 * this one reaches arithmetic, and a `NaN` amount off a hand-edited key would
 * turn the whole projection into a blank rather than a wrong number.
 */
function isAddedCharges(value: unknown): value is readonly AddedCharge[] {
	return Array.isArray(value) && value.every(isAddedCharge);
}

function isAddedCharge(value: unknown): value is AddedCharge {
	if (typeof value !== 'object' || value === null) return false;

	const charge = value as Record<string, unknown>;
	if (charge.flow !== 'income' && charge.flow !== 'expense') return false;

	if (charge.kind === 'merchant') return isString(charge.merchant) && charge.merchant !== '';

	return (
		charge.kind === 'custom' &&
		isString(charge.id) &&
		isString(charge.name) &&
		isString(charge.category) &&
		isNumber(charge.amount) &&
		Number.isFinite(charge.amount) &&
		isNumber(charge.day) &&
		Number.isInteger(charge.day)
	);
}

function isCategoryRules(value: unknown): value is Record<string, string> {
	return typeof value === 'object' && value !== null && Object.values(value).every(isString);
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

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
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
