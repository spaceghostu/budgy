/**
 * The statement library — every upload, kept.
 *
 * One file replacing the last is no way to read a year of money, so an upload
 * is filed rather than swapped in: each entry holds the files that describe one
 * period, and the history is the list of them.
 *
 * Local storage cannot carry that. A certified PDF runs to hundreds of
 * kilobytes and base64 makes it a third larger again, which is why keeping even
 * one statement there could hit the quota. IndexedDB takes bytes as bytes and
 * has room for many, so the library lives here instead.
 *
 * Two stores rather than one: the history list is drawn from {@link ENTRIES},
 * which holds dates and names and nothing heavy, so opening the page does not
 * pull every megabyte of every statement off disk to render a list.
 *
 * Nothing here leaves the device.
 */

const DB_NAME = 'budgy';
const DB_VERSION = 1;

/** Light records — what the history list is drawn from. */
const ENTRIES = 'entries';
/** The files themselves, read only when a statement is actually opened. */
const PAYLOADS = 'payloads';

/** What a saved statement covers, worked out once and kept for the list. */
export interface StatementSummary {
	/** ISO date of the earliest transaction, or blank if there were none. */
	readonly from: string;
	readonly to: string;
	readonly accounts: readonly string[];
	readonly transactionCount: number;
}

/**
 * One saved upload.
 *
 * An entry is the *pair*, not the file: a certified PDF and a Smart Search CSV
 * describing the same money belong to one statement, and adding the second to a
 * statement already open updates this record rather than starting another.
 */
export interface StatementEntry {
	readonly id: string;
	/** ISO timestamp of when this statement was first uploaded. */
	readonly uploadedAt: string;
	/** ISO timestamp of the last file added to it. */
	readonly updatedAt: string;
	/** Blank when this statement has no file of that kind. */
	readonly pdfName: string;
	readonly csvName: string;
	readonly summary: StatementSummary;
}

/** The files themselves, kept verbatim so the parsers stay the only readers. */
export interface StatementPayload {
	readonly id: string;
	readonly pdf?: { readonly name: string; readonly bytes: Uint8Array };
	readonly csv?: { readonly name: string; readonly text: string };
}

/**
 * True when this browser will hold a library at all.
 *
 * Private modes and locked-down settings can take IndexedDB away, and the
 * answer to that is a page that still works on what is in memory — so every
 * call below reports failure rather than throwing.
 */
export function libraryAvailable(): boolean {
	try {
		return typeof indexedDB !== 'undefined';
	} catch {
		return false;
	}
}

function open(): Promise<IDBDatabase | null> {
	if (!libraryAvailable()) return Promise.resolve(null);

	return new Promise((resolve) => {
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(PAYLOADS))
				db.createObjectStore(PAYLOADS, { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		// A second tab holding an old version open would otherwise hang forever.
		request.onblocked = () => resolve(null);
	});
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

/** Resolves once the writes are durable, so a reload cannot race them. */
function committed(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
		transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
	});
}

/** Every saved statement, newest upload first. */
export async function listEntries(): Promise<readonly StatementEntry[]> {
	const db = await open();
	if (db === null) return [];

	try {
		const store = db.transaction(ENTRIES, 'readonly').objectStore(ENTRIES);
		const all = await settle(store.getAll() as IDBRequest<StatementEntry[]>);

		return all
			.filter(isEntry)
			.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
	} catch {
		return [];
	} finally {
		db.close();
	}
}

/** The files for one statement, or null if this browser has lost them. */
export async function readPayload(id: string): Promise<StatementPayload | null> {
	const db = await open();
	if (db === null) return null;

	try {
		const store = db.transaction(PAYLOADS, 'readonly').objectStore(PAYLOADS);
		const payload: unknown = await settle(store.get(id) as IDBRequest<unknown>);
		return isPayload(payload) ? payload : null;
	} catch {
		return null;
	} finally {
		db.close();
	}
}

/**
 * File a statement, replacing any earlier version of the same entry.
 *
 * Both stores are written in one transaction: a listing that names a statement
 * whose files never landed would offer the reader something that cannot open.
 *
 * @returns false when the browser refused — a full disk or a denied quota,
 * which the caller should say out loud rather than pass off as saved.
 */
export async function writeEntry(
	entry: StatementEntry,
	payload: StatementPayload
): Promise<boolean> {
	const db = await open();
	if (db === null) return false;

	try {
		const transaction = db.transaction([ENTRIES, PAYLOADS], 'readwrite');
		transaction.objectStore(ENTRIES).put(entry);
		transaction.objectStore(PAYLOADS).put(payload);

		await committed(transaction);
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}

export async function deleteEntry(id: string): Promise<boolean> {
	const db = await open();
	if (db === null) return false;

	try {
		const transaction = db.transaction([ENTRIES, PAYLOADS], 'readwrite');
		transaction.objectStore(ENTRIES).delete(id);
		transaction.objectStore(PAYLOADS).delete(id);

		await committed(transaction);
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}

/** Forget every statement this browser has kept. */
export async function clearLibrary(): Promise<boolean> {
	const db = await open();
	if (db === null) return false;

	try {
		const transaction = db.transaction([ENTRIES, PAYLOADS], 'readwrite');
		transaction.objectStore(ENTRIES).clear();
		transaction.objectStore(PAYLOADS).clear();

		await committed(transaction);
		return true;
	} catch {
		return false;
	} finally {
		db.close();
	}
}

/**
 * The clock, read here so the reactive layer above holds no Date of its own.
 */
export function timestamp(): string {
	return new Date().toISOString();
}

/**
 * `moment`, nudged past `newest` when the clock has not moved between them.
 *
 * Two statements filed in the same millisecond still went in one after the
 * other, and a list ordered by a timestamp that cannot tell them apart falls
 * back to an arbitrary order.
 *
 * @param newest The newest entry's stamp, or undefined for an empty history.
 */
export function afterNewest(moment: string, newest: string | undefined): string {
	if (newest === undefined || moment > newest) return moment;

	return new Date(Date.parse(newest) + 1).toISOString();
}

/**
 * A label for a statement in the history list.
 *
 * The period it covers is what tells one upload from another — file names are
 * whatever the bank generated, and two months of exports look identical.
 */
export function entryLabel(entry: StatementEntry): string {
	const { from, to } = entry.summary;
	if (from === '' || to === '') return entry.pdfName || entry.csvName || 'Empty statement';

	return from === to ? from : `${from} → ${to}`;
}

function isEntry(value: unknown): value is StatementEntry {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.uploadedAt === 'string' &&
		typeof candidate.updatedAt === 'string' &&
		typeof candidate.pdfName === 'string' &&
		typeof candidate.csvName === 'string' &&
		isSummary(candidate.summary)
	);
}

function isSummary(value: unknown): value is StatementSummary {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.from === 'string' &&
		typeof candidate.to === 'string' &&
		typeof candidate.transactionCount === 'number' &&
		Array.isArray(candidate.accounts) &&
		candidate.accounts.every((account) => typeof account === 'string')
	);
}

function isPayload(value: unknown): value is StatementPayload {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	if (typeof candidate.id !== 'string') return false;

	return isPdfPart(candidate.pdf) && isCsvPart(candidate.csv);
}

/** Absent is fine — a statement can be a CSV alone; the wrong shape is not. */
function isPdfPart(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return typeof candidate.name === 'string' && candidate.bytes instanceof Uint8Array;
}

function isCsvPart(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return typeof candidate.name === 'string' && typeof candidate.text === 'string';
}
