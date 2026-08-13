import type { ParseIssue, Transaction } from '../types.ts';
import { classifyFlow, isDeclined, isFee, toMerchant } from './normalise.ts';
import type { PdfAccount, PdfStatement } from './pdf-rows.ts';

export interface MergedStatement {
	readonly transactions: readonly Transaction[];
	readonly accounts: readonly string[];
	readonly issues: readonly ParseIssue[];
	/** The PDF account the CSV turned out to describe, if a CSV was supplied. */
	readonly enrichedAccount: string | null;
	readonly matched: number;
}

/**
 * Two exports of the same money, matched on date and amount.
 *
 * Neither file is complete on its own: the certified PDF has the running
 * balance and every account but no categories; the Smart Search CSV has the
 * bank's categories and the time of day but no balance. The PDF is the spine —
 * it is the certified record and its arithmetic is checked — and the CSV is
 * folded onto it wherever the two agree.
 */
export function mergeStatements(
	pdf: PdfStatement | null,
	csv: readonly Transaction[]
): MergedStatement {
	if (pdf === null) {
		return {
			transactions: csv,
			accounts: [...new Set(csv.map((transaction) => transaction.account))],
			issues: [],
			enrichedAccount: null,
			matched: 0
		};
	}

	const target = csv.length === 0 ? null : pickAccount(pdf.accounts, csv);
	const issues = [...pdf.issues];

	const transactions = pdf.accounts.flatMap((account) => {
		const sequence = createSequencer();
		return account === target?.account
			? enrich(account, target.byKey, issues, sequence)
			: account.rows.map((row, index) =>
					toTransaction(account, row, index, 'pdf', sequence(row.date))
				);
	});

	if (target !== null) {
		const leftovers = [...target.byKey.values()].flat();
		issues.push(...describeLeftovers(leftovers));
	}

	return {
		transactions: renumber(sortChronologically(transactions)),
		accounts: pdf.accounts.map((account) => account.type),
		issues,
		enrichedAccount: target?.account.type ?? null,
		matched: target === null ? 0 : csv.length - [...target.byKey.values()].flat().length
	};
}

/**
 * How many days a PDF row's date may run ahead of the CSV row's.
 *
 * The two exports date the same purchase differently: the CSV gives the day it
 * happened, the certified statement the day it settled, which for card
 * transactions is usually the next day and occasionally a few days later.
 * Measured against a real pair of exports, all but a handful land within this
 * window, and matching on the date alone finds barely half of them.
 */
const SETTLES_WITHIN_DAYS = 5;

/** …and how far it may run behind, which happens rarely but does happen. */
const SETTLES_EARLY_DAYS = 2;

const MS_PER_DAY = 86_400_000;

/**
 * CSV rows waiting to be matched, grouped by amount.
 *
 * The amount is the reliable key — dates shift and wording differs — so
 * candidates are found by amount and then chosen by date and description.
 */
type Index = Map<string, Transaction[]>;

function amountKey(amount: number): string {
	return amount.toFixed(2);
}

function indexBy(transactions: readonly Transaction[]): Index {
	const index: Index = new Map();
	for (const transaction of transactions) {
		const key = amountKey(transaction.amount);
		index.set(key, [...(index.get(key) ?? []), transaction]);
	}
	return index;
}

function dayNumber(date: string): number {
	return Math.round(new Date(`${date}T00:00:00`).getTime() / MS_PER_DAY);
}

/**
 * Take the CSV row that best explains this PDF row, and remove it.
 *
 * Candidates must share the amount and settle within the window. Among those,
 * an identical description wins — that is what keeps two charges of the same
 * size on the same day from swapping categories — and otherwise the closest
 * date does.
 */
function take(
	index: Index,
	pdfDate: string,
	amount: number,
	description: string
): Transaction | null {
	const queue = index.get(amountKey(amount));
	if (queue === undefined || queue.length === 0) return null;

	const settled = dayNumber(pdfDate);
	const wanted = description.trim().toLowerCase();

	const ranked = queue
		.map((row, position) => ({
			row,
			position,
			lag: settled - dayNumber(row.date),
			sameWording: row.description.trim().toLowerCase() === wanted
		}))
		.filter((entry) => entry.lag <= SETTLES_WITHIN_DAYS && entry.lag >= -SETTLES_EARLY_DAYS)
		.sort(
			(a, b) =>
				Number(b.sameWording) - Number(a.sameWording) ||
				Math.abs(a.lag) - Math.abs(b.lag) ||
				a.position - b.position
		);

	const best = ranked.at(0);
	if (best === undefined) return null;

	const remaining = queue.filter((_, position) => position !== best.position);
	if (remaining.length === 0) {
		index.delete(amountKey(amount));
	} else {
		index.set(amountKey(amount), remaining);
	}
	return best.row;
}

/**
 * Work out which account the CSV describes, rather than trusting a name.
 *
 * Discovery calls the same account "Cheque account" in the CSV and
 * "Transaction Account" in the PDF, and next month's export could be for a
 * different account entirely — so the answer comes from how well the rows
 * actually line up.
 */
