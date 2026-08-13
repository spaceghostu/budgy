import Papa from 'papaparse';
import type { ParseIssue, ParseResult, Transaction } from '../types.ts';
import { classifyFlow, isDeclined, isFee, toMerchant } from './normalise.ts';

/**
 * Column headers this parser understands, keyed by the field they populate.
 * Matching is case- and whitespace-insensitive so minor export changes on the
 * bank's side don't break the import.
 */
const COLUMNS = {
	date: ['value date', 'date', 'transaction date'],
	time: ['value time', 'time'],
	account: ['account nickname', 'account'],
	type: ['type', 'transaction type'],
	description: ['transaction description', 'description'],
	counterparty: ['beneficiary or cardholder', 'beneficiary', 'cardholder'],
	amount: ['amount', 'value'],
	category: ['category'],
	subCategory: ['subcategory', 'sub category'],
	note: ['note', 'notes']
} as const;

type Field = keyof typeof COLUMNS;

const REQUIRED_FIELDS: readonly Field[] = ['date', 'amount', 'description'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Thrown when the file isn't a statement this app can read at all. */
export class StatementFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StatementFormatError';
	}
}

/**
 * Parse a bank statement CSV into normalised transactions.
 *
 * Rows that can't be read are collected into `issues` rather than thrown, so a
 * single malformed line never costs the user the rest of their statement.
 *
 * @throws {StatementFormatError} when the file has no header row or is missing
 * a column the app cannot work without.
 */
export function parseStatement(csv: string): ParseResult {
	const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: (header) => header.trim()
	});

	const headers = parsed.meta.fields ?? [];
	if (headers.length === 0) {
		throw new StatementFormatError('This file has no header row — it may not be a CSV statement.');
	}

	const columnMap = mapColumns(headers);
	const missing = REQUIRED_FIELDS.filter((field) => columnMap[field] === undefined);
	if (missing.length > 0) {
		throw new StatementFormatError(
			`This statement is missing required column(s): ${missing.join(', ')}. ` +
				`Found: ${headers.join(', ')}.`
		);
	}

	const issues: ParseIssue[] = [];
	const transactions: Transaction[] = [];

	parsed.data.forEach((row, index) => {
		// +2 accounts for the header row and 1-based line numbering.
		const line = index + 2;
		const result = toTransaction(row, columnMap, index, line);
		if ('reason' in result) {
			issues.push({ line, reason: result.reason });
			return;
		}
		transactions.push(result.transaction);
	});

	for (const error of parsed.errors) {
		issues.push({
			line: (error.row ?? 0) + 2,
			reason: error.message
		});
	}

	if (transactions.length === 0) {
		throw new StatementFormatError(
			issues.length > 0
				? `No readable transactions. First problem: ${issues[0].reason}`
				: 'No transactions found in this file.'
		);
	}

	return {
		transactions: sortChronologically(transactions),
		issues,
		accounts: distinctAccounts(transactions)
	};
}

type ColumnMap = Partial<Record<Field, string>>;

function mapColumns(headers: readonly string[]): ColumnMap {
	const byNormalised = new Map(headers.map((header) => [header.trim().toLowerCase(), header]));

	return (Object.keys(COLUMNS) as Field[]).reduce<ColumnMap>((map, field) => {
		const match = COLUMNS[field].find((alias) => byNormalised.has(alias));
		return match === undefined ? map : { ...map, [field]: byNormalised.get(match) };
	}, {});
}

function read(row: Record<string, string>, columnMap: ColumnMap, field: Field): string {
	const header = columnMap[field];
	if (header === undefined) return '';
	return (row[header] ?? '').trim();
}

type RowResult = { transaction: Transaction } | { reason: string };

