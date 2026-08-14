import { describe, expect, it } from 'vitest';
import { makeTransaction } from '../testing/transaction.ts';
import { mergeStatements } from './merge.ts';
import type { PdfAccount, PdfStatement } from './pdf-rows.ts';

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

function statement(...accounts: PdfAccount[]): PdfStatement {
	return { accounts, from: '2025-01-01', to: '2025-01-31', issues: [] };
}

const TRANSACTION_ACCOUNT = account('Transaction Account', '12345678901', [
	['2025-01-02', 'GROCER', -250, 750],
	['2025-01-03', 'Salary', 5000, 5750],
	['2025-01-04', 'Inter account transfer to account...6523', -1000, 4750]
]);

describe('mergeStatements', () => {
	it('uses the CSV alone when there is no PDF', () => {
		const csv = [makeTransaction({ date: '2025-01-02', amount: -250, account: 'Cheque account' })];
		const merged = mergeStatements(null, csv);

		expect(merged.transactions).toEqual(csv);
		expect(merged.accounts).toEqual(['Cheque account']);
		expect(merged.enrichedAccount).toBeNull();
	});

	it('uses the PDF alone when there is no CSV', () => {
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), []);

		expect(merged.transactions).toHaveLength(3);
		expect(merged.enrichedAccount).toBeNull();
		expect(merged.transactions.every((transaction) => transaction.source === 'pdf')).toBe(true);
	});

	it('carries the balance the PDF printed on every row', () => {
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), []);

		expect(merged.transactions.map((transaction) => transaction.balance)).toEqual([
			750, 5750, 4750
		]);
	});

	it('reads own-account movement from the wording when there is no category', () => {
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), []);

		expect(merged.transactions[2].flow).toBe('transfer');
	});

	it('folds the CSV categories onto the matching PDF rows', () => {
		const csv = [
			makeTransaction({
				date: '2025-01-02',
				amount: -250,
				description: 'GROCER',
				bankCategory: 'Food and Drink',
				category: 'Groceries',
				type: 'Card on file',
				time: '14:30:00'
			})
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);
		const grocer = merged.transactions[0];

		expect(grocer.bankCategory).toBe('Food and Drink');
		expect(grocer.type).toBe('Card on file');
		expect(grocer.time).toBe('14:30:00');
		expect(grocer.source).toBe('both');
		// The PDF stays the record for the numbers.
		expect(grocer.balance).toBe(750);
		expect(grocer.amount).toBe(-250);
	});

	it('names the PDF account the CSV turned out to describe', () => {
		const csv = [makeTransaction({ date: '2025-01-02', amount: -250, description: 'GROCER' })];
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.enrichedAccount).toBe('Transaction Account');
		expect(merged.matched).toBe(1);
	});

	it('picks the account whose rows actually line up, not one named alike', () => {
		const card = account('Credit Card Account', '17000000001', [
			['2025-01-09', 'ONLINE SHOP', -99, -99]
		]);
		const csv = [makeTransaction({ date: '2025-01-09', amount: -99, description: 'ONLINE SHOP' })];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT, card), csv);

		expect(merged.enrichedAccount).toBe('Credit Card Account');
	});

	it('leaves the other accounts uncategorised rather than mismatching them', () => {
		const savings = account('Savings', '99999999999', [['2025-01-02', 'Interest', 5, 105]]);
		const csv = [
			makeTransaction({
				date: '2025-01-02',
				amount: -250,
				description: 'GROCER',
				bankCategory: 'Food and Drink'
			})
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT, savings), csv);
		const interest = merged.transactions.find((t) => t.description === 'Interest');

		expect(interest?.bankCategory).toBe('Uncategorised');
		expect(interest?.source).toBe('pdf');
	});

	it('gives each of two same-day, same-amount charges its own category', () => {
		const twice = account('Transaction Account', '12345678901', [
			['2025-01-02', 'SHOP A', -50, 950],
			['2025-01-02', 'SHOP B', -50, 900]
		]);
		const csv = [
			makeTransaction({
				date: '2025-01-02',
				amount: -50,
				description: 'SHOP B',
				bankCategory: 'Home'
			}),
			makeTransaction({
				date: '2025-01-02',
				amount: -50,
				description: 'SHOP A',
				bankCategory: 'Transport'
			})
		];

		const merged = mergeStatements(statement(twice), csv);

		expect(merged.transactions.map((t) => [t.description, t.bankCategory])).toEqual([
			['SHOP A', 'Transport'],
			['SHOP B', 'Home']
		]);
	});

	it('matches a card purchase that settled a day after it happened', () => {
		// The CSV dates a purchase when it happened; the certified statement
		// dates it when it settled, which for card transactions is usually later.
		const csv = [
			makeTransaction({
				date: '2025-01-01',
				amount: -250,
				description: 'GROCER',
				bankCategory: 'Food and Drink'
			})
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.transactions[0].bankCategory).toBe('Food and Drink');
		expect(merged.transactions[0].date).toBe('2025-01-02');
	});

	it('gives up once the dates are further apart than settlement explains', () => {
		const csv = [makeTransaction({ date: '2024-11-20', amount: -250, description: 'GROCER' })];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.transactions[0].source).toBe('pdf');
		expect(merged.enrichedAccount).toBeNull();
	});

	it('prefers the row that settled soonest when several could fit', () => {
		const twice = account('Transaction Account', '12345678901', [['2025-01-05', 'SHOP', -50, 950]]);
		const csv = [
			makeTransaction({
				date: '2025-01-01',
				amount: -50,
				description: 'SHOP',
				bankCategory: 'Home'
			}),
			makeTransaction({
				date: '2025-01-04',
				amount: -50,
				description: 'SHOP',
				bankCategory: 'Transport'
			})
		];

		expect(mergeStatements(statement(twice), csv).transactions[0].bankCategory).toBe('Transport');
	});

	it('lets identical wording beat a closer date', () => {
		const one = account('Transaction Account', '12345678901', [['2025-01-05', 'SHOP B', -50, 950]]);
		const csv = [
			makeTransaction({
				date: '2025-01-01',
				amount: -50,
				description: 'SHOP B',
				bankCategory: 'Home'
			}),
			makeTransaction({
				date: '2025-01-04',
				amount: -50,
				description: 'SHOP A',
				bankCategory: 'Transport'
			})
		];

		expect(mergeStatements(statement(one), csv).transactions[0].bankCategory).toBe('Home');
	});

	it('reports PDF rows the CSV could not explain', () => {
		const csv = [makeTransaction({ date: '2025-01-02', amount: -250, description: 'GROCER' })];
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.issues.map((issue) => issue.reason).join(' ')).toContain('no match in the CSV');
	});

	it('reports CSV rows that are not in the PDF, rather than slipping them in', () => {
		const csv = [
			makeTransaction({ date: '2025-01-02', amount: -250, description: 'GROCER' }),
			makeTransaction({ date: '2025-01-09', amount: -75, description: 'MYSTERY' })
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.transactions).toHaveLength(3);
		expect(merged.issues.map((issue) => issue.reason).join(' ')).toContain(
			'no matching line in the PDF'
		);
	});

	it('says nothing about unmatched declined rows, which move no money', () => {
		const csv = [
			makeTransaction({ date: '2025-01-02', amount: -250, description: 'GROCER' }),
			makeTransaction({ date: '2025-01-09', amount: 0, description: 'Declined Int Card Purch' })
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);

		expect(merged.issues.map((issue) => issue.reason).join(' ')).not.toContain('no matching line');
	});

	it('passes the PDF parser’s own issues through', () => {
		const withIssue: PdfStatement = {
			...statement(TRANSACTION_ACCOUNT),
			issues: [{ line: 1, reason: 'something did not add up' }]
		};

		expect(mergeStatements(withIssue, []).issues[0].reason).toBe('something did not add up');
	});

	it('interleaves the accounts into one chronological list', () => {
		// Accounts are parsed one after another. Left concatenated, viewing them
		// all at once would run through one account's dates and then jump back.
		const savings = account('Savings', '99999999999', [
			['2025-01-01', 'Opening', 100, 100],
			['2025-01-05', 'Interest', 5, 105]
		]);

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT, savings), []);

		expect(merged.transactions.map((t) => t.date)).toEqual([
			'2025-01-01',
			'2025-01-02',
			'2025-01-03',
			'2025-01-04',
			'2025-01-05'
		]);
	});

	it('leaves timestamps never running backwards, so a chart cannot double back', () => {
		const savings = account('Savings', '99999999999', [
			['2025-01-01', 'Opening', 100, 100],
			['2025-01-05', 'Interest', 5, 105]
		]);

		const stamps = mergeStatements(statement(TRANSACTION_ACCOUNT, savings), []).transactions.map(
			(t) => t.timestamp
		);

		expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
	});

	it('numbers rows so that nothing downstream needs to re-sort them', () => {
		const savings = account('Savings', '99999999999', [['2025-01-02', 'Interest', 5, 105]]);
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT, savings), []);

		expect(merged.transactions.map((t) => t.fileOrder)).toEqual([0, 1, 2, 3]);
	});

	it('keeps same-day rows in the order the statement printed them', () => {
		// Their balances only add up in this order, so it has to survive sorting.
		const sameDay = account('Transaction Account', '12345678901', [
			['2025-01-02', 'FIRST', -100, 900],
			['2025-01-02', 'SECOND', -100, 800],
			['2025-01-02', 'THIRD', -100, 700]
		]);

		const merged = mergeStatements(statement(sameDay), []);

		expect(merged.transactions.map((t) => t.description)).toEqual(['FIRST', 'SECOND', 'THIRD']);
		expect(merged.transactions.map((t) => t.balance)).toEqual([900, 800, 700]);
	});

	it('does not adopt the CSV timestamp, which can precede the day it settled', () => {
		const csv = [
			makeTransaction({
				date: '2025-01-01',
				time: '23:50:00',
				amount: -250,
				description: 'GROCER',
				bankCategory: 'Food and Drink'
			})
		];

		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), csv);
		const grocer = merged.transactions[0];

		// The clock time is kept for display; the ordering stays the PDF's.
		expect(grocer.time).toBe('23:50:00');
		expect(grocer.date).toBe('2025-01-02');
		expect(grocer.timestamp).toBeGreaterThanOrEqual(new Date('2025-01-02T00:00:00').getTime());
	});

	it('keeps each account’s rows in the order its balance chain requires', () => {
		const merged = mergeStatements(statement(TRANSACTION_ACCOUNT), []);

		expect(merged.transactions.map((t) => t.date)).toEqual([
			'2025-01-02',
			'2025-01-03',
			'2025-01-04'
		]);
	});

	it('lists every account in the PDF', () => {
		const savings = account('Savings', '99999999999', [['2025-01-02', 'Interest', 5, 105]]);

		expect(mergeStatements(statement(TRANSACTION_ACCOUNT, savings), []).accounts).toEqual([
			'Transaction Account',
			'Savings'
		]);
	});
});
