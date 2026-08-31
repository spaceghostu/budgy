import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearKey,
	loadActiveId,
	loadAnchors,
	loadApiKey,
	loadCategoryRules,
	loadFiles,
	loadKeepUploads,
	loadAddedCharges,
	loadDroppedCharges,
	loadOwnCategories,
	loadMonthStart,
	loadRecentCategories,
	loadTheme,
	MAX_RECENT_CATEGORIES,
	saveActiveId,
	saveAnchors,
	saveApiKey,
	saveCategoryRules,
	saveKeepUploads,
	saveAddedCharges,
	saveDroppedCharges,
	saveOwnCategories,
	saveMonthStart,
	saveRecentCategories,
	saveTheme,
	withRecentCategory
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

describe('the day a month starts on', () => {
	it('defaults to the calendar month', () => {
		expect(loadMonthStart()).toBe(1);
	});

	it('round-trips a choice', () => {
		saveMonthStart(25);

		expect(loadMonthStart()).toBe(25);
	});

	it('falls back to the 1st for a day some month would not have', () => {
		localStorage.setItem('budgy:month-start', JSON.stringify(31));

		expect(loadMonthStart()).toBe(1);
	});

	it('rejects a value that is not a day at all', () => {
		localStorage.setItem('budgy:month-start', JSON.stringify('payday'));

		expect(loadMonthStart()).toBe(1);
	});
});

describe('files kept by an older version', () => {
	it('starts with nothing kept', () => {
		expect(loadFiles()).toEqual({});
	});

	it('reads the statement the single-slot scheme left behind', () => {
		localStorage.setItem(
			'budgy:files',
			JSON.stringify({
				csv: { name: 'export.csv', text: 'a,b\n1,2' },
				pdf: { name: 'statement.pdf', base64: 'JVBERi0=' }
			})
		);

		const stored = loadFiles();
		expect(stored.csv).toEqual({ name: 'export.csv', text: 'a,b\n1,2' });
		expect(stored.pdf).toEqual({ name: 'statement.pdf', base64: 'JVBERi0=' });
	});

	it('forgets them on request, which is what adopting one does', () => {
		localStorage.setItem('budgy:files', JSON.stringify({ csv: { name: 'a.csv', text: 'a' } }));
		clearKey('files');

		expect(loadFiles()).toEqual({});
	});

	it('rejects a stored value missing its fields', () => {
		localStorage.setItem('budgy:files', JSON.stringify({ csv: { name: 'x' } }));

		expect(loadFiles()).toEqual({});
	});
});

describe('the statement last open', () => {
	it('starts blank, so a first visit opens nothing', () => {
		expect(loadActiveId()).toBe('');
	});

	it('round-trips the id', () => {
		saveActiveId('9f8c-1');

		expect(loadActiveId()).toBe('9f8c-1');
	});

	it('clears the key rather than storing a blank', () => {
		saveActiveId('9f8c-1');
		saveActiveId('');

		expect(localStorage.getItem('budgy:active')).toBeNull();
		expect(loadActiveId()).toBe('');
	});

	it('ignores a stored value that is not an id', () => {
		localStorage.setItem('budgy:active', JSON.stringify({ id: 'nope' }));

		expect(loadActiveId()).toBe('');
	});

	it('says nothing is open when the browser has no storage at all', () => {
		install(undefined);

		expect(loadActiveId()).toBe('');
	});
});