function toTransaction(
	row: Record<string, string>,
	columnMap: ColumnMap,
	fileOrder: number,
	line: number
): RowResult {
	const date = read(row, columnMap, 'date');
	if (!ISO_DATE.test(date)) {
		return { reason: `Unreadable date ${JSON.stringify(date)}.` };
	}

	const rawAmount = read(row, columnMap, 'amount');
	const amount = parseAmount(rawAmount);
	if (amount === null) {
		return { reason: `Unreadable amount ${JSON.stringify(rawAmount)}.` };
	}

	const rawTime = read(row, columnMap, 'time');
	const time = TIME.test(rawTime) ? padTime(rawTime) : '';
	const timestamp = new Date(`${date}T${time === '' ? '00:00:00' : time}`).getTime();
	if (Number.isNaN(timestamp)) {
		return { reason: `Unreadable date/time ${JSON.stringify(`${date} ${rawTime}`)}.` };
	}

	const description = read(row, columnMap, 'description');
	const type = read(row, columnMap, 'type');
	const category = read(row, columnMap, 'category') || 'Uncategorised';
	const classifiable = { amount, type, category, description };

	return {
		transaction: {
			id: `csv:${line}`,
			date,
			time,
			timestamp,
			account: read(row, columnMap, 'account') || 'Account',
			accountNumber: '',
			type,
			description,
			counterparty: read(row, columnMap, 'counterparty'),
			amount,
			category,
			subCategory: read(row, columnMap, 'subCategory') || 'Uncategorised',
			note: read(row, columnMap, 'note'),
			merchant: toMerchant(description || read(row, columnMap, 'counterparty')),
			flow: classifyFlow(classifiable),
			isFee: isFee(classifiable),
			isDeclined: isDeclined(description),
			// A Smart Search export lists amounts but no running balance — that is
			// exactly what the certified PDF is for.
			balance: null,
			source: 'csv',
			fileOrder
		}
	};
}

/** Accepts `-1 234,56`, `(99.00)`, `R 1,234.56`, `100-` and plain `5000.00`. */
export function parseAmount(raw: string): number | null {
	const trimmed = raw.trim();
	if (trimmed === '') return null;

	const negated = /^\(.*\)$/.test(trimmed) || /^-/.test(trimmed) || /-$/.test(trimmed);
	const cleaned = trimmed.replace(/[^\d.,]/g, '');
	if (!/\d/.test(cleaned)) return null;

	const value = Number(useDotAsDecimal(cleaned));
	if (!Number.isFinite(value)) return null;

	return negated ? -Math.abs(value) : value;
}

/**
 * Rewrite a grouped number into plain JS number syntax, without assuming a
 * locale: the *last* separator is the decimal point, unless it groups three
 * digits and stands alone — `1,234` is one thousand, `1,23` is one and a bit.
 */
function useDotAsDecimal(cleaned: string): string {
	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');
	if (lastComma < 0 && lastDot < 0) return cleaned;

	const candidate = lastComma > lastDot ? ',' : '.';
	const occurrences = cleaned.split(candidate).length - 1;
	const digitsAfter = cleaned.length - cleaned.lastIndexOf(candidate) - 1;
	const isDecimalPoint = occurrences === 1 && digitsAfter !== 3;
	if (!isDecimalPoint) return cleaned.replace(/[.,]/g, '');

	const grouping = candidate === ',' ? '.' : ',';
	return cleaned.split(grouping).join('').replace(candidate, '.');
}

function padTime(time: string): string {
	const [hours, minutes, seconds = '00'] = time.split(':');
	return `${hours.padStart(2, '0')}:${minutes}:${seconds}`;
}

/**
 * Oldest first. Statements export newest-first, and the running balance has to
 * accumulate forwards through time. Rows sharing a timestamp keep their file
 * order reversed, which is the bank's own within-second ordering.
 */
function sortChronologically(transactions: readonly Transaction[]): readonly Transaction[] {
	return [...transactions].sort((a, b) => a.timestamp - b.timestamp || b.fileOrder - a.fileOrder);
}

function distinctAccounts(transactions: readonly Transaction[]): readonly string[] {
	return [...new Set(transactions.map((transaction) => transaction.account))];
}
