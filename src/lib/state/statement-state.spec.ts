import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfAccount, PdfStatement } from '../parse/pdf-rows.ts';

/**
 * The PDF loader is the one part of the app that needs a browser: it pulls in
 * pdf.js and a worker URL. The rules it feeds are tested directly in
 * `pdf-rows.spec.ts`, so here it is stubbed and the state machine is what is
 * under test.
 */
const readPdfStatement = vi.hoisted(() => vi.fn());
vi.mock('../parse/pdf.ts', () => ({ readPdfStatement }));

const { ALL_ACCOUNTS, StatementState } = await import('./statement.svelte.ts');

const HEADER =
	'"Value Date","Value Time","Account Nickname","Type","Transaction Description",' +
	'"Beneficiary or CardHolder","Amount","Category","SubCategory","Note"';

function row(date: string, amount: number, description = 'Something', category = 'Food and Drink') {
	return `${date},12:00:00,Cheque account,"Card on file","${description}","",${amount},"${category}","Groceries",""`;
}

/** Newest first, the way banks export. */
const CSV = [
	HEADER,
	row('2026-08-09', -100, 'GROCER'),
	row('2026-08-01', -200, 'FUEL'),
	row('2026-07-15', -300, 'RENT'),
	row('2026-05-01', -400, 'GYM')
].join('\n');

function account(
	type: string,
	number: string,
	rows: readonly [string, string, number, number][]
): PdfAccount {
	return {
		type,
		number,
		coverBalance: rows.at(-1)?.[3] ?? null,
		rows: rows.map(([date, description, amount, balance]) => ({
			date,
			description,
			amount,
			balance
		}))
	};
}

function pdfStatement(...accounts: PdfAccount[]): PdfStatement {
	return { accounts, from: '2026-05-01', to: '2026-08-09', issues: [] };
}

const CHEQUE = account('Transaction Account', '12345678901', [
	['2026-05-01', 'GYM', -400, 600],
	['2026-07-15', 'RENT', -300, 300],
	['2026-08-01', 'FUEL', -200, 100],
	['2026-08-09', 'GROCER', -100, 0]
]);

/** The same export with the oldest row missing, so one PDF line goes unmatched. */
const PARTIAL_CSV = [
	HEADER,
	row('2026-08-09', -100, 'GROCER'),
	row('2026-08-01', -200, 'FUEL'),
	row('2026-07-15', -300, 'RENT')
].join('\n');

function csvFile(text = CSV, name = 'export.csv'): File {
	return new File([text], name, { type: 'text/csv' });
}

function pdfFile(name = 'statement.pdf'): File {
	return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

function fakeStorage(): Storage {
	const entries = new Map<string, string>();

	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
		removeItem: (key: string) => void entries.delete(key),
		clear: () => entries.clear()
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
	// A fresh factory per test, so one test's history cannot be another's.
	vi.stubGlobal('indexedDB', new IDBFactory());
	readPdfStatement.mockReset();
	readPdfStatement.mockResolvedValue(pdfStatement(CHEQUE));
});

afterEach(() => vi.unstubAllGlobals());

