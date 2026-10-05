/**
 * Reading Finance365's credit report, and keeping almost none of it.
 *
 * This is the one place the whole answer is ever held. What Finance365 sends is
 * built for a page that shows the reader their own file — it carries full
 * account numbers, and the envelope around it sits beside an identity number
 * and a phone number — and none of that has any business outliving this
 * function. So it reads the six fields it needs off each account, hashes the
 * last four digits of the account number into an id, and returns a
 * {@link CreditReport}. Nothing else is copied, logged or stored.
 *
 * The field names are Finance365's own, read off the dashboard that draws
 * them: an account is `provider_name`, `account_no`, `open_balance`,
 * `current_balance`, `overdue_amount` and `instalment_amount`, under
 * `data.latest.accounts`. Anything it does not say — the kind of borrowing,
 * when an account was opened — is worked out or left blank rather than
 * invented.
 */

import { MAX_AMOUNT } from '../state/persistence.ts';
import { creditAccountId } from './id.ts';
import type { CreditAccount, CreditKind, CreditReport, CreditStatus } from './types.ts';

/** A report that could not be read, already worded for the reader. */
export class CreditFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CreditFormatError';
	}
}

const NOT_A_REPORT =
	'That does not look like a Finance365 credit report. Copy the whole response to the credit-report request from the Network tab.';

/** No lender's name is longer; anything past this is not a name. */
const MAX_CREDITOR_LENGTH = 80;

/** The only status Finance365 gives a report it has finished drawing. */
const COMPLETE = 'Complete';

/**
 * A pasted response, read the same way a fetched one is.
 *
 * For a browser that cannot reach Finance365 directly, or a reader who would
 * rather not hand over a token: the response copied out of the Network tab is
 * the same JSON.
 */
export function importCreditReport(text: string, today: string): CreditReport {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new CreditFormatError(NOT_A_REPORT);
	}

	return parseCreditReport(json, today);
}

/**
 * Reduce Finance365's answer to the figures a plan is made of.
 *
 * Accepts the whole response, its `data`, or the report alone, since a reader
 * copying from devtools may take any of the three.
 *
 * @param today `YYYY-MM-DD`, used only when the response does not date itself.
 */
export function parseCreditReport(json: unknown, today: string): CreditReport {
	const root = asRecord(json);
	if (root === null) throw new CreditFormatError(NOT_A_REPORT);

	const data = asRecord(root.data) ?? root;
	const latest = 'latest' in data ? data.latest : data;
	if (latest === null || latest === undefined) {
		throw new CreditFormatError(
			'Finance365 has no credit report for you yet. Open its dashboard once so it draws one, then try again.'
		);
	}

	const report = asRecord(latest);
	if (report === null || !Array.isArray(report.accounts)) throw new CreditFormatError(NOT_A_REPORT);

	if (typeof report.status === 'string' && report.status !== COMPLETE) {
		throw new CreditFormatError(
			'Finance365 is still preparing your report. Give it a minute and try again.'
		);
	}

	return {
		reportDate: toIsoDate(data.latestDate) ?? today,
		score: toScore(report.score),
		accounts: distinct(report.accounts.map(toAccount).filter((account) => account !== null))
	};
}

/** One account, or `null` for a row that is not one. */
function toAccount(row: unknown): CreditAccount | null {
	const account = asRecord(row);
	if (account === null) return null;

	const creditor =
		typeof account.provider_name === 'string' && account.provider_name.trim() !== ''
			? account.provider_name.trim().slice(0, MAX_CREDITOR_LENGTH)
			: 'Unnamed lender';
	const kind = inferKind(creditor);
	const arrears = toAmount(account.overdue_amount);

	return {
		id: creditAccountId({
			creditor,
			kind,
			opened: '',
			accountNumber:
				typeof account.account_no === 'string' || typeof account.account_no === 'number'
					? `${account.account_no}`
					: ''
		}),
		creditor,
		kind,
		balance: toAmount(account.current_balance),
		instalment: toAmount(account.instalment_amount),
		arrears,
		status: toStatus(arrears),
		opened: '',
		limit: null
	};
}

/**
 * Give every account an id of its own.
 *
 * Two accounts at one lender whose numbers end the same — or were masked —
 * hash alike, and an id shared is a rate and a link shared. The later ones take
 * a suffix in the order the report lists them, which is stable from one report
 * to the next for as long as the bureau's own order is.
 */
function distinct(accounts: readonly CreditAccount[]): readonly CreditAccount[] {
	const seen = new Map<string, number>();

	return accounts.map((account) => {
		const count = (seen.get(account.id) ?? 0) + 1;
		seen.set(account.id, count);

		return count === 1 ? account : { ...account, id: `${account.id}-${count}` };
	});
}

/** Finance365 does not say what kind of borrowing an account is; the lender's name often does. */
const KIND_HINTS: readonly (readonly [RegExp, CreditKind])[] = [
	[/\b(REVOLV\w*|OVERDRAFT|FACILITY)\b/, 'revolving'],
	[/\b(CREDIT ?CARD|CARD|VISA|MASTERCARD)\b/, 'card'],
	[/\b(LOANS?|BOND|MORTGAGE|VEHICLE|ASSET FINANCE|WESBANK|MFC)\b/, 'loan'],
	[/\b(STORE|RETAIL|RCS|TFG|TRUWORTHS|EDCON|WOOLWORTHS|MR ?PRICE|FOSCHINI)\b/, 'store']
];

function inferKind(creditor: string): CreditKind {
	const name = creditor.toUpperCase();

	return KIND_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
}

function toStatus(arrears: number): CreditStatus {
	return arrears > 0 ? 'arrears' : 'current';
}

/**
 * A positive amount, from a number or from money written out.
 *
 * Whatever cannot be read is nothing rather than `NaN`: these reach a
 * projection, and one unreadable instalment should not blank the page.
 */
function toAmount(value: unknown): number {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.replace(/[^0-9.-]/g, ''))
				: Number.NaN;

	const amount = Math.abs(number);
	// Past the bound a figure is not money, and a stored report holding one would
	// be refused on the next load — taking every earlier report with it.
	return Number.isFinite(amount) && amount <= MAX_AMOUNT ? amount : 0;
}

function toScore(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A date from a timestamp in milliseconds or seconds, or from a date string. */
function toIsoDate(value: unknown): string | null {
	const date =
		typeof value === 'number' && value > 0
			? new Date(value < 1e11 ? value * 1000 : value)
			: typeof value === 'string' && value.trim() !== ''
				? new Date(value)
				: null;

	if (date === null || Number.isNaN(date.getTime())) return null;

	// A year past 9999 serialises with a sign and six digits, which is not a
	// date anything downstream — or the stored-report check — accepts.
	const iso = date.toISOString().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
