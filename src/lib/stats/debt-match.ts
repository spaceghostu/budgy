/**
 * Which payee on the statement is paying which debt.
 *
 * A credit report and a bank statement describe the same loan from its two
 * ends, in two vocabularies: the bureau says "Example Bank Personal Loan,
 * instalment 2 500", the statement says `EXAMPLEBNK PL 00412` took 2 569 on the
 * 3rd. Unless something says those are one payment, a forecast that reads both
 * expects the money to leave twice.
 *
 * So this module pairs them — and is built to be wrong in the cheaper direction.
 * A pairing is a *suggestion* until the reader confirms it, it is shown as one,
 * and it can be refused for good. What it must never do is quietly change its
 * mind: a link the reader confirmed outranks any score, and a debt they said is
 * not on the statement is never offered a payee again.
 *
 * Read against every account's payees rather than the one on screen. A loan
 * paid from the savings account is still paid, and the forecast for the cheque
 * account needs to know that rather than expect it there.
 */

import type { CreditAccount } from '../credit/types.ts';
import type { DebtSetting } from '../state/persistence.ts';
import type { DebtCharge, Payee } from './forecast.ts';

/** What was decided about one debt. */
export interface DebtMatch {
	readonly accountId: string;
	/** The payee paying it, exactly as the statement names it, or `null`. */
	readonly merchant: string | null;
	/** How alike the two looked, 0 to 1. 1 for a link the reader made. */
	readonly score: number;
	/**
	 * - `confirmed` — the reader said so.
	 * - `suggested` — worked out here, and to be shown as an assumption.
	 * - `unlinked` — the reader said it is not on the statement.
	 * - `missing` — the reader linked it to a payee the open statement does not
	 *   have. The link is kept, since the next statement may well have it, but
	 *   nothing here is paying the debt, so it is treated as unpaid.
	 * - `none` — nothing on the statement looks like it.
	 */
	readonly origin: 'confirmed' | 'suggested' | 'unlinked' | 'missing' | 'none';
}

/** Words that say what kind of company a lender is, never which one. */
const NOISE = new Set([
	'PTY',
	'LTD',
	'LIMITED',
	'BANK',
	'SA',
	'OF',
	'THE',
	'AND',
	'FINANCE',
	'FINANCIAL',
	'SERVICES',
	'LOAN',
	'LOANS',
	'HOME',
	'VEHICLE',
	'CARD',
	'CREDIT',
	'ACCOUNT',
	'PERSONAL'
]);

/**
 * Lenders the bank and the bureau spell differently.
 *
 * Short on purpose. Each entry is a claim that two spellings are one company,
 * and a wrong one hides a real instalment — so it holds only the pairs that no
 * amount of token matching would find.
 */
const ALIASES: readonly (readonly [RegExp, string])[] = [
	[/\bFIRST NATIONAL\b/g, 'FNB'],
	[/\bSTD\b/g, 'STANDARD'],
	[/\bSBSA\b/g, 'STANDARD'],
	[/\bWFS\b/g, 'WOOLWORTHS']
];

/** A prefix this long counts as the same word — bank descriptions truncate. */
const MIN_PREFIX = 4;

const NAME_WEIGHT = 0.6;
const AMOUNT_WEIGHT = 0.3;
const SIGNAL_WEIGHT = 0.1;

/** Below this the names are not the same lender, whatever the amounts say. */
const MIN_NAME_SCORE = 0.5;
const MIN_SCORE = 0.6;

/** A debit order within this of the instalment is the instalment. */
const AMOUNT_EXACT = 0.05;
/** Past this it is a different product — fees and cover do not add a fifth. */
const AMOUNT_LIMIT = 0.2;
/** What an amount is worth when it cannot say anything either way. */
const AMOUNT_NEUTRAL = 0.5;

/**
 * A lender's name as the words that identify it.
 *
 * Upper-cased, stripped of punctuation and digits, and of the words every
 * lender shares, so "Example Bank (Pty) Ltd" and `EXAMPLE 004123` meet.
 */
export function normaliseCreditor(name: string): readonly string[] {
	const cleaned = ALIASES.reduce(
		(text, [pattern, canonical]) => text.replace(pattern, canonical),
		name.toUpperCase().replace(/[^A-Z ]+/g, ' ')
	);

	return [...new Set(cleaned.split(/\s+/).filter((token) => token !== '' && !NOISE.has(token)))];
}

/**
 * Pair each debt with the payee paying it.
 *
 * @param payees The statement's payees across every account. Only money out is
 * considered — nothing coming in pays a debt.
 * @returns One entry per account, in the order the accounts were given.
 */
