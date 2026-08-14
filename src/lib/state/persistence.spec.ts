import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearKey,
	loadAnchors,
	loadApiKey,
	loadCategoryRules,
	loadFiles,
	loadTheme,
	saveAnchors,
	saveApiKey,
	saveCategoryRules,
	saveFiles,
	saveTheme
} from './persistence.ts';

/** A minimal in-memory stand-in, so the tests never touch a real browser store. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
	const entries = new Map<string, string>();

	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear(),
		...overrides
	};
}

function install(storage: Storage | undefined): void {
	vi.stubGlobal('localStorage', storage);
}

beforeEach(() => install(fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('anchors', () => {
	it('round-trips a balance and the statement date it described', () => {
		saveAnchors({ 'Cheque account': { balance: 4820.55, asOf: '2026-08-09' } });

		expect(loadAnchors()).toEqual({
			'Cheque account': { balance: 4820.55, asOf: '2026-08-09' }
		});
	});

	it('starts empty', () => {
		expect(loadAnchors()).toEqual({});
	});

	it('ignores a stored value of the wrong shape rather than crashing', () => {
		localStorage.setItem('budgy:anchors', JSON.stringify({ 'Cheque account': 'lots' }));

		expect(loadAnchors()).toEqual({});
	});

	it('ignores an anchor from an older format that carried no date', () => {
		localStorage.setItem('budgy:anchors', JSON.stringify({ 'Cheque account': 4820.55 }));

		expect(loadAnchors()).toEqual({});
	});

	it('ignores unparseable JSON', () => {
		localStorage.setItem('budgy:anchors', '{not json');

		expect(loadAnchors()).toEqual({});
	});
});

describe('theme', () => {
	it('defaults to following the system', () => {
		expect(loadTheme()).toBe('system');
	});

	it('round-trips a choice', () => {
		saveTheme('dark');

		expect(loadTheme()).toBe('dark');
	});

	it('rejects a value that is not a theme', () => {
		localStorage.setItem('budgy:theme', JSON.stringify('neon'));

		expect(loadTheme()).toBe('system');
	});
});

describe('files', () => {
	it('starts with nothing kept', () => {
		expect(loadFiles()).toEqual({});
	});

	it('round-trips a CSV and stamps when it was saved', () => {
		expect(saveFiles({ csv: { name: 'export.csv', text: 'a,b\n1,2' } })).toBe(true);

		const stored = loadFiles();
		expect(stored.csv).toEqual({ name: 'export.csv', text: 'a,b\n1,2' });
		expect(stored.savedAt).toBeTypeOf('string');
	});

	it('round-trips a PDF alongside it', () => {
		saveFiles({
			csv: { name: 'export.csv', text: 'a' },
			pdf: { name: 'statement.pdf', base64: 'JVBERi0=' }
		});

		expect(loadFiles().pdf).toEqual({ name: 'statement.pdf', base64: 'JVBERi0=' });
	});

	it('clears the key rather than storing an empty set', () => {
		saveFiles({ csv: { name: 'export.csv', text: 'a' } });

		expect(saveFiles({})).toBe(true);
		expect(localStorage.getItem('budgy:files')).toBeNull();
	});

	it('reports failure when the browser refuses, as a large PDF may make it', () => {
		install(
			fakeStorage({
				setItem: () => {
					throw new DOMException('QuotaExceededError');
				}
			})
		);

		expect(saveFiles({ csv: { name: 'export.csv', text: 'a' } })).toBe(false);
	});

	it('forgets the files on request', () => {
		saveFiles({ csv: { name: 'export.csv', text: 'a' } });
		clearKey('files');

		expect(loadFiles()).toEqual({});
	});

	it('rejects a stored value missing its fields', () => {
		localStorage.setItem('budgy:files', JSON.stringify({ csv: { name: 'x' } }));

		expect(loadFiles()).toEqual({});
	});
});

describe('api key', () => {
	it('starts with none, so nothing can be sent by default', () => {
		expect(loadApiKey()).toBe('');
	});

	it('round-trips a key the reader asked to keep', () => {
		saveApiKey('sk-ant-example');

		expect(loadApiKey()).toBe('sk-ant-example');
	});

	it('forgets the key when it is blanked', () => {
		saveApiKey('sk-ant-example');
		saveApiKey('   ');

		expect(loadApiKey()).toBe('');
		expect(localStorage.getItem('budgy:anthropic-key')).toBeNull();
	});

	it('forgets the key on request', () => {
		saveApiKey('sk-ant-example');
		clearKey('apiKey');

		expect(loadApiKey()).toBe('');
	});

	it('ignores a stored value that is not a string', () => {
		localStorage.setItem('budgy:anthropic-key', JSON.stringify({ key: 'sk-ant' }));

		expect(loadApiKey()).toBe('');
	});
});

describe('category rules', () => {
	it('starts with none, so the bank’s own filing stands alone', () => {
		expect(loadCategoryRules()).toEqual({});
	});

	it('round-trips a category the reader chose for a merchant', () => {
		saveCategoryRules({ 'CORNER SHOP': 'Groceries' });

		expect(loadCategoryRules()).toEqual({ 'CORNER SHOP': 'Groceries' });
	});

	it('clears the key rather than storing an empty set', () => {
		saveCategoryRules({ 'CORNER SHOP': 'Groceries' });
		saveCategoryRules({});

		expect(localStorage.getItem('budgy:subcategories')).toBeNull();
	});

	it('ignores a stored value of the wrong shape rather than crashing', () => {
		localStorage.setItem('budgy:subcategories', JSON.stringify({ 'CORNER SHOP': { id: 7 } }));

		expect(loadCategoryRules()).toEqual({});
	});
});

describe('without storage', () => {
	it('degrades to in-memory rather than throwing', () => {
		install(undefined);

		expect(loadAnchors()).toEqual({});
		expect(loadTheme()).toBe('system');
		expect(loadFiles()).toEqual({});
		expect(loadApiKey()).toBe('');
		expect(loadCategoryRules()).toEqual({});
		expect(() => saveCategoryRules({ 'CORNER SHOP': 'Homeware' })).not.toThrow();
		expect(() => saveApiKey('sk-ant-example')).not.toThrow();
		expect(saveFiles({ csv: { name: 'x', text: 'y' } })).toBe(false);
		expect(() => saveAnchors({ a: { balance: 1, asOf: '2026-08-09' } })).not.toThrow();
		expect(() => clearKey('files')).not.toThrow();
	});
});
