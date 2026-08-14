import { describe, expect, it } from 'vitest';
import {
	classifyFlow,
	isDeclined,
	isFee,
	isTransfer,
	toMerchant,
	type Classifiable
} from './normalise.ts';

describe('toMerchant', () => {
	it('keeps a clean merchant name unchanged', () => {
		expect(toMerchant('Fresh Mart24')).toBe('Fresh Mart24');
	});

	it('strips reference numbers that would split one merchant into many', () => {
		expect(toMerchant('TELCO 0123456789 XX000000')).toBe('TELCO');
		expect(toMerchant('INSURER 0000000000-100000000')).toBe('INSURER');
		expect(toMerchant('LENDER  100000-1000000000000')).toBe('LENDER');
	});

	it('strips a trailing foreign-currency amount', () => {
		expect(toMerchant('ACME* SUB ACME.COM 115.00 USD')).toBe('ACME* SUB ACME.COM');
		expect(toMerchant('PAYWALLET *SHOP 124.74 ZAR')).toBe('PAYWALLET *SHOP');
	});

	it('keeps digits that are part of the brand', () => {
		expect(toMerchant('Mart24 Delivery')).toBe('Mart24 Delivery');
	});

	it('trims punctuation left behind by a stripped reference', () => {
		expect(toMerchant('Prepaid Water/Electricity - Meter  10000000000')).toBe(
			'Prepaid Water/Electricity - Meter'
		);
	});

	it('falls back to the de-numbered first token when every token is a reference', () => {
		expect(toMerchant('FINCO/ABC10000000001   010100')).toBe('FINCO/ABC');
	});

	it('labels an empty description', () => {
		expect(toMerchant('   ')).toBe('Unknown');
	});
});

/** The fields classification reads. Defaults stand in for a PDF-only row. */
function row(overrides: Partial<Classifiable> = {}): Classifiable {
	return { amount: -100, type: '', bankCategory: '', description: '', ...overrides };
}

describe('isTransfer', () => {
	it('detects the category the bank reserves for own-account movement', () => {
		expect(isTransfer(row({ type: 'Transfer', bankCategory: 'Not for Financial Analyser' }))).toBe(
			true
		);
	});

	it('detects transfer types the bank filed as uncategorised', () => {
		expect(isTransfer(row({ type: 'Re-direct', bankCategory: 'Uncategorised' }))).toBe(true);
		expect(isTransfer(row({ type: 'Scheduled transfer', bankCategory: 'Uncategorised' }))).toBe(
			true
		);
	});

	it('ignores casing differences in the type column', () => {
		expect(isTransfer(row({ type: 'SCHEDULED TRANSFER', bankCategory: 'Uncategorised' }))).toBe(
			true
		);
	});

	it('detects own-account movement by wording alone, for rows from a PDF', () => {
		// A PDF has no type or category column; the description is all there is.
		expect(isTransfer(row({ description: 'Inter account transfer to account...6523 Cc' }))).toBe(
			true
		);
	});

	it('leaves ordinary spending alone', () => {
		expect(isTransfer(row({ type: 'Card on file', bankCategory: 'Food and Drink' }))).toBe(false);
	});
});

describe('isFee', () => {
	it('detects fees by category even when the type is a purchase type', () => {
		expect(isFee(row({ type: 'Card on file', bankCategory: 'Fees and Interest' }))).toBe(true);
	});

	it('detects fees by type', () => {
		expect(isFee(row({ type: 'Fee', bankCategory: 'Uncategorised' }))).toBe(true);
	});

	it('detects fees by wording for rows from a PDF', () => {
		expect(isFee(row({ description: 'PayShap payment fee' }))).toBe(true);
		expect(isFee(row({ description: 'Interest Charged at 20.38%' }))).toBe(true);
		expect(isFee(row({ description: 'Monthly facility fee' }))).toBe(true);
	});

	it('does not let wording override a category the bank did supply', () => {
		// A merchant whose name mentions fees is still a purchase.
		expect(isFee(row({ description: 'NO FEES BUTCHERY', bankCategory: 'Food and Drink' }))).toBe(
			false
		);
	});

	it('leaves ordinary spending alone', () => {
		expect(isFee(row({ type: 'Apple Pay', bankCategory: 'Transport' }))).toBe(false);
	});
});

describe('isDeclined', () => {
	it('flags both the declined attempt and the fee charged for it', () => {
		expect(isDeclined('Declined Int Card Purch')).toBe(true);
		expect(isDeclined('Txn Declined Fee Some Service')).toBe(true);
	});

	it('leaves successful transactions alone', () => {
		expect(isDeclined('Fresh Mart24')).toBe(false);
	});
});

describe('classifyFlow', () => {
	it('treats a zero-amount row as a no-op', () => {
		expect(classifyFlow(row({ amount: 0, bankCategory: 'Miscellaneous' }))).toBe('noop');
	});

	it('treats own-account movement as a transfer regardless of sign', () => {
		expect(
			classifyFlow(
				row({ amount: 6000, type: 'Transfer', bankCategory: 'Not for Financial Analyser' })
			)
		).toBe('transfer');
		expect(
			classifyFlow(
				row({ amount: -6000, type: 'Scheduled transfer', bankCategory: 'Uncategorised' })
			)
		).toBe('transfer');
	});

	it('splits the rest by sign', () => {
		expect(classifyFlow(row({ amount: 250, type: 'EFT', bankCategory: 'Other' }))).toBe('income');
		expect(classifyFlow(row({ amount: -250, type: 'EFT', bankCategory: 'Other' }))).toBe('expense');
	});
});