describe('StatementState', () => {
	it('starts with nothing loaded', () => {
		const state = new StatementState();

		expect(state.hasStatement).toBe(false);
		expect(state.sources.every((source) => !source.loaded)).toBe(true);
	});

	it('loads a CSV on its own', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.hasCsv).toBe(true);
		expect(state.hasPdf).toBe(false);
		expect(state.csvName).toBe('export.csv');
		expect(state.visible).toHaveLength(4);
	});

	it('loads a PDF on its own', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		expect(state.hasPdf).toBe(true);
		expect(state.pdfName).toBe('statement.pdf');
		expect(state.visible).toHaveLength(4);
	});

	it('routes each file to its own slot, whichever order they arrive in', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		await state.loadFile(pdfFile());

		expect(state.sources.map((source) => source.loaded)).toEqual([true, true]);
		expect(state.enrichedAccount).toBe('Transaction Account');
	});

	it('recognises a PDF whose name does not say so', async () => {
		const state = new StatementState();
		await state.loadFile(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'statement'));

		expect(state.hasPdf).toBe(true);
	});

	it('refuses a file that is neither', async () => {
		const state = new StatementState();
		await state.loadFile(
			new File([new Uint8Array([0, 1, 2, 3])], 'holiday.jpg', { type: 'image/jpeg' })
		);

		expect(state.error).toContain('neither a PDF statement nor a CSV export');
		expect(state.hasStatement).toBe(false);
	});

	it('takes the balances from the PDF, so nothing needs anchoring', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		expect(state.balancesAreCertified).toBe(true);
		expect(state.isRelative).toBe(false);
		expect(state.insights.summary.closingBalance).toBe(0);
		expect(state.insights.summary.openingBalance).toBe(1000);
	});

	it('folds the CSV categories onto the PDF rows', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		await state.loadFile(csvFile());

		expect(state.matched).toBe(4);
		expect(
			state.visible.every(
				(transaction) =>
					transaction.category === 'Groceries' && transaction.bankCategory === 'Food and Drink'
			)
		).toBe(true);
		// …without giving up the balances.
		expect(state.visible.map((transaction) => transaction.balance)).toEqual([600, 300, 100, 0]);
	});

	it('falls back to net change for a CSV on its own', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.balancesAreCertified).toBe(false);
		expect(state.isRelative).toBe(true);
	});

	it('anchors a CSV-only view once the user supplies a balance', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.setAnchor(2500);

		expect(state.isRelative).toBe(false);
		expect(state.insights.summary.closingBalance).toBe(2500);
	});

	it('ignores a stale anchor once the PDF supplies the real balances', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.setAnchor(9999);
		await state.loadFile(pdfFile());

		expect(state.isAnchorStale).toBe(false);
		expect(state.insights.summary.closingBalance).toBe(0);
	});

	it('adds every account up into a net worth, whichever one is selected', async () => {
		const savings = account('Savings Account', '99999999999', [
			['2026-06-01', 'INTEREST', 50, 5000]
		]);
		readPdfStatement.mockResolvedValue(pdfStatement(CHEQUE, savings));

		const state = new StatementState();
		await state.loadFile(pdfFile());

		expect(state.netWorth.isRelative).toBe(false);
		// The cheque account ends at nothing, the savings account at 5,000.
		expect(state.netWorth.total).toBe(5000);
		expect(state.netWorth.accounts.map((entry) => entry.account)).toHaveLength(2);
	});

	it('leaves a stale anchor out of the net worth', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		// A balance measured after some earlier export, not this one.
		state.anchors = { 'Cheque account': { balance: 2500, asOf: '2020-01-01' } };

		expect(state.netWorth.isRelative).toBe(true);
		expect(state.netWorth.unanchored).toEqual(['Cheque account']);
	});

	it('does not treat the all-accounts balance as an account of its own', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.anchors = { [ALL_ACCOUNTS]: { balance: 2500, asOf: state.latestDate } };

		expect(state.netWorth.isRelative).toBe(true);
	});

	it('removes one source and keeps the other', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		await state.loadFile(csvFile());

		await state.remove('pdf');

		expect(state.hasPdf).toBe(false);
		expect(state.hasCsv).toBe(true);
		expect(state.hasStatement).toBe(true);
		expect(state.balancesAreCertified).toBe(false);
	});

	it('reports a PDF it could not read, without losing the CSV', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		readPdfStatement.mockRejectedValueOnce(new Error('no text layer'));
		await state.loadFile(pdfFile());

		expect(state.error).toContain('no text layer');
		expect(state.hasPdf).toBe(false);
		expect(state.hasCsv).toBe(true);
	});

	it('lists every account the PDF covers', async () => {
		readPdfStatement.mockResolvedValue(
			pdfStatement(
				CHEQUE,
				account('Credit Card Account', '17000000001', [['2026-08-01', 'ONLINE SHOP', -99, -99]])
			)
		);

		const state = new StatementState();
		await state.loadFile(pdfFile());

		expect(state.accounts).toEqual(['Transaction Account', 'Credit Card Account']);
		expect(state.account).toBe('Transaction Account');
	});

	it('filters to one account at a time', async () => {
		readPdfStatement.mockResolvedValue(
			pdfStatement(
				CHEQUE,
				account('Credit Card Account', '17000000001', [['2026-08-01', 'ONLINE SHOP', -99, -99]])
			)
		);

		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.account = 'Credit Card Account';
		expect(state.visible).toHaveLength(1);

		state.account = ALL_ACCOUNTS;
		expect(state.visible).toHaveLength(5);
	});

	it('keeps every account in one chronological order when showing them all', async () => {
		readPdfStatement.mockResolvedValue(
			pdfStatement(
				CHEQUE,
				account('Credit Card Account', '17000000001', [
					['2026-06-01', 'ONLINE SHOP', -99, -99],
					['2026-08-05', 'ONLINE SHOP', -50, -149]
				])
			)
		);

		const state = new StatementState();
		await state.loadFile(pdfFile());
		state.account = ALL_ACCOUNTS;

		const stamps = state.visible.map((transaction) => transaction.timestamp);
		expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
		// …and the series a chart would draw never doubles back on itself.
		const series = state.insights.balanceSeries.map((point) => point.timestamp);
		expect(series).toEqual([...series].sort((a, b) => a - b));
	});

	it('scopes a preset to the newest row across every account', async () => {
		readPdfStatement.mockResolvedValue(
			pdfStatement(
				CHEQUE,
				// Parsed last, but ends earlier — it must not decide the period.
				account('Personal Loan', '18000000001', [['2026-06-01', 'Repayment', -99, -99]])
			)
		);

		const state = new StatementState();
		await state.loadFile(pdfFile());
		state.account = ALL_ACCOUNTS;
		state.range = '30d';

		expect(state.latestDate).toBe('2026-08-09');
		expect(state.bounds).toEqual({ from: '2026-07-11', to: '2026-08-09' });
	});

	it('scopes a preset to the statement, not to today', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.range = '30d';

		expect(state.bounds).toEqual({ from: '2026-07-11', to: '2026-08-09' });
		expect(state.visible).toHaveLength(3);
	});

	it('lists the months the account has, and opens on the newest', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.months).toEqual(['2026-05', '2026-07', '2026-08']);
		expect(state.activeMonth).toBe('2026-08');
	});

	it('shows one whole month at a time', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.range = 'month';

		expect(state.bounds).toEqual({ from: '2026-08-01', to: '2026-08-31' });
		expect(state.visible).toHaveLength(2);

		state.stepMonth(-1);
		expect(state.activeMonth).toBe('2026-07');
		expect(state.visible).toHaveLength(1);
	});

	it('steps only as far as the statement goes', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		state.stepMonth(1);
		expect(state.activeMonth).toBe('2026-08');

		state.selectedMonth = '2026-05';
		state.stepMonth(-1);
		expect(state.activeMonth).toBe('2026-05');
	});

	it('does not strand the month view on a month the new account never had', async () => {
		readPdfStatement.mockResolvedValue(
			pdfStatement(
				CHEQUE,
				account('Credit Card Account', '17000000001', [['2026-06-01', 'ONLINE SHOP', -99, -99]])
			)
		);

		const state = new StatementState();
		await state.loadFile(pdfFile());
		state.range = 'month';
		state.selectedMonth = '2026-05';

		state.account = 'Credit Card Account';
		expect(state.activeMonth).toBe('2026-06');
		expect(state.visible).toHaveLength(1);
	});

	it('re-cuts the months when the reader moves the day they start on', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.range = 'month';

		state.setMonthStart(25);

		// 25 July to 24 August is "August", and holds both of August's rows.
		expect(state.months).toEqual(['2026-05', '2026-07', '2026-08']);
		expect(state.activeMonth).toBe('2026-08');
		expect(state.bounds).toEqual({ from: '2026-07-25', to: '2026-08-24' });
		expect(state.visible).toHaveLength(2);
	});

	it('keeps the chosen day for the next visit, and refuses one no month has', async () => {
		const state = new StatementState();
		state.setMonthStart(25);
		expect(localStorage.getItem('budgy:month-start')).toBe('25');

		state.setMonthStart(31);
		expect(state.monthStart).toBe(1);
	});

	it('keeps every month available while the view is scoped to one', async () => {
		// What the month-against-month card is fed, so it can still compare.
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.range = 'month';

		expect(state.visible).toHaveLength(2);
		expect(state.accountTransactions).toHaveLength(4);
		expect(state.months).toEqual(['2026-05', '2026-07', '2026-08']);
		expect(state.focusMonth).toBe('2026-08');
	});
});

