import {
	afterNewest,
	clearLibrary,
	deleteEntry,
	listEntries,
	readPayload,
	timestamp,
	writeEntry,
	type StatementEntry,
	type StatementPayload,
	type StatementSummary
} from './library.ts';
import { loadActiveId, loadKeepUploads, saveActiveId, saveKeepUploads } from './persistence.ts';

export { entryLabel } from './library.ts';
export type { StatementEntry, StatementPayload, StatementSummary } from './library.ts';

/** What a save needs to know about the files it is filing. */
export interface SaveInput {
	readonly pdf?: { readonly name: string; readonly bytes: Uint8Array };
	readonly csv?: { readonly name: string; readonly text: string };
	readonly summary: StatementSummary;
}

/**
 * The history, as the page sees it.
 *
 * A thin reactive layer over `library.ts`: that module talks to IndexedDB and
 * knows nothing about the screen, this one holds the list the screen draws and
 * which statement is open. Reads are async and the list is a rune, so a page
 * renders what it has and fills in when the store answers.
 */
export class StatementLibrary {
	/** Every saved statement, newest first. Empty until {@link refresh}. */
	entries = $state<readonly StatementEntry[]>([]);
	/** The saved statement currently on screen, blank when none is. */
	activeId = $state('');
	keepUploads = $state(true);
	/** Set when this browser refused to keep something, so the page can say so. */
	error = $state<string | null>(null);
	/** True until the first listing lands, so an empty list is not shown as fact. */
	loading = $state(true);

	readonly count = $derived(this.entries.length);

	constructor() {
		this.keepUploads = loadKeepUploads();
		this.activeId = loadActiveId();
	}

	async refresh(): Promise<void> {
		this.entries = await listEntries();
		this.loading = false;
	}

	/**
	 * File the open statement, replacing whatever was saved under it before.
	 *
	 * The upload time is the entry's first, not this write's: adding the CSV
	 * beside a PDF an hour later is the same statement being completed, and the
	 * history is ordered by when a statement arrived.
	 *
	 * @param id The entry to write. A new id files a new statement.
	 */
	async save(id: string, input: SaveInput): Promise<void> {
		if (!this.keepUploads) return;

		const now = timestamp();
		const existing = this.entries.find((entry) => entry.id === id);

		// `entries` is newest first, so its head is what a new stamp must clear.
		const entry: StatementEntry = {
			id,
			uploadedAt: existing?.uploadedAt ?? afterNewest(now, this.entries[0]?.uploadedAt),
			updatedAt: now,
			pdfName: input.pdf?.name ?? '',
			csvName: input.csv?.name ?? '',
			summary: input.summary
		};

		const payload: StatementPayload = { id, pdf: input.pdf, csv: input.csv };

		if (await writeEntry(entry, payload)) {
			this.error = null;
			await this.refresh();
			return;
		}

		this.error =
			'This browser would not keep that statement — it stays in this tab until you reload.';
	}

	/** The files of a saved statement, or null once this browser has lost them. */
	async open(id: string): Promise<StatementPayload | null> {
		const payload = await readPayload(id);
		if (payload === null) {
			this.error = 'That statement is no longer in this browser.';
			return null;
		}

		this.error = null;
		this.setActive(id);
		return payload;
	}

	async remove(id: string): Promise<void> {
		await deleteEntry(id);
		if (this.activeId === id) this.setActive('');

		await this.refresh();
	}

	async clearAll(): Promise<void> {
		await clearLibrary();
		this.setActive('');
		await this.refresh();
	}

	setActive(id: string): void {
		this.activeId = id;
		saveActiveId(id);
	}

	/**
	 * Turn keeping uploads on or off.
	 *
	 * Turning it off throws away what is already kept rather than merely
	 * stopping the next save: a reader who says stop keeping my statements has
	 * not asked for the ones already on disk to stay there.
	 */
	async setKeepUploads(keep: boolean): Promise<void> {
		this.keepUploads = keep;
		saveKeepUploads(keep);

		if (!keep) await this.clearAll();
	}
}
