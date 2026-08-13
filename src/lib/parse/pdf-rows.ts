import type { ParseIssue } from '../types.ts';
import { parseAmount } from './statement.ts';

/**
 * One piece of text on a PDF page, with where it sits.
 *
 * This is the shape pdf.js hands back, reduced to the fields the row assembler
 * needs. Keeping it a plain interface is what lets every rule below be tested
 * without loading a PDF.
 */
export interface TextItem {
	readonly str: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
}

export interface PdfPage {
	readonly items: readonly TextItem[];
}

/** A statement line as printed, before it becomes a `Transaction`. */
export interface PdfRow {
	readonly date: string;
	readonly description: string;
	/** Signed: debits negative, credits positive. */
	readonly amount: number;
	/** The running balance printed on the row. */
	readonly balance: number;
}

export interface PdfAccount {
	readonly type: string;
	readonly number: string;
	readonly rows: readonly PdfRow[];
	/** Closing balance from the cover page, when the cover listed this account. */
	readonly coverBalance: number | null;
}

export interface PdfStatement {
	readonly accounts: readonly PdfAccount[];
	readonly from: string;
	readonly to: string;
	readonly issues: readonly ParseIssue[];
}

/** Rows on the same printed line share a y within this many units. */
const LINE_TOLERANCE = 3;

/** Glyph runs closer than this belong to the same cell. */
const CELL_GAP = 8;

/** How far a value's right edge may sit from a column's, in points. */
const COLUMN_TOLERANCE = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rounding slack when checking a printed balance against the running total. */
const BALANCE_EPSILON = 0.005;

/** Named individually before the rest are summarised. */
const BROKEN_ROWS_SHOWN = 3;

/** A cell: one or more glyph runs merged into a value with a right edge. */
interface Cell {
	readonly text: string;
	readonly left: number;
	readonly right: number;
}

interface Line {
	readonly y: number;
	readonly cells: readonly Cell[];
}

/** The x positions of the Debit / Credit / Balance headers on a page. */
interface Columns {
	readonly debit: number;
	readonly credit: number;
	readonly balance: number;
}

/**
 * Turn the pages of a certified statement PDF into per-account transaction
 * lists, each carrying the balance the bank printed beside it.
 *
 * The whole thing is a pure function of positioned text so it can be tested
 * with synthetic items; only the loader knows what a PDF is.
 */
export function parsePdfStatement(pages: readonly PdfPage[]): PdfStatement {
	const issues: ParseIssue[] = [];
	const coverBalances = new Map<string, number>();
	const sections = new Map<string, { type: string; number: string; rows: PdfRow[] }>();

	let current: { type: string; number: string; rows: PdfRow[] } | null = null;
	let period = { from: '', to: '' };

	pages.forEach((page, index) => {
		const pageNumber = index + 1;
		const lines = toLines(page.items);

		const dates = readPeriod(lines);
		if (dates !== null && period.from === '') period = dates;

		for (const [account, balance] of readCoverBalances(lines)) {
			coverBalances.set(account, balance);
		}

		// A section header starts a new account; a continuation page has none,
		// so the account carries over from the previous page.
		const header = readAccountHeader(lines);
		if (header !== null) {
			const key = header.number;
			current = sections.get(key) ?? { ...header, rows: [] };
			sections.set(key, current);
		}

		const columns = readColumns(lines);
		if (columns === null) return;

		if (current === null) {
			issues.push({
				line: pageNumber,
				reason: `Page ${pageNumber} has a transaction table but no account heading before it.`
			});
			return;
		}

		for (const line of lines) {
			const row = toRow(line, columns);
			if (row === null) continue;
			if ('reason' in row) {
				issues.push({ line: pageNumber, reason: `Page ${pageNumber}: ${row.reason}` });
				continue;
			}
			current.rows.push(row);
		}
	});

	const accounts = [...sections.values()].map((section) => ({
		type: section.type,
		number: section.number,
		rows: section.rows,
		coverBalance: coverBalances.get(section.number) ?? null
	}));

	return {
		accounts,
		from: period.from,
		to: period.to,
		issues: [...issues, ...verify(accounts)]
	};
}

