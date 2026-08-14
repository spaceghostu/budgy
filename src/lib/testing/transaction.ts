import type { Transaction } from '../types.ts';

/**
 * Test-only factory for transactions.
 *
 * Nothing in the app imports this, so it never reaches the bundle. It exists so
 * that adding a field to {@link Transaction} does not mean editing the same
 * builder in four spec files.
 *
 * Values are deliberately generic — never anything from a real statement.
 */
let nextOrder = 0;

export function makeTransaction(
	overrides: Partial<Transaction> & Pick<Transaction, 'date' | 'amount'>
): Transaction {
	const fileOrder = overrides.fileOrder ?? nextOrder++;
	const time = overrides.time ?? '12:00:00';

	return {
		id: `t${fileOrder}`,
		time,
		timestamp: new Date(`${overrides.date}T${time}`).getTime(),
		account: 'Cheque account',
		accountNumber: '',
		type: 'Card on file',
		description: 'Something',
		counterparty: '',
		category: 'Groceries',
		bankCategory: 'Food and Drink',
		note: '',
		merchant: 'Something',
		flow: overrides.amount === 0 ? 'noop' : overrides.amount > 0 ? 'income' : 'expense',
		isFee: false,
		isDeclined: false,
		balance: null,
		source: 'csv',
		...overrides,
		fileOrder
	};
}

/** Reset the shared counter so ids stay stable within a spec file. */
export function resetTransactionIds(): void {
	nextOrder = 0;
}
