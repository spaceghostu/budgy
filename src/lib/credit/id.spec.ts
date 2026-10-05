import { describe, expect, it } from 'vitest';
import { creditAccountId } from './id.ts';

const loan = {
	creditor: 'Example Bank',
	kind: 'loan',
	opened: '2023-04-01',
	accountNumber: '4000111122223333'
} as const;

describe('creditAccountId', () => {
	it('gives the same account the same id every time', () => {
		expect(creditAccountId(loan)).toBe(creditAccountId({ ...loan }));
		expect(creditAccountId(loan)).toMatch(/^[0-9a-f]{16}$/);
	});

	it('reads through spacing and case in the lender and the number', () => {
		const respelled = {
			...loan,
			creditor: '  example   bank ',
			accountNumber: '4000 1111 2222 3333'
		};

		expect(creditAccountId(respelled)).toBe(creditAccountId(loan));
	});

	it('keeps two accounts at one lender apart by their numbers', () => {
		const second = { ...loan, accountNumber: '4000111122224444' };

		expect(creditAccountId(second)).not.toBe(creditAccountId(loan));
	});

	it('is shaped by the last four digits alone, so the rest cannot be recovered from it', () => {
		const sameTail = { ...loan, accountNumber: '9999888877773333' };

		expect(creditAccountId(sameTail)).toBe(creditAccountId(loan));
		expect(creditAccountId(loan)).not.toContain(loan.accountNumber);
	});

	it('still names an account whose number the bureau left out', () => {
		const masked = { ...loan, accountNumber: '' };

		expect(creditAccountId(masked)).toMatch(/^[0-9a-f]{16}$/);
		expect(creditAccountId(masked)).not.toBe(creditAccountId({ ...masked, kind: 'card' }));
	});
});