export function matchDebts(
	accounts: readonly CreditAccount[],
	payees: readonly Payee[],
	settings: Readonly<Record<string, DebtSetting>>
): readonly DebtMatch[] {
	const outgoingNames = new Set(
		payees.filter((payee) => payee.flow === 'expense').map((payee) => payee.merchant)
	);
	const decided = new Map<string, DebtMatch>();
	const taken = new Set<string>();

	// The reader's word first: it settles the debt and takes the payee off the
	// table, so no other debt can be suggested the same debit order.
	for (const account of accounts) {
		const link = settings[account.id]?.link;
		if (link === undefined) continue;

		if (link === null) {
			decided.set(account.id, {
				accountId: account.id,
				merchant: null,
				score: 0,
				origin: 'unlinked'
			});
			continue;
		}

		decided.set(account.id, {
			accountId: account.id,
			merchant: link,
			score: 1,
			origin: outgoingNames.has(link) ? 'confirmed' : 'missing'
		});
		taken.add(link);
	}

	const open = accounts.filter((account) => !decided.has(account.id));
	const outgoing = payees.filter((payee) => payee.flow === 'expense' && !taken.has(payee.merchant));

	// Best pairing first, and each payee to one debt only: two loans at one
	// lender have two debit orders, and the better fit should keep its own.
	const pairs = open
		.flatMap((account) =>
			outgoing.map((payee) => ({ account, payee, score: scorePair(account, payee) }))
		)
		.filter((pair) => pair.score >= MIN_SCORE)
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.account.id.localeCompare(b.account.id) ||
				a.payee.merchant.localeCompare(b.payee.merchant)
		);

	for (const { account, payee, score } of pairs) {
		if (decided.has(account.id) || taken.has(payee.merchant)) continue;

		decided.set(account.id, {
			accountId: account.id,
			merchant: payee.merchant,
			score,
			origin: 'suggested'
		});
		taken.add(payee.merchant);
	}

	return accounts.map(
		(account) =>
			decided.get(account.id) ?? { accountId: account.id, merchant: null, score: 0, origin: 'none' }
	);
}

/** How much one debt and one payee look like the same payment, 0 when they do not. */
function scorePair(account: CreditAccount, payee: Payee): number {
	const name = nameScore(normaliseCreditor(account.creditor), normaliseCreditor(payee.merchant));
	if (name < MIN_NAME_SCORE) return 0;

	const signal = payee.isDebitOrder || payee.category === 'Debt Repayment' ? 1 : 0;
	const amount = amountScore(account, payee.amount, signal === 1);
	// An amount that rules the pair out does so however well the names agree:
	// it is another product at the same lender, or the bank's own monthly fee.
	if (amount === 0) return 0;

	return NAME_WEIGHT * name + AMOUNT_WEIGHT * amount + SIGNAL_WEIGHT * signal;
}

/** The share of the shorter name's words the other one has. */
function nameScore(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) return 0;

	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
	const shared = shorter.filter((token) => longer.some((other) => sameWord(token, other)));

	return shared.length / shorter.length;
}

function sameWord(a: string, b: string): boolean {
	if (a === b) return true;

	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
	return shorter.length >= MIN_PREFIX && longer.startsWith(shorter);
}

/**
 * How well what the payee takes fits the instalment.
 *
 * Only a loan's instalment is a fixed thing to be held to. A card or a facility
 * is reported with a minimum that the reader may pay several times over, so for
 * those — and for any account the bureau gave no instalment for — an amount
 * that is off does not rule a match out.
 *
 * Provided the payee looks like a repayment at all. A lender is usually also a
 * bank, and "Example Bank Credit Card" shares its only identifying word with
 * "Example Bank Monthly Account Fee". With nothing to say the amount fits, it
 * takes a debit order or the bank's own "Debt Repayment" filing to pair them.
 */
function amountScore(account: CreditAccount, paid: number, looksLikeRepayment: boolean): number {
	const lenient = looksLikeRepayment ? AMOUNT_NEUTRAL : 0;
	if (account.instalment <= 0) return lenient;

	const off = Math.abs(paid - account.instalment) / account.instalment;
	const fit =
		off <= AMOUNT_EXACT
			? 1
			: off >= AMOUNT_LIMIT
				? 0
				: (AMOUNT_LIMIT - off) / (AMOUNT_LIMIT - AMOUNT_EXACT);

	return account.kind === 'loan' ? fit : Math.max(fit, lenient);
}

/** Where an instalment is placed when nobody has said which day it leaves on. */
const DEFAULT_PAYMENT_DAY = 1;

/**
 * The debts as the forecast takes them.
 *
 * A suggested pairing counts as a link here, on purpose. The two ways of being
 * wrong are not equal: a suggestion wrongly taken leaves one instalment out, on
 * a row the debts page marks as assumed; a suggestion wrongly ignored expects a
 * payment twice and tells the reader they are short when they are not.
 *
 * A debt the bureau gave no instalment for has nothing to expect, and is left
 * to the payee's own history.
 */
export function toDebtCharges(
	accounts: readonly CreditAccount[],
	matches: readonly DebtMatch[],
	settings: Readonly<Record<string, DebtSetting>>
): readonly DebtCharge[] {
	// A link to a payee this statement does not have pays nothing here.
	const linked = new Map(
		matches.map((match) => [match.accountId, match.origin === 'missing' ? null : match.merchant])
	);

	return accounts
		.filter((account) => account.instalment > 0)
		.map((account) => ({
			accountId: account.id,
			name: account.creditor,
			amount: account.instalment,
			day: settings[account.id]?.paymentDay ?? DEFAULT_PAYMENT_DAY,
			linkedMerchant: linked.get(account.id) ?? null
		}));
}
