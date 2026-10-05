import type { CreditAccount } from '../credit/types.ts';

/**
 * Test-only factory for credit accounts.
 *
 * The sibling of {@link makeTransaction}, for the same reason: a field added to
 * {@link CreditAccount} should be one edit here rather than one per spec.
 *
 * Values are deliberately generic — never anything from a real report.
 */
let nextAccount = 0;

export function makeCreditAccount(overrides: Partial<CreditAccount> = {}): CreditAccount {
	const order = nextAccount++;

	return {
		id: `debt${order}`,
		creditor: 'Example Lender',
		kind: 'loan',
		balance: 10_000,
		instalment: 500,
		arrears: 0,
		status: 'current',
		opened: '2024-01-01',
		limit: null,
		...overrides
	};
}

/** Reset the shared counter so ids stay stable within a spec file. */
export function resetCreditAccountIds(): void {
	nextAccount = 0;
}
