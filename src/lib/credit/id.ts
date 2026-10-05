/**
 * A stable name for a credit account that is not its number.
 *
 * The reader's own settings — an interest rate, which debit order pays it —
 * have to be kept against an account from one report to the next, and the only
 * thing that reliably identifies an account is its number. So the last four
 * digits of it go into a hash and the number is then thrown away.
 *
 * Four digits, not all of them, because this hash is not a secret-keeper: it is
 * fast, the lender and the date beside it are stored in the clear, and a full
 * number hashed this way could be recovered by trying every candidate. Four
 * digits are what a statement prints anyway, and with the lender, the kind and
 * the opening date they are enough to tell a household's accounts apart.
 */

import type { CreditKind } from './types.ts';

export interface CreditIdentity {
	readonly creditor: string;
	readonly kind: CreditKind;
	/** `YYYY-MM-DD`, or blank. */
	readonly opened: string;
	/** Only its last four digits are used. Blank where the bureau omits it. */
	readonly accountNumber: string;
}

/** How much of an account number is allowed to shape the id. */
const TAIL_DIGITS = 4;

const FNV_PRIME = 0x01000193;
const SEEDS = [0x811c9dc5, 0x9747b28c] as const;

/**
 * Sixteen hex characters that are the same for the same account every time.
 *
 * Synchronous on purpose — `crypto.subtle` would make reading a report async
 * all the way up for no gain. This is an identity, not a secret: two 32-bit
 * FNV-1a passes are ample to keep a household's accounts apart.
 *
 * Two accounts can still come out the same — one lender, one kind, one opening
 * date, and numbers the bureau masked. Whatever reads a report has to tell
 * those apart itself, and a stored report with a repeated id is refused.
 */
export function creditAccountId(identity: CreditIdentity): string {
	const text = [
		identity.creditor.trim().toUpperCase().replace(/\s+/g, ' '),
		identity.kind,
		identity.opened,
		identity.accountNumber.replace(/\D/g, '').slice(-TAIL_DIGITS)
	].join('|');

	return SEEDS.map((seed) => fnv1a(text, seed).toString(16).padStart(8, '0')).join('');
}

function fnv1a(text: string, seed: number): number {
	let hash = seed;

	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, FNV_PRIME);
	}

	return hash >>> 0;
}