describe('the history', () => {
	it('keeps an upload without being asked', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.library.entries).toHaveLength(1);
		expect(state.library.entries[0]?.csvName).toBe('export.csv');
	});

	it('files both files of one statement as a single entry', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		await state.loadFile(pdfFile());

		expect(state.library.entries).toHaveLength(1);
		expect(state.library.entries[0]?.csvName).toBe('export.csv');
		expect(state.library.entries[0]?.pdfName).toBe('statement.pdf');
	});

	it('files the next statement beside the last rather than over it', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.startNew();
		await state.loadFile(csvFile(PARTIAL_CSV, 'july.csv'));

		expect(state.library.entries.map((entry) => entry.csvName)).toEqual(['july.csv', 'export.csv']);
	});

	it('clears the screen for a new statement without deleting the old one', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.startNew();

		expect(state.hasStatement).toBe(false);
		expect(state.csvName).toBe('');
		expect(state.library.count).toBe(1);
	});

	it('records what each saved statement covers, so the list can say', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.library.entries[0]?.summary).toEqual({
			from: '2026-05-01',
			to: '2026-08-09',
			accounts: ['Cheque account'],
			transactionCount: 4
		});
	});

	it('re-opens the statement this browser was last reading', async () => {
		const first = new StatementState();
		await first.loadFile(csvFile());
		await first.loadFile(pdfFile());

		const second = new StatementState();
		await second.restore();

		expect(second.hasCsv).toBe(true);
		expect(second.hasPdf).toBe(true);
		expect(second.csvName).toBe('export.csv');
	});

	it('restores nothing when nothing was kept', async () => {
		const state = new StatementState();
		await state.restore();

		expect(state.hasStatement).toBe(false);
		expect(state.library.count).toBe(0);
	});

	it('comes back to the upload page after a new statement was started', async () => {
		const first = new StatementState();
		await first.loadFile(csvFile());
		first.startNew();

		const second = new StatementState();
		await second.restore();

		expect(second.hasStatement).toBe(false);
		expect(second.library.count).toBe(1);
	});

	it('opens a saved statement in place of the one on screen', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		const first = state.library.entries[0]?.id ?? '';

		state.startNew();
		await state.loadFile(csvFile(PARTIAL_CSV, 'july.csv'));
		expect(state.csvName).toBe('july.csv');

		await state.openEntry(first);

		expect(state.csvName).toBe('export.csv');
		expect(state.library.activeId).toBe(first);
		expect(state.library.count).toBe(2);
	});

	it('does not file the statement again just for being opened', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		const id = state.library.entries[0]?.id ?? '';

		await state.openEntry(id);

		expect(state.library.count).toBe(1);
	});

	it('deletes one statement and closes it if it was the one open', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		const id = state.library.entries[0]?.id ?? '';

		await state.deleteEntry(id);

		expect(state.library.count).toBe(0);
		expect(state.hasStatement).toBe(false);
		expect(state.library.activeId).toBe('');
	});

	it('leaves the open statement alone when another is deleted', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		const old = state.library.entries[0]?.id ?? '';

		state.startNew();
		await state.loadFile(csvFile(PARTIAL_CSV, 'july.csv'));
		await state.deleteEntry(old);

		expect(state.library.count).toBe(1);
		expect(state.csvName).toBe('july.csv');
	});

	it('drops the entry when its last file is removed', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		await state.remove('csv');

		expect(state.hasStatement).toBe(false);
		expect(state.library.count).toBe(0);
	});

	it('keeps the entry when one of two files is removed', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		await state.loadFile(pdfFile());
		await state.remove('csv');

		expect(state.library.count).toBe(1);
		expect(state.library.entries[0]?.csvName).toBe('');
		expect(state.library.entries[0]?.pdfName).toBe('statement.pdf');
	});

	it('forgets every statement on request', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		state.startNew();
		await state.loadFile(csvFile(PARTIAL_CSV, 'july.csv'));

		await state.clearAll();

		expect(state.library.count).toBe(0);
		expect(state.hasStatement).toBe(false);
	});

	it('keeps nothing once the reader turns keeping off', async () => {
		const state = new StatementState();
		await state.setKeepUploads(false);
		await state.loadFile(csvFile());

		expect(state.library.count).toBe(0);
		// Still readable in this tab — turning it off is about the disk, not the page.
		expect(state.hasStatement).toBe(true);
	});

	it('does not claim to have kept a statement it was told not to keep', async () => {
		const first = new StatementState();
		await first.setKeepUploads(false);
		await first.loadFile(csvFile());

		expect(first.library.activeId).toBe('');

		// Nothing was filed, so the next visit must not go looking for it.
		const second = new StatementState();
		await second.restore();

		expect(second.library.error).toBeNull();
		expect(second.hasStatement).toBe(false);
	});

	it('throws away what was already kept when keeping is turned off', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());
		expect(state.library.count).toBe(1);

		await state.setKeepUploads(false);

		expect(state.library.count).toBe(0);
	});

	it('files what is on screen when keeping is turned back on', async () => {
		const state = new StatementState();
		await state.setKeepUploads(false);
		await state.loadFile(csvFile());

		await state.setKeepUploads(true);

		expect(state.library.count).toBe(1);
		expect(state.library.entries[0]?.csvName).toBe('export.csv');
	});

	it('remembers that keeping was turned off', async () => {
		await new StatementState().setKeepUploads(false);

		expect(new StatementState().library.keepUploads).toBe(false);
	});

	it('files the statement an older version kept, then forgets its key', async () => {
		localStorage.setItem('budgy:files', JSON.stringify({ csv: { name: 'legacy.csv', text: CSV } }));

		const state = new StatementState();
		await state.restore();

		expect(state.csvName).toBe('legacy.csv');
		expect(state.library.count).toBe(1);
		expect(localStorage.getItem('budgy:files')).toBeNull();
	});
});