describe('keeping uploads', () => {
	it('is on by default, since the history is the feature', () => {
		expect(loadKeepUploads()).toBe(true);
	});

	it('round-trips being turned off', () => {
		saveKeepUploads(false);

		expect(loadKeepUploads()).toBe(false);
	});

	it('round-trips being turned back on', () => {
		saveKeepUploads(false);
		saveKeepUploads(true);

		expect(loadKeepUploads()).toBe(true);
	});

	it('falls back to on when the stored value is not a choice', () => {
		localStorage.setItem('budgy:keep-uploads', JSON.stringify('yes'));

		expect(loadKeepUploads()).toBe(true);
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

describe('the reader’s own categories', () => {
	it('starts with none, so only the bank’s list is offered', () => {
		expect(loadOwnCategories()).toEqual([]);
	});

	it('round-trips a name the reader invented', () => {
		saveOwnCategories(['School fees', 'Boat']);

		expect(loadOwnCategories()).toEqual(['School fees', 'Boat']);
	});

	it('clears the key rather than storing an empty list', () => {
		saveOwnCategories(['School fees']);
		saveOwnCategories([]);

		expect(localStorage.getItem('budgy:own-categories')).toBeNull();
	});

	it('ignores a stored value of the wrong shape rather than crashing', () => {
		localStorage.setItem('budgy:own-categories', JSON.stringify([{ name: 'School fees' }]));

		expect(loadOwnCategories()).toEqual([]);
	});
});

describe('the charges the reader says are not coming', () => {
	it('starts with none, so the forecast counts everything it found', () => {
		expect(loadDroppedCharges()).toEqual([]);
	});

	it('round-trips a charge ticked off, so next month does not ask again', () => {
		saveDroppedCharges(['expense:GYM', 'income:BONUS']);

		expect(loadDroppedCharges()).toEqual(['expense:GYM', 'income:BONUS']);
	});

	it('clears the key rather than storing an empty list', () => {
		saveDroppedCharges(['expense:GYM']);
		saveDroppedCharges([]);

		expect(localStorage.getItem('budgy:dropped-charges')).toBeNull();
	});

	it('ignores a stored value of the wrong shape rather than crashing', () => {
		localStorage.setItem('budgy:dropped-charges', JSON.stringify({ 'expense:GYM': true }));

		expect(loadDroppedCharges()).toEqual([]);
	});
});

describe('the charges the reader added themselves', () => {
	it('starts with none, so the forecast expects only what it found', () => {
		expect(loadAddedCharges()).toEqual([]);
	});

	it('round-trips both kinds of charge', () => {
		const charges = [
			{ kind: 'merchant', merchant: 'VET', flow: 'expense' },
			{
				kind: 'custom',
				id: 'r1',
				name: 'Rent',
				flow: 'expense',
				amount: 8000,
				day: 25,
				category: 'Housing'
			}
		] as const;

		saveAddedCharges(charges);

		expect(loadAddedCharges()).toEqual(charges);
	});

	it('clears the key rather than storing an empty list', () => {
		saveAddedCharges([{ kind: 'merchant', merchant: 'VET', flow: 'expense' }]);
		saveAddedCharges([]);

		expect(localStorage.getItem('budgy:added-charges')).toBeNull();
	});

	it('refuses a stored charge missing what it takes to be one', () => {
		// An amount that is not a number would reach the arithmetic and turn the
		// whole projection into a blank rather than a wrong figure.
		localStorage.setItem(
			'budgy:added-charges',
			JSON.stringify([
				{ kind: 'custom', id: 'r1', name: 'Rent', flow: 'expense', amount: null, day: 25 }
			])
		);

		expect(loadAddedCharges()).toEqual([]);
	});

	it('refuses a charge on neither side of the money', () => {
		localStorage.setItem(
			'budgy:added-charges',
			JSON.stringify([{ kind: 'merchant', merchant: 'VET', flow: 'sideways' }])
		);

		expect(loadAddedCharges()).toEqual([]);
	});
});

describe('the recently chosen categories', () => {
	it('starts empty, so the picker is plain alphabetical', () => {
		expect(loadRecentCategories()).toEqual([]);
	});

	it('round-trips the shortlist', () => {
		saveRecentCategories(['Groceries', 'Fuel']);

		expect(loadRecentCategories()).toEqual(['Groceries', 'Fuel']);
	});

	it('puts the latest choice at the head', () => {
		expect(withRecentCategory(['Fuel', 'Coffee'], 'Groceries')).toEqual([
			'Groceries',
			'Fuel',
			'Coffee'
		]);
	});

	it('moves a category already on the list rather than repeating it', () => {
		expect(withRecentCategory(['Fuel', 'Coffee'], 'Coffee')).toEqual(['Coffee', 'Fuel']);
	});

	it('treats two spellings of a category as the one category', () => {
		expect(withRecentCategory(['Coffee'], 'coffee')).toEqual(['coffee']);
	});

	it('stays a shortlist rather than growing into the full list', () => {
		const many = Array.from({ length: 20 }, (_, index) => `Category ${index}`);
		const shortlist = many.reduce(withRecentCategory, [] as readonly string[]);

		expect(shortlist).toHaveLength(MAX_RECENT_CATEGORIES);
		expect(shortlist[0]).toBe('Category 19');
	});

	it('ignores a name that says nothing', () => {
		expect(withRecentCategory(['Fuel'], '  ')).toEqual(['Fuel']);
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
		expect(loadKeepUploads()).toBe(true);
		expect(() => saveKeepUploads(false)).not.toThrow();
		expect(() => saveActiveId('a')).not.toThrow();
		expect(() => saveAnchors({ a: { balance: 1, asOf: '2026-08-09' } })).not.toThrow();
		expect(() => clearKey('files')).not.toThrow();
	});
});
