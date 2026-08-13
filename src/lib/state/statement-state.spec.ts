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
		expect(state.visible.every((transaction) => transaction.category === 'Food and Drink')).toBe(
			true
		);
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

	it('removes one source and keeps the other', async () => {
		const state = new StatementState();
		await state.loadFile(pdfFile());
		await state.loadFile(csvFile());

		state.remove('pdf');

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

	it('does not keep the files on the device unless asked', async () => {
		const state = new StatementState();
		await state.loadFile(csvFile());

		expect(localStorage.getItem('budgy:files')).toBeNull();

		state.setRemember(true);
		expect(localStorage.getItem('budgy:files')).not.toBeNull();
	});

	it('restores remembered files', async () => {
		const first = new StatementState();
		first.setRemember(true);
		await first.loadFile(csvFile());
		await first.loadFile(pdfFile());

		const second = new StatementState();
		await second.restore();

		expect(second.hasCsv).toBe(true);
		expect(second.hasPdf).toBe(true);
		expect(second.csvName).toBe('export.csv');
		expect(second.remember).toBe(true);
	});

	it('restores nothing when nothing was remembered', async () => {
		const state = new StatementState();
		await state.restore();

		expect(state.hasStatement).toBe(false);
	});

	it('forgets the files when the user opts back out', async () => {
		const state = new StatementState();
		state.setRemember(true);
		await state.loadFile(csvFile());
		state.setRemember(false);

		expect(localStorage.getItem('budgy:files')).toBeNull();
	});

	it('clears everything on request', async () => {
		const state = new StatementState();
		state.setRemember(true);
		await state.loadFile(csvFile());
		state.clear();

		expect(state.hasStatement).toBe(false);
		expect(state.csvName).toBe('');
		expect(localStorage.getItem('budgy:files')).toBeNull();
	});
});
