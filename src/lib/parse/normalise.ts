import type { Flow } from '../types.ts';

/**
 * Categories the bank itself marks as "not real spending" — money moving
 * between the owner's own accounts.
 */
const TRANSFER_CATEGORY = 'not for financial analyser';

/**
 * Transaction types that move money between the owner's own accounts. The bank
 * sometimes files these under `Uncategorised`, so the type is checked too.
 */
const TRANSFER_TYPES: ReadonlySet<string> = new Set([
	're-direct',
	'redirect',
	'transfer',
	'scheduled transfer',
	'internal transfer'
]);

/**
 * Descriptions that mean own-account movement.
 *
 * A PDF statement has no category or type column, so for rows that came only
 * from the PDF the wording is the only signal there is — and with six accounts
 * on one statement, missing these would count every internal transfer as both
 * income and spending.
 */
const TRANSFER_DESCRIPTIONS = [/^inter account transfer/i, /^transfer (to|from) account/i];

const FEE_CATEGORY = 'fees and interest';
const FEE_TYPE = 'fee';

/** Wording the bank uses for its own charges, for rows with no category. */
const FEE_DESCRIPTIONS = [/\bfees?\b/i, /^interest charged/i, /^interest earned/i];

/** Trailing `123.45 USD` style suffixes the bank appends to card purchases. */
const TRAILING_AMOUNT = /\s+[\d\s,]+\.\d{2}\s+[A-Za-z]{3}\s*$/;

/** A token that is a reference number rather than part of a name. */
const LEADING_DIGIT = /^\d/;
const LONG_DIGIT_RUN = /\d{4,}/;
const DIGIT_RUN = /\d{3,}/g;

/** Punctuation left dangling once reference numbers are stripped. */
const TRAILING_PUNCTUATION = /[\s\-–—_/*.,:;]+$/;
const LEADING_PUNCTUATION = /^[\s\-–—_/*.,:;]+/;

const DECLINED = /declin/i;

/**
 * The fields classification looks at.
 *
 * `bankCategory` is the bank's own broad heading rather than the sub-category
 * this app files by: `Not for Financial Analyser` and `Fees and Interest` are
 * stated at that level, so that is the level read here.
 *
 * It and `type` are empty for rows that came from a PDF, which has no such
 * columns; `description` is always present. Every rule below therefore has to
 * work from the description alone when it must.
 */
export interface Classifiable {
	readonly amount: number;
	readonly type: string;
	readonly bankCategory: string;
	readonly description: string;
}

export function normaliseType(type: string): string {
	return type.trim().toLowerCase();
}

export function normaliseCategory(category: string): string {
	return category.trim().toLowerCase();
}

export function isTransfer(row: Classifiable): boolean {
	return (
		normaliseCategory(row.bankCategory) === TRANSFER_CATEGORY ||
		TRANSFER_TYPES.has(normaliseType(row.type)) ||
		TRANSFER_DESCRIPTIONS.some((pattern) => pattern.test(row.description))
	);
}

export function isFee(row: Classifiable): boolean {
	if (normaliseCategory(row.bankCategory) === FEE_CATEGORY) return true;
	if (normaliseType(row.type) === FEE_TYPE) return true;

	// Only fall back to the wording when the bank told us nothing else, so a
	// categorised purchase from a merchant called "… Fees" stays a purchase.
	const uncategorised =
		row.bankCategory === '' || normaliseCategory(row.bankCategory) === 'uncategorised';
	return uncategorised && FEE_DESCRIPTIONS.some((pattern) => pattern.test(row.description));
}

export function isDeclined(description: string): boolean {
	return DECLINED.test(description);
}

export function classifyFlow(row: Classifiable): Flow {
	if (row.amount === 0) return 'noop';
	if (isTransfer(row)) return 'transfer';
	return row.amount > 0 ? 'income' : 'expense';
}

/**
 * Reduce a bank description to a merchant name that groups sensibly.
 *
 * Reference numbers, card sequence numbers and trailing foreign-currency
 * amounts vary per transaction and would otherwise split one merchant into
 * dozens of one-off buckets.
 *
 * `"TELCO 0123456789 XX000000"` becomes `"TELCO"`.
 */
export function toMerchant(description: string): string {
	const trimmed = description.trim();
	if (trimmed === '') return 'Unknown';

	const withoutAmount = trimmed.replace(TRAILING_AMOUNT, '');
	const tokens = withoutAmount.split(/\s+/).filter((token) => token !== '');
	const kept = tokens.filter((token) => !isReferenceToken(token));

	const candidate = kept.length > 0 ? kept.join(' ') : stripDigits(tokens[0] ?? '');
	const cleaned = candidate.replace(TRAILING_PUNCTUATION, '').replace(LEADING_PUNCTUATION, '');

	return cleaned === '' ? withoutAmount : cleaned;
}

function isReferenceToken(token: string): boolean {
	return LEADING_DIGIT.test(token) || LONG_DIGIT_RUN.test(token);
}

function stripDigits(token: string): string {
	return token.replace(DIGIT_RUN, '');
}
