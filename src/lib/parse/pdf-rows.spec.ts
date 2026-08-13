import { describe, expect, it } from 'vitest';
import { parsePdfStatement, toLines, type PdfPage, type TextItem } from './pdf-rows.ts';

/**
 * Synthetic pages in the certified-statement layout. Column positions mirror
 * the real geometry — amounts right-aligned, description left-aligned — so the
 * rules under test are the ones that matter, without any real statement data.
 */
const COLUMN = { date: 61, description: 119, debit: 422, credit: 471, balance: 538 } as const;

const LINE_HEIGHT = 16.5;

/** Roughly the width the statement font gives a string at this size. */
function widthOf(text: string): number {
	return text.length * 4.4;
}

function at(str: string, x: number, y: number): TextItem {
	return { str, x, y, width: widthOf(str) };
}

/** Right-aligned, the way every figure in the statement is set. */
function rightAt(str: string, right: number, y: number): TextItem {
	return { str, x: right - widthOf(str), y, width: widthOf(str) };
}

function periodLine(y: number): TextItem[] {
	return [
		at('Account holder:', 53, y),
		at('A Person', 130, y),
		at('From:', 350, y),
		at('2025-01-01', 380, y),
		at('To:', 456, y),
		at('2025-03-31', 470, y)
	];
}

function accountLine(y: number, type: string, number: string): TextItem[] {
	return [
		at('Account type:', 53, y),
		at(type, 104, y),
		at('Account number:', 381, y),
		at(number, 470, y)
	];
}

function tableHeader(y: number): TextItem[] {
	return [
		at('Date', 75, y),
		at('Description', 227, y),
		rightAt('Debit', COLUMN.debit, y),
		rightAt('Credit', COLUMN.credit, y),
		rightAt('Balance', COLUMN.balance, y)
	];
}

interface RowSpec {
	date: string;
	description: string;
	debit?: string;
	credit?: string;
	balance: string;
}

function transactionRow(y: number, spec: RowSpec): TextItem[] {
	return [
		at(spec.date, COLUMN.date, y),
		at(spec.description, COLUMN.description, y),
		...(spec.debit === undefined ? [] : [rightAt(spec.debit, COLUMN.debit, y)]),
		...(spec.credit === undefined ? [] : [rightAt(spec.credit, COLUMN.credit, y)]),
		rightAt(spec.balance, COLUMN.balance, y)
	];
}

/** A page: heading lines, table header, then rows down the page. */
function page(options: { account?: [string, string]; period?: boolean; rows: RowSpec[] }): PdfPage {
	const heading = [
		...(options.period === false ? [] : periodLine(64)),
		...(options.account === undefined ? [] : accountLine(80, ...options.account)),
		...tableHeader(111)
	];

	return {
		items: [
			...heading,
			...options.rows.flatMap((row, index) => transactionRow(127 + index * LINE_HEIGHT, row))
		]
	};
}

/** The cover page, which lists each account with its closing balance. */
function coverPage(accounts: readonly [string, string, string][]): PdfPage {
	return {
		items: [
			...periodLine(163),
			at('Account Type', 121, 194),
			at('Account Number', 257, 194),
			rightAt('Balance', 504, 194),
			...accounts.flatMap(([type, number, balance], index) => {
				const y = 210 + index * LINE_HEIGHT;
				return [at(type, 55, y), at(number, 266, y), rightAt(balance, COLUMN.balance, y)];
			})
		]
	};
}