/**
 * Group glyph runs into printed lines, then into cells.
 *
 * pdf.js emits a separate item per positioned run, so `R 1,234.56` can arrive
 * as several pieces; anything that nearly touches is one value.
 */
export function toLines(items: readonly TextItem[]): readonly Line[] {
	const buckets = new Map<number, TextItem[]>();
	for (const item of items) {
		if (item.str.trim() === '') continue;
		const key = Math.round(item.y / LINE_TOLERANCE);
		buckets.set(key, [...(buckets.get(key) ?? []), item]);
	}

	return [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, bucket]) => ({
			y: bucket[0].y,
			cells: toCells([...bucket].sort((a, b) => a.x - b.x))
		}));
}

/**
 * Every printed amount begins `R` + a space, so a run starting that way always
 * opens a new value and never continues the previous one.
 *
 * Without this the gap rule alone fails on wide figures: a five-figure credit
 * can end within a few points of the balance beside it, and the two silently
 * become one unreadable cell — which drops the row and breaks the chain.
 */
const STARTS_AMOUNT = /^R[\s\u00a0\u2009\u202f]/;

function toCells(sorted: readonly TextItem[]): readonly Cell[] {
	return sorted
		.reduce<Cell[]>((cells, item) => {
			const last = cells.at(-1);
			const joins =
				last !== undefined && item.x - last.right < CELL_GAP && !STARTS_AMOUNT.test(item.str);

			if (joins) {
				return [
					...cells.slice(0, -1),
					{ text: `${last.text}${item.str}`, left: last.left, right: item.x + item.width }
				];
			}
			return [...cells, { text: item.str, left: item.x, right: item.x + item.width }];
		}, [])
		.map((cell) => ({ ...cell, text: normaliseText(cell.text) }));
}

/**
 * Statement amounts are `R` + a non-breaking space + digits. Fold that, and any
 * other exotic space, to something the number parser and the eye both read.
 */