function pickAccount(
	accounts: readonly PdfAccount[],
	csv: readonly Transaction[]
): { account: PdfAccount; byKey: Index } | null {
	const scored = accounts.map((account) => {
		// Scoring consumes the index, so each candidate gets its own copy and the
		// winner is re-indexed fresh for the real pass.
		const trial = indexBy(csv);
		const matched = account.rows.filter(
			(row) => take(trial, row.date, row.amount, row.description) !== null
		).length;

		return { account, matched };
	});

	const best = scored.reduce((winner, candidate) =>
		candidate.matched > winner.matched ? candidate : winner
	);

	return best.matched === 0 ? null : { account: best.account, byKey: indexBy(csv) };
}

function enrich(
	account: PdfAccount,
	byKey: Index,
	issues: ParseIssue[],
	sequence: (date: string) => number
): Transaction[] {
	const unmatched: string[] = [];

	const transactions = account.rows.map((row, index) => {
		const position = sequence(row.date);
		const csvRow = take(byKey, row.date, row.amount, row.description);
		if (csvRow === null) {
			if (row.amount !== 0) unmatched.push(`${row.date} ${row.description}`);
			return toTransaction(account, row, index, 'pdf', position);
		}

		const base = toTransaction(account, row, index, 'both', position);
		return {
			...base,
			// The PDF keeps date, amount, balance and ordering — it is the certified
			// record, and its order is what makes the balance chain add up. The CSV
			// contributes only what the PDF has no column for. In particular its
			// timestamp is NOT taken: the CSV dates a purchase when it happened,
			// which can precede the day it settled, and adopting that would shuffle
			// rows out of the order their balances were printed in.
			time: csvRow.time,
			type: csvRow.type,
			counterparty: csvRow.counterparty,
			category: csvRow.category,
			subCategory: csvRow.subCategory,
			note: csvRow.note,
			flow: classifyFlow({ ...base, type: csvRow.type, category: csvRow.category }),
			isFee: isFee({ ...base, type: csvRow.type, category: csvRow.category })
		};
	});

	if (unmatched.length > 0) {
		issues.push({
			line: 0,
			reason:
				`${unmatched.length} transaction(s) in the PDF had no match in the CSV, so they carry ` +
				`no category — for example ${unmatched[0]}.`
		});
	}

	return transactions;
}

const LEFTOVERS_SHOWN = 3;

function describeLeftovers(leftovers: readonly Transaction[]): readonly ParseIssue[] {
	const real = leftovers.filter((transaction) => transaction.amount !== 0);
	if (real.length === 0) return [];

	const examples = real
		.slice(0, LEFTOVERS_SHOWN)
		.map((transaction) => `${transaction.date} ${transaction.description}`)
		.join('; ');

	return [
		{
			line: 0,
			reason:
				`${real.length} row(s) in the CSV had no matching line in the PDF and were left out, ` +
				`because the PDF is the record the balances come from: ${examples}.`
		}
	];
}

/**
 * Number the rows printed on one day, in the order the statement lists them.
 *
 * A certified statement gives a date but no clock time, and its row order is
 * what makes the running balance add up. Turning that order into a timestamp
 * keeps it through every sort and filter downstream.
 */
function createSequencer(): (date: string) => number {
	let lastDate = '';
	let position = 0;

	return (date: string) => {
		if (date === lastDate) {
			position += 1;
		} else {
			lastDate = date;
			position = 0;
		}
		// A day holds 86,400 seconds; a statement will not print more rows than
		// that in one day, but clamping keeps the date from rolling over if it did.
		return Math.min(position, SECONDS_PER_DAY - 1);
	};
}

const SECONDS_PER_DAY = 86_400;

function toTransaction(
	account: PdfAccount,
	row: PdfAccount['rows'][number],
	index: number,
	source: 'pdf' | 'both',
	position: number
): Transaction {
	const classifiable = {
		amount: row.amount,
		type: '',
		category: '',
		description: row.description
	};

	return {
		id: `${account.number}:${index}`,
		date: row.date,
		// Filled in from the CSV when the two files agree on a row.
		time: '',
		// Midnight plus the row's place in the day: no clock time is claimed, and
		// the statement's own ordering survives.
		timestamp: new Date(`${row.date}T00:00:00`).getTime() + position * 1000,
		account: account.type,
		accountNumber: account.number,
		type: '',
		description: row.description,
		counterparty: '',
		amount: row.amount,
		category: 'Uncategorised',
		subCategory: 'Uncategorised',
		note: '',
		merchant: toMerchant(row.description),
		flow: classifyFlow(classifiable),
		isFee: isFee(classifiable),
		isDeclined: isDeclined(row.description),
		balance: row.balance,
		source,
		fileOrder: index
	};
}

/**
 * Interleave the accounts into one chronological list.
 *
 * Accounts are parsed one after another, so without this the merged list runs
 * through 2025–26 for the first account and then jumps back to 2025 for the
 * next. Viewing all accounts at once would draw a line that doubles back on
 * itself, and the period presets — which read the first and last row — would
 * count back from whichever account happened to be parsed last.
 *
 * Within an account timestamps already increase, so this never disturbs the
 * order a balance chain depends on.
 */
function sortChronologically(transactions: readonly Transaction[]): readonly Transaction[] {
	return [...transactions].sort((a, b) => a.timestamp - b.timestamp || a.fileOrder - b.fileOrder);
}

/**
 * Give every transaction a file order that is unique across accounts and
 * already chronological, so nothing downstream needs to re-sort PDF rows.
 */
function renumber(transactions: readonly Transaction[]): readonly Transaction[] {
	return transactions.map((transaction, index) => ({ ...transaction, fileOrder: index }));
}