describe('parsePdfStatement', () => {
	const simple = parsePdfStatement([
		page({
			account: ['Transaction Account', '12345678901'],
			rows: [
				{
					date: '2025-01-02',
					description: 'Opening deposit',
					credit: 'R 1,000.00',
					balance: 'R 1,000.00'
				},
				{ date: '2025-01-03', description: 'GROCER', debit: 'R 250.00', balance: 'R 750.00' },
				{ date: '2025-01-04', description: 'Salary', credit: 'R 5,000.00', balance: 'R 5,750.00' }
			]
		})
	]);

	it('reads the statement period', () => {
		expect(simple.from).toBe('2025-01-01');
		expect(simple.to).toBe('2025-03-31');
	});

	it('reads the account heading', () => {
		expect(simple.accounts).toHaveLength(1);
		expect(simple.accounts[0]).toMatchObject({
			type: 'Transaction Account',
			number: '12345678901'
		});
	});

	it('signs debits negative and credits positive by their column', () => {
		expect(simple.accounts[0].rows.map((row) => row.amount)).toEqual([1000, -250, 5000]);
	});

	it('keeps the balance the bank printed on each row', () => {
		expect(simple.accounts[0].rows.map((row) => row.balance)).toEqual([1000, 750, 5750]);
	});

	it('keeps the description', () => {
		expect(simple.accounts[0].rows[1].description).toBe('GROCER');
	});

	it('finds nothing wrong with a statement that adds up', () => {
		expect(simple.issues).toEqual([]);
	});

	it('reads a balance printed with a trailing minus as money owed', () => {
		const loan = parsePdfStatement([
			page({
				account: ['Personal Loan', '18000000001'],
				rows: [
					{
						date: '2025-01-02',
						description: 'Initiation of loan',
						debit: 'R 30,000.00',
						balance: 'R 30,000.00-'
					},
					{
						date: '2025-01-25',
						description: 'Repayment',
						credit: 'R 1,000.00',
						balance: 'R 29,000.00-'
					}
				]
			})
		]);

		expect(loan.accounts[0].rows.map((row) => row.balance)).toEqual([-30000, -29000]);
		expect(loan.issues).toEqual([]);
	});

	it('carries the account across a continuation page with no heading', () => {
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: [{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' }]
			}),
			page({
				period: false,
				rows: [{ date: '2025-01-03', description: 'B', debit: 'R 20.00', balance: 'R 70.00' }]
			})
		]);

		expect(statement.accounts).toHaveLength(1);
		expect(statement.accounts[0].rows).toHaveLength(2);
		expect(statement.issues).toEqual([]);
	});

	it('keeps separate accounts apart', () => {
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: [{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' }]
			}),
			page({
				account: ['Credit Card Account', '17000000001'],
				period: false,
				rows: [{ date: '2025-01-02', description: 'B', debit: 'R 5.00', balance: 'R 5.00-' }]
			})
		]);

		expect(statement.accounts.map((account) => account.type)).toEqual([
			'Transaction Account',
			'Credit Card Account'
		]);
	});

	it('reads a row with no debit or credit as a declined attempt worth nothing', () => {
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: [
					{ date: '2025-01-02', description: 'GROCER', debit: 'R 10.00', balance: 'R 90.00' },
					{ date: '2025-01-02', description: 'Declined Int Card Purch', balance: 'R 90.00' },
					{
						date: '2025-01-02',
						description: 'Txn Declined Fee',
						debit: 'R 6.00',
						balance: 'R 84.00'
					}
				]
			})
		]);

		expect(statement.accounts[0].rows[1]).toMatchObject({
			description: 'Declined Int Card Purch',
			amount: 0,
			balance: 90
		});
		expect(statement.issues).toEqual([]);
	});

	it('does not let a wide figure merge into the balance beside it', () => {
		// A five-figure credit ends within a few points of the balance column.
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: [
					{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 17,992.30' },
					{
						date: '2025-01-02',
						description: 'PAYOUT',
						credit: 'R 82,428.30',
						balance: 'R 100,420.60'
					}
				]
			})
		]);

		expect(statement.accounts[0].rows[1]).toMatchObject({ amount: 82428.3, balance: 100420.6 });
		expect(statement.issues).toEqual([]);
	});

	it('reports a row whose balance does not follow from the one before it', () => {
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: [
					{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' },
					{ date: '2025-01-03', description: 'B', debit: 'R 20.00', balance: 'R 500.00' }
				]
			})
		]);

		expect(statement.issues).toHaveLength(1);
		expect(statement.issues[0].reason).toContain('does not follow');
	});

	it('summarises rather than lists when a whole account fails to add up', () => {
		const statement = parsePdfStatement([
			page({
				account: ['Transaction Account', '12345678901'],
				rows: Array.from({ length: 12 }, (_, index) => ({
					date: '2025-01-02',
					description: `Row ${index}`,
					debit: 'R 10.00',
					balance: `R ${100 + index}.00`
				}))
			})
		]);

		expect(statement.issues.length).toBeLessThanOrEqual(4);
		expect(statement.issues.at(-1)?.reason).toContain('further rows');
	});

	it('checks each account against the closing balance on the cover page', () => {
		const statement = parsePdfStatement([
			coverPage([['Transaction Account', '12345678901', 'R 999.00']]),
			page({
				account: ['Transaction Account', '12345678901'],
				period: false,
				rows: [{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' }]
			})
		]);

		expect(statement.accounts[0].coverBalance).toBe(999);
		expect(statement.issues.map((issue) => issue.reason).join(' ')).toContain(
			'closing balance on the summary page'
		);
	});

	it('is happy when the cover page agrees with the transactions', () => {
		const statement = parsePdfStatement([
			coverPage([['Transaction Account', '12345678901', 'R 90.00']]),
			page({
				account: ['Transaction Account', '12345678901'],
				period: false,
				rows: [{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' }]
			})
		]);

		expect(statement.issues).toEqual([]);
	});

	it('reports a table that appears before any account heading', () => {
		const statement = parsePdfStatement([
			page({
				period: false,
				rows: [{ date: '2025-01-02', description: 'A', debit: 'R 10.00', balance: 'R 90.00' }]
			})
		]);

		expect(statement.accounts).toEqual([]);
		expect(statement.issues[0].reason).toContain('no account heading');
	});

	it('ignores a page with no transaction table', () => {
		expect(parsePdfStatement([{ items: periodLine(64) }]).accounts).toEqual([]);
	});

	it('reads nothing from no pages', () => {
		expect(parsePdfStatement([])).toMatchObject({ accounts: [], from: '', to: '', issues: [] });
	});
});

describe('toLines', () => {
	it('groups runs printed at the same height into one line', () => {
		const lines = toLines([at('A', 10, 100), at('B', 200, 100.4), at('C', 10, 130)]);

		expect(lines).toHaveLength(2);
		expect(lines[0].cells.map((cell) => cell.text)).toEqual(['A', 'B']);
	});

	it('orders lines down the page', () => {
		const lines = toLines([at('second', 10, 130), at('first', 10, 100)]);

		expect(lines.map((line) => line.cells[0].text)).toEqual(['first', 'second']);
	});

	it('joins runs that nearly touch into one cell', () => {
		const lines = toLines([
			at('Account type:', 53, 80),
			at('Savings', 53 + widthOf('Account type:') + 2, 80)
		]);

		expect(lines[0].cells).toHaveLength(1);
		expect(lines[0].cells[0].text).toBe('Account type:Savings');
	});

	it('drops runs that are only whitespace', () => {
		const lines = toLines([at('A', 10, 100), at('   ', 200, 100)]);

		expect(lines[0].cells.map((cell) => cell.text)).toEqual(['A']);
	});

	it('folds the non-breaking space the statement prints inside amounts', () => {
		const lines = toLines([at('R 1,234.56', 400, 100)]);

		expect(lines[0].cells[0].text).toBe('R 1,234.56');
	});
});