describe('filing what the bank left unfiled', () => {
	it('lists what has no category, by merchant, heaviest first', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		expect(state.uncategorised.map((group) => group.merchant)).toEqual([
			'GYM',
			'RENT',
			'FUEL',
			'GROCER'
		]);
	});

	it('has nothing to ask about once the bank has filed every row', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.uncategorised).toEqual([]);
	});

	it('offers the categories this statement already uses', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(state.categoryOptions).toContain('Groceries');
		expect(state.categoryOptions).not.toContain('Uncategorised');
	});

	it('moves a merchant’s spending into the category it is given', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');

		expect(
			state.insights.categories.find((bucket) => bucket.label === 'Sport and Fitness')?.total
		).toBe(400);
		expect(state.uncategorised.map((group) => group.merchant)).not.toContain('GYM');
	});

	it('gives the row the bank heading its new category sits under', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');

		expect(state.visible[0].bankCategory).toBe('Recreation');
	});

	it('says how much of the statement each choice covers', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');

		expect(state.appliedRules).toEqual([
			{ merchant: 'GYM', category: 'Sport and Fitness', count: 1 }
		]);
	});

	it('takes the choice back off again', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');
		state.setCategory('GYM', '');

		expect(state.appliedRules).toEqual([]);
		expect(state.uncategorised.map((group) => group.merchant)).toContain('GYM');
	});

	it('refiles what the bank had already filed, when the reader says so', async () => {
		// The reader has the last word: a breakdown that cannot be corrected is one
		// they stop trusting. The choice is listed under `appliedRules`, and taking
		// it back off is what puts the bank's own filing back.
		const state = new StatementState();
		await state.loadFile(csvFile());

		const grocer = () => state.visible.find((transaction) => transaction.merchant === 'GROCER');

		state.setCategory('GROCER', 'Coffee');
		expect(grocer()?.category).toBe('Coffee');
		// Only that merchant moves — a rule is keyed by one, not by the bank's label.
		expect(
			state.visible.filter((transaction) => transaction.category === 'Groceries')
		).toHaveLength(3);

		state.setCategory('GROCER', '');
		expect(grocer()?.category).toBe('Groceries');
	});

	it('still applies to a PDF row the CSV had no match for', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		await state.loadFile(csvFile(PARTIAL_CSV));

		state.setCategory('GYM', 'Sport and Fitness');

		expect(state.insights.categories.map((bucket) => bucket.label)).toEqual([
			'Groceries',
			'Sport and Fitness'
		]);
	});

	it('stops counting a merchant as spending once it is filed as a transfer', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Transfers');

		expect(state.insights.summary.expense).toBe(600);
	});

	it('remembers the choices for the next visit', async () => {
		const first = new StatementState();
		await first.loadFile(pdfFile());
		first.setCategory('GYM', 'Sport and Fitness');

		const second = new StatementState();
		await second.loadFile(pdfFile());

		expect(second.visible.map((transaction) => transaction.category)).toEqual([
			'Sport and Fitness',
			'Uncategorised',
			'Uncategorised',
			'Uncategorised'
		]);
	});

	it('takes a category of the reader’s own, and keeps offering it', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'School fees');

		expect(state.insights.categories.map((bucket) => bucket.label)).toContain('School fees');
		expect(state.categoryOptions).toContain('School fees');
	});

	it('keeps offering one made for a merchant this statement does not mention', async () => {
		const first = new StatementState();
		await first.loadFile(pdfFile());
		first.setCategory('SOMEWHERE ELSE', 'School fees');

		const second = new StatementState();
		await second.loadFile(pdfFile());

		expect(second.categoryOptions).toContain('School fees');
	});

	it('files a new name under the existing category when it is already there', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'sport and fitness');

		expect(state.appliedRules).toEqual([
			{ merchant: 'GYM', category: 'Sport and Fitness', count: 1 }
		]);
	});

	it('refuses a name that would file a row as what it already is', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Uncategorised');

		expect(state.appliedRules).toEqual([]);
	});

	it('keeps them when the files are cleared, since they outlive one statement', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		state.setCategory('GYM', 'Sport and Fitness');

		await state.clearAll();

		expect(state.categoryRules).toEqual({ GYM: 'Sport and Fitness' });
	});

	it('keeps a name of the reader’s own after the rule that made it is dropped', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'School fees');
		// Re-filed elsewhere, so nothing carries the invented name any more.
		state.setCategory('GYM', 'Sport and Fitness');

		expect(state.ownCategories).toContain('School fees');
		expect(state.categoryOptions).toContain('School fees');
	});

	it('offers a name of the reader’s own to the next statement they open', async () => {
		const first = new StatementState();
		await first.loadFile(pdfFile());
		first.setCategory('GYM', 'School fees');
		first.setCategory('GYM', '');

		const second = new StatementState();
		await second.loadFile(pdfFile());

		expect(second.categoryOptions).toContain('School fees');
	});

	it('does not claim the bank’s own categories as the reader’s', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');

		expect(state.ownCategories).toEqual([]);
	});

	it('puts the category just chosen at the head of the shortlist', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());

		state.setCategory('GYM', 'Sport and Fitness');
		state.setCategory('GROCER', 'Coffee');

		expect(state.recentOptions).toEqual(['Coffee', 'Sport and Fitness']);
	});

	it('carries the shortlist into the next statement', async () => {
		const first = new StatementState();
		await first.loadFile(pdfFile());
		first.setCategory('GYM', 'Sport and Fitness');

		const second = new StatementState();
		await second.loadFile(pdfFile());

		expect(second.recentOptions).toEqual(['Sport and Fitness']);
	});

	it('leaves a shortlisted category out once nothing can be filed under it', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		// A category from a statement long since replaced, which this one has no
		// way to resolve — offering it would be offering a dead end.
		localStorage.setItem('budgy:recent-categories', JSON.stringify(['Ghost category']));

		const next = new StatementState();
		await next.loadFile(pdfFile());

		expect(next.recentCategories).toEqual(['Ghost category']);
		expect(next.recentOptions).toEqual([]);
		expect(state.recentOptions).toEqual([]);
	});
});