function normaliseText(text: string): string {
	return text
		.replace(/[\u00a0\u2009\u202f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * A whole printed line as text.
 *
 * Labels and their values sit close enough together to land in one cell
 * ("Account type:Transaction Account"), so headings are matched against the
 * joined line rather than against individual cells.
 */
function lineText(line: Line): string {
	return line.cells.map((cell) => cell.text).join(' ');
}

function readPeriod(lines: readonly Line[]): { from: string; to: string } | null {
	for (const line of lines) {
		const text = lineText(line);
		if (!text.includes('From:')) continue;

		const [from, to] = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
		if (from !== undefined && to !== undefined) return { from, to };
	}
	return null;
}

const ACCOUNT_HEADING = /Account type:\s*(.+?)\s*Account number:\s*(\d{4,})/;

function readAccountHeader(lines: readonly Line[]): { type: string; number: string } | null {
	for (const line of lines) {
		const match = lineText(line).match(ACCOUNT_HEADING);
		if (match !== null) return { type: match[1].trim(), number: match[2] };
	}
	return null;
}

/**
 * The cover page lists every account with its closing balance, which is a free
 * cross-check on the transaction tables that follow.
 */
function readCoverBalances(lines: readonly Line[]): readonly (readonly [string, number])[] {
	const header = lines.find((line) => line.cells.some((cell) => cell.text === 'Account Number'));
	if (header === undefined) return [];

	return lines.flatMap((line) => {
		const number = line.cells.find((cell) => /^\d{6,}$/.test(cell.text));
		const balance = line.cells.findLast((cell) => isAmount(cell.text));
		if (number === undefined || balance === undefined) return [];

		const value = parseAmount(balance.text);
		return value === null ? [] : [[number.text, value] as const];
	});
}

/** Column x positions come from the table header printed on every page. */
export function readColumns(lines: readonly Line[]): Columns | null {
	for (const line of lines) {
		const byLabel = new Map(line.cells.map((cell) => [cell.text, cell.right]));
		const debit = byLabel.get('Debit');
		const credit = byLabel.get('Credit');
		const balance = byLabel.get('Balance');

		if (debit !== undefined && credit !== undefined && balance !== undefined) {
			return { debit, credit, balance };
		}
	}
	return null;
}

type RowResult = PdfRow | { reason: string } | null;

function toRow(line: Line, columns: Columns): RowResult {
	const [first, ...rest] = line.cells;
	if (first === undefined || !ISO_DATE.test(first.text)) return null;

	const amounts = rest.filter((cell) => isAmount(cell.text));
	if (amounts.length === 0) return null;

	const balanceCell = amounts.at(-1);
	if (balanceCell === undefined || !nearColumn(balanceCell, columns.balance)) {
		return { reason: `row dated ${first.text} has no balance in the balance column.` };
	}

	const balance = parseAmount(balanceCell.text);
	if (balance === null) {
		return { reason: `row dated ${first.text} has an unreadable balance.` };
	}

	const description = rest
		.filter((cell) => !isAmount(cell.text))
		.map((cell) => cell.text)
		.join(' ')
		.trim();

	// A balance with no debit or credit beside it is a declined attempt: the
	// bank prints the line, but no money moved and the balance is unchanged.
	// The balance chain check below is what proves this reading is right.
	const valueCell = amounts.at(-2);
	if (valueCell === undefined) {
		return { date: first.text, description, amount: 0, balance };
	}

	const magnitude = parseAmount(valueCell.text);
	if (magnitude === null) {
		return { reason: `row dated ${first.text} has an unreadable amount.` };
	}

	// Debit and credit are separate right-aligned columns; which one a value
	// sits in is the only thing that says whether money came in or went out.
	const toDebit = Math.abs(valueCell.right - columns.debit);
	const toCredit = Math.abs(valueCell.right - columns.credit);
	const isDebit = toDebit <= toCredit;

	return {
		date: first.text,
		description,
		amount: isDebit ? -Math.abs(magnitude) : Math.abs(magnitude),
		balance
	};
}

function nearColumn(cell: Cell, columnRight: number): boolean {
	return Math.abs(cell.right - columnRight) <= COLUMN_TOLERANCE;
}

function isAmount(text: string): boolean {
	return /^R\s?-?[\d, ]+\.\d{2}-?$/.test(text);
}

/**
 * Check each account's arithmetic: every printed balance should equal the one
 * before it plus the row's amount, and the last should match the cover page.
 *
 * A drift here means a debit was read as a credit or a row was dropped, which
 * would quietly corrupt the chart — so it is reported rather than absorbed.
 */
function verify(accounts: readonly PdfAccount[]): readonly ParseIssue[] {
	return accounts.flatMap((account, index) => {
		const issues: ParseIssue[] = [];
		const line = index + 1;

		const broken = account.rows.filter((row, rowIndex) => {
			const previous = account.rows[rowIndex - 1];
			if (previous === undefined) return false;

			return Math.abs(previous.balance + row.amount - row.balance) > BALANCE_EPSILON;
		});

		// One entry per bad row would bury the reader if a whole account parsed
		// wrongly; name the first few and count the rest.
		for (const row of broken.slice(0, BROKEN_ROWS_SHOWN)) {
			issues.push({
				line,
				reason:
					`${account.type}: the balance on ${row.date} (${row.description}) does not follow ` +
					`from the row before it — its amount may have been read as the wrong sign.`
			});
		}
		if (broken.length > BROKEN_ROWS_SHOWN) {
			issues.push({
				line,
				reason: `${account.type}: ${broken.length - BROKEN_ROWS_SHOWN} further rows do not follow the running balance.`
			});
		}

		const last = account.rows.at(-1);
		if (
			account.coverBalance !== null &&
			last !== undefined &&
			Math.abs(last.balance - account.coverBalance) > BALANCE_EPSILON
		) {
			issues.push({
				line,
				reason:
					`Account ${account.type}: the last balance in the transaction list does not match ` +
					`the closing balance on the summary page.`
			});
		}

		return issues;
	});
}
