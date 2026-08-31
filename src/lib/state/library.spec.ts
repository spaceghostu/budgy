import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearLibrary,
	deleteEntry,
	entryLabel,
	libraryAvailable,
	listEntries,
	readPayload,
	writeEntry,
	type StatementEntry,
	type StatementPayload
} from './library.ts';

function entry(id: string, uploadedAt: string, from = '2026-05-01', to = '2026-08-09') {
	return {
		id,
		uploadedAt,
		updatedAt: uploadedAt,
		pdfName: 'statement.pdf',
		csvName: 'export.csv',
		summary: { from, to, accounts: ['Cheque account'], transactionCount: 4 }
	} satisfies StatementEntry;
}

function payload(id: string, text = 'a,b\n1,2'): StatementPayload {
	return {
		id,
		pdf: { name: 'statement.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
		csv: { name: 'export.csv', text }
	};
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

describe('the statement library', () => {
	it('starts empty', async () => {
		await expect(listEntries()).resolves.toEqual([]);
	});

	it('round-trips a statement and its files', async () => {
		expect(await writeEntry(entry('a', '2026-08-14T10:00:00.000Z'), payload('a'))).toBe(true);

		const stored = await readPayload('a');
		expect(stored?.csv).toEqual({ name: 'export.csv', text: 'a,b\n1,2' });
		expect(stored?.pdf?.bytes).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
	});

	it('keeps many statements side by side', async () => {
		await writeEntry(entry('a', '2026-06-01T00:00:00.000Z'), payload('a', 'june'));
		await writeEntry(entry('b', '2026-07-01T00:00:00.000Z'), payload('b', 'july'));
		await writeEntry(entry('c', '2026-08-01T00:00:00.000Z'), payload('c', 'august'));

		expect((await listEntries()).map((saved) => saved.id)).toEqual(['c', 'b', 'a']);
		expect((await readPayload('a'))?.csv?.text).toBe('june');
	});

	it('replaces a statement written again under the same id', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a', 'first'));
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a', 'second'));

		expect(await listEntries()).toHaveLength(1);
		expect((await readPayload('a'))?.csv?.text).toBe('second');
	});

	it('lists what a statement covers without reading its files', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a'));

		expect((await listEntries())[0]?.summary.transactionCount).toBe(4);
	});

	it('has nothing to say about a statement it never kept', async () => {
		await expect(readPayload('missing')).resolves.toBeNull();
	});

	it('takes a statement out, files and all', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a'));
		await writeEntry(entry('b', '2026-08-02T00:00:00.000Z'), payload('b'));

		expect(await deleteEntry('a')).toBe(true);

		expect((await listEntries()).map((saved) => saved.id)).toEqual(['b']);
		await expect(readPayload('a')).resolves.toBeNull();
	});

	it('empties itself on request', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a'));
		await writeEntry(entry('b', '2026-08-02T00:00:00.000Z'), payload('b'));

		expect(await clearLibrary()).toBe(true);

		await expect(listEntries()).resolves.toEqual([]);
		await expect(readPayload('b')).resolves.toBeNull();
	});

	it('keeps a statement that has only one of the two files', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), {
			id: 'a',
			csv: { name: 'export.csv', text: 'only' }
		});

		const stored = await readPayload('a');
		expect(stored?.pdf).toBeUndefined();
		expect(stored?.csv?.text).toBe('only');
	});

	it('ignores a record of the wrong shape rather than crashing the list', async () => {
		await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a'));
		await writeEntry({ id: 'broken' } as unknown as StatementEntry, payload('broken'));

		expect((await listEntries()).map((saved) => saved.id)).toEqual(['a']);
	});

	it('reports a browser with no IndexedDB rather than throwing', async () => {
		vi.stubGlobal('indexedDB', undefined);

		expect(libraryAvailable()).toBe(false);
		await expect(listEntries()).resolves.toEqual([]);
		await expect(readPayload('a')).resolves.toBeNull();
		expect(await writeEntry(entry('a', '2026-08-01T00:00:00.000Z'), payload('a'))).toBe(false);
		expect(await deleteEntry('a')).toBe(false);
		expect(await clearLibrary()).toBe(false);
	});
});

describe('naming a saved statement', () => {
	it('reads as the period it covers', () => {
		expect(entryLabel(entry('a', '2026-08-01T00:00:00.000Z'))).toBe('2026-05-01 → 2026-08-09');
	});

	it('states a single day once', () => {
		expect(entryLabel(entry('a', '2026-08-01T00:00:00.000Z', '2026-08-09', '2026-08-09'))).toBe(
			'2026-08-09'
		);
	});

	it('falls back to the file name when there was no period to cover', () => {
		expect(entryLabel(entry('a', '2026-08-01T00:00:00.000Z', '', ''))).toBe('statement.pdf');
	});
});