describe('charges the reader tells the forecast are not coming', () => {
	it('counts everything the history names until told otherwise', () => {
		expect(new StatementState().droppedCharges).toEqual([]);
	});

	it('stops counting one, and starts again when it is ticked back on', () => {
		const state = new StatementState();

		state.setChargeCounted('expense:GYM', false);
		expect(state.droppedCharges).toEqual(['expense:GYM']);

		state.setChargeCounted('expense:GYM', true);
		expect(state.droppedCharges).toEqual([]);
	});

	it('says the same charge once, however often it is ticked off', () => {
		const state = new StatementState();

		state.setChargeCounted('expense:GYM', false);
		state.setChargeCounted('expense:GYM', false);

		expect(state.droppedCharges).toEqual(['expense:GYM']);
	});

	it('remembers the choice for the next visit', () => {
		new StatementState().setChargeCounted('expense:GYM', false);

		// The gym is cancelled today and still cancelled when next month's export
		// arrives with a history that says it bills on the 20th.
		expect(new StatementState().droppedCharges).toEqual(['expense:GYM']);
	});

	it('counts everything again in one act, including what no page is showing', () => {
		const state = new StatementState();
		state.setChargeCounted('expense:GYM', false);
		state.setChargeCounted('income:BONUS', false);

		state.clearDroppedCharges();

		expect(state.droppedCharges).toEqual([]);
		expect(new StatementState().droppedCharges).toEqual([]);
	});
});

