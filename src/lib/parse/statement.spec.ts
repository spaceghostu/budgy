import { describe, expect, it } from 'vitest';
import { StatementFormatError, parseAmount, parseStatement } from './statement.ts';

/**
 * Synthetic rows in the Discovery Bank export shape. Deliberately not real
 * statement data — fixtures are committed, financial history should not be.
 */
const HEADER =
	'"Value Date","Value Time","Account Nickname","Type","Transaction Description",' +
	'"Beneficiary or CardHolder","Amount","Category","SubCategory","Note"';

const SAMPLE = [
	HEADER,
	'2026-03-05,16:34:49,Cheque account,"EFT","Salary","",25000.00,"Other","Income Other",""',
	'2026-03-04,12:10:00,Cheque account,"Card on file","GROCER 123456789","",-450.25,"Food and Drink","Groceries",""',
	'2026-03-03,09:00:00,Cheque account,"Fee","Txn Declined Fee Streaming","",-6.00,"Fees and Interest","Bank Fees",""',
	'2026-03-03,07:00:00,Cheque account,"","Declined Int Card Purch","",0.00,"Miscellaneous","Apps and Web Services",""',
	'2026-03-02,08:00:00,Cheque account,"Transfer","F","From: Savings",1000.00,"Not for Financial Analyser","Transfers",""'
].join('\n');

describe('parseStatement', () => {
	it('reads every transaction row', () => {
		const { transactions, issues } = parseStatement(SAMPLE);

		expect(transactions).toHaveLength(5);
		expect(issues).toHaveLength(0);
	});

	it('returns transactions oldest first, because balances accumulate forwards', () => {
		const { transactions } = parseStatement(SAMPLE);

		expect(transactions.map((transaction) => transaction.date)).toEqual([
			'2026-03-02',
			'2026-03-03',
			'2026-03-03',
			'2026-03-04',
			'2026-03-05'
		]);
	});

	it('preserves the bank ordering of rows sharing one timestamp', () => {
		const sameSecond = [
			HEADER,
			'2026-03-01,16:57:28,Cheque account,"Debit order","GYM FEE 101073581 N","",-998.00,"Recreation","Sport and Fitness",""',
			'2026-03-01,16:57:28,Cheque account,"Debit order","GYM FEE 101073581 PP","",-1038.00,"Recreation","Sport and Fitness",""'
		].join('\n');

		const { transactions } = parseStatement(sameSecond);

		// The export is newest-first, so the later file row happened first.
		expect(transactions.map((transaction) => transaction.amount)).toEqual([-1038, -998]);
	});

	it('classifies flow, fees and declines', () => {
		const { transactions } = parseStatement(SAMPLE);
		const byDescription = new Map(transactions.map((t) => [t.description, t]));

		expect(byDescription.get('Salary')?.flow).toBe('income');
		expect(byDescription.get('GROCER 123456789')?.flow).toBe('expense');
		expect(byDescription.get('F')?.flow).toBe('transfer');
		expect(byDescription.get('Declined Int Card Purch')?.flow).toBe('noop');
		expect(byDescription.get('Txn Declined Fee Streaming')?.isFee).toBe(true);
		expect(byDescription.get('Txn Declined Fee Streaming')?.isDeclined).toBe(true);
	});

	it('derives a groupable merchant name', () => {
		const { transactions } = parseStatement(SAMPLE);
		const grocer = transactions.find((t) => t.description === 'GROCER 123456789');

		expect(grocer?.merchant).toBe('GROCER');
	});

	it('lists the distinct accounts in the file', () => {
		const multiAccount = [
			HEADER,
			'2026-03-05,10:00:00,Cheque account,"EFT","A","",1.00,"Other","Income Other",""',
			'2026-03-05,10:00:00,Savings,"EFT","B","",2.00,"Other","Income Other",""'
		].join('\n');

		expect(parseStatement(multiAccount).accounts).toEqual(['Cheque account', 'Savings']);
	});

	it('reports an unreadable row as an issue and keeps the rest', () => {
		const withBadRow = [
			HEADER,
			'not-a-date,10:00:00,Cheque account,"EFT","Broken","",10.00,"Other","Income Other",""',
			'2026-03-05,10:00:00,Cheque account,"EFT","Fine","",10.00,"Other","Income Other",""'
		].join('\n');

		const { transactions, issues } = parseStatement(withBadRow);

		expect(transactions).toHaveLength(1);
		expect(issues).toEqual([{ line: 2, reason: 'Unreadable date "not-a-date".' }]);
	});

	it('tolerates a missing time column', () => {
		const noTime = [
			'"Value Date","Transaction Description","Amount"',
			'2026-03-05,"Salary",25000.00'
		].join('\n');

		const { transactions } = parseStatement(noTime);

		expect(transactions[0].time).toBe('');
	});

	it('rejects a file missing a column it cannot work without', () => {
		const noAmount = ['"Value Date","Transaction Description"', '2026-03-05,"Salary"'].join('\n');

		expect(() => parseStatement(noAmount)).toThrow(StatementFormatError);
	});

	it('rejects a file that is not a statement at all', () => {
		expect(() => parseStatement('')).toThrow(StatementFormatError);
	});
});

describe('parseAmount', () => {
	it.each([
		['5000.00', 5000],
		['-1.00', -1],
		['-4.50', -4.5],
		['0.00', 0],
		['1,234.56', 1234.56],
		['1 234,56', 1234.56],
		['R 1,234,567.89', 1234567.89],
		['(99.00)', -99],
		['100-', -100],
		['5,000', 5000]
	])('reads %s as %s', (raw, expected) => {
		expect(parseAmount(raw)).toBe(expected);
	});

	it.each(['', '   ', 'n/a'])('rejects %j', (raw) => {
		expect(parseAmount(raw)).toBeNull();
	});
});