describe('charges the reader adds to the forecast', () => {
	it('starts with none, so the forecast expects only what it found', () => {
		expect(new StatementState().addedCharges).toEqual([]);
	});

	it('keeps one payee once, however often it is vouched for', () => {
		const state = new StatementState();

		state.addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });
		state.addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });

		expect(state.addedCharges).toEqual([{ kind: 'merchant', merchant: 'VET', flow: 'expense' }]);
	});

	it('counts a charge again when it is added back after being ticked off', () => {
		const state = new StatementState();
		state.setChargeCounted('expense:VET', false);

		state.addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });

		expect(state.droppedCharges).toEqual([]);
	});

	it('takes a charge back out, and its tick with it', () => {
		const state = new StatementState();
		state.addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });
		state.setChargeCounted('expense:VET', false);

		state.removeCharge('expense:VET');

		expect(state.addedCharges).toEqual([]);
		expect(state.droppedCharges).toEqual([]);
	});

	it('un-vouches a payee rather than striking it through', () => {
		// Ticking one of last month's payees is what put the row there, so
		// unticking it should take the row away again — not leave a struck line
		// only a different control can undo.
		const state = new StatementState();
		state.addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });

		state.stopCounting('expense:VET');

		expect(state.addedCharges).toEqual([]);
		expect(state.droppedCharges).toEqual([]);
	});

	it('keeps a charge the reader typed, and merely stops counting it', () => {
		// Retyping one is not one click, so the row is the only copy of it.
		const state = new StatementState();
		state.addCharge({
			kind: 'custom',
			id: 'r1',
			name: 'Rent',
			flow: 'expense',
			amount: 8000,
			day: 25,
			category: ''
		});

		state.stopCounting('custom:r1');

		expect(state.addedCharges).toHaveLength(1);
		expect(state.droppedCharges).toEqual(['custom:r1']);
	});

	it('stops counting a charge the history found, and keeps its row', () => {
		const state = new StatementState();

		state.stopCounting('expense:GYM');

		expect(state.droppedCharges).toEqual(['expense:GYM']);
	});

	it('leaves a charge it did not add alone, tick and all', () => {
		// The gym is the statement's own finding, so there is nothing here to
		// remove — and counting it again would undo a choice about something else.
		const state = new StatementState();
		state.setChargeCounted('expense:GYM', false);

		state.removeCharge('expense:GYM');

		expect(state.droppedCharges).toEqual(['expense:GYM']);
	});

	it('remembers them for the next visit', () => {
		new StatementState().addCharge({ kind: 'merchant', merchant: 'VET', flow: 'expense' });

		expect(new StatementState().addedCharges).toEqual([
			{ kind: 'merchant', merchant: 'VET', flow: 'expense' }
		]);
	});
});
