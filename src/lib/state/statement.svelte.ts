import { mergeStatements } from '../parse/merge.ts';
import type { PdfStatement } from '../parse/pdf-rows.ts';
import { readPdfStatement } from '../parse/pdf.ts';
import { StatementFormatError, parseStatement } from '../parse/statement.ts';
import {
	NO_FILTERS,
	anchorForSlice,
	buildInsights,
	filterTransactions
} from '../stats/insights.ts';
import { hasPrintedBalances } from '../stats/balance.ts';
import { listMonths } from '../stats/monthly.ts';
import type { Insights, ParseIssue, Transaction } from '../types.ts';
import {
	clearKey,
	loadAnchors,
	loadFiles,
	saveAnchors,
	saveFiles,
	type Anchor,
	type StoredFiles
} from './persistence.ts';
import { ALL_ACCOUNTS, busiestAccount, resolveRange, type RangePreset } from './range.ts';

export { ALL_ACCOUNTS, RANGE_OPTIONS, resolveRange } from './range.ts';
export type { RangeOption, RangePreset } from './range.ts';

/** The two exports the app understands, and what each is good for. */
export type SourceKind = 'pdf' | 'csv';

export interface SourceSlot {
	readonly kind: SourceKind;
	readonly label: string;
	readonly hint: string;
	readonly accept: string;
	readonly fileName: string;
	readonly loaded: boolean;
}

/**
 * The whole application state.
 *
 * Up to two files describe the same money: a certified PDF statement, which
 * carries the running balance for every account, and a Smart Search CSV, which
 * carries the bank's categories. Either alone works; together they are merged,
 * and everything below is derived so no two figures on screen can disagree.
 */
export class StatementState {
	pdfName = $state('');
	csvName = $state('');
	pdfStatement = $state<PdfStatement | null>(null);
	csvTransactions = $state<readonly Transaction[]>([]);
	csvIssues = $state<readonly ParseIssue[]>([]);

	error = $state<string | null>(null);
	/** Set while a file is being read — a 90-page PDF is not instant. */
	busy = $state<SourceKind | null>(null);

	account = $state<string>(ALL_ACCOUNTS);
	range = $state<RangePreset>('all');
	customFrom = $state('');
	customTo = $state('');
	/** `YYYY-MM` the month view is parked on. Blank means the newest month. */
	selectedMonth = $state('');

	/** Balance anchors by account key, for the CSV-only case. */
	anchors = $state<Record<string, Anchor>>({});
	remember = $state(false);

	/** The raw files, kept so "remember these files" can re-save them. */
	private files = $state<StoredFiles>({});

	private readonly merged = $derived(mergeStatements(this.pdfStatement, this.csvTransactions));

	readonly transactions = $derived(this.merged.transactions);
	readonly accounts = $derived(this.merged.accounts);
	readonly enrichedAccount = $derived(this.merged.enrichedAccount);
	readonly matched = $derived(this.merged.matched);
	readonly issues = $derived([...this.csvIssues, ...this.merged.issues]);

	readonly hasStatement = $derived(this.transactions.length > 0);
	readonly hasPdf = $derived(this.pdfStatement !== null);
	readonly hasCsv = $derived(this.csvTransactions.length > 0);

	readonly sources: readonly SourceSlot[] = $derived([
		{
			kind: 'pdf',
			label: 'Certified statement',
			hint: 'PDF · every account, with the running balance',
			accept: '.pdf,application/pdf',
			fileName: this.pdfName,
			loaded: this.hasPdf
		},
		{
			kind: 'csv',
			label: 'Smart Search export',
			hint: 'CSV · the bank’s categories and times',
			accept: '.csv,text/csv',
			fileName: this.csvName,
			loaded: this.hasCsv
		}
	]);

	/** Every transaction for the selected account, oldest first. */
	readonly accountTransactions = $derived(
		filterTransactions(this.transactions, {
			...NO_FILTERS,
			account: this.account === ALL_ACCOUNTS ? null : this.account
		})
	);

	/** The last date in the statement — "recent" is relative to the data, not today. */
	readonly latestDate = $derived(this.accountTransactions.at(-1)?.date ?? '');
	readonly earliestDate = $derived(this.accountTransactions.at(0)?.date ?? '');

	/** Every month this account has, oldest first — what the stepper walks. */
	readonly months = $derived(listMonths(this.accountTransactions));

	/**
	 * The month actually being shown.
	 *
	 * Switching account can strand the selection on a month that account never
	 * had, so the newest available month is the fallback rather than an empty view.
	 */
	readonly activeMonth = $derived(
		this.months.includes(this.selectedMonth) ? this.selectedMonth : (this.months.at(-1) ?? '')
	);

	readonly bounds = $derived(
		resolveRange({
			range: this.range,
			customFrom: this.customFrom,
			customTo: this.customTo,
			earliestDate: this.earliestDate,
			latestDate: this.latestDate,
			selectedMonth: this.activeMonth
		})
	);

	/** The month the comparison chart draws in full strength. */
	readonly focusMonth = $derived(
		this.range === 'month' ? this.activeMonth : (this.months.at(-1) ?? '')
	);

	readonly visible = $derived(
		filterTransactions(this.accountTransactions, {
			account: null,
			from: this.bounds.from,
			to: this.bounds.to
		})
	);

	/** True when the view spans more than one account. */
	readonly spansAccounts = $derived(
		this.visible.some((transaction) => transaction.account !== this.visible[0]?.account)
	);

	/**
	 * True when the bank printed the balances, so nothing needs to be anchored.
	 * The manual balance control only appears when this is false.
	 *
	 * A printed balance belongs to one account. Across several accounts the
	 * numbers cannot be chained into one line, so the view falls back to net
	 * change — which is still a true statement about the money, just a
	 * different one.
	 */
	readonly balancesAreCertified = $derived(hasPrintedBalances(this.visible) && !this.spansAccounts);

	private readonly storedAnchor = $derived(this.anchors[this.account]);

	/**
	 * True when a stored anchor was measured against a different statement.
	 *
	 * Loading a newer export keeps the same account name, so without this check
	 * the old balance would be applied as if it were current.
	 */
	readonly isAnchorStale = $derived(
		!this.balancesAreCertified &&
			this.storedAnchor !== undefined &&
			this.latestDate !== '' &&
			this.storedAnchor.asOf !== this.latestDate
	);

	readonly anchor = $derived(this.isAnchorStale ? 0 : (this.storedAnchor?.balance ?? 0));

	/** True while the balance line is a shape rather than real money. */
	readonly isRelative = $derived(
		!this.balancesAreCertified && (this.storedAnchor === undefined || this.isAnchorStale)
	);

	readonly insights: Insights = $derived(
		buildInsights(this.visible, anchorForSlice(this.accountTransactions, this.visible, this.anchor))
	);

	constructor() {
		this.anchors = loadAnchors();
	}

	/** Re-open the files the user chose to keep on this device. */
	async restore(): Promise<void> {
		const stored = loadFiles();
		if (stored.csv === undefined && stored.pdf === undefined) return;

		this.remember = true;
		this.files = stored;

		if (stored.pdf !== undefined) {
			await this.applyPdf(toBytes(stored.pdf.base64), stored.pdf.name, { persist: false });
		}
		if (stored.csv !== undefined) {
			this.applyCsv(stored.csv.text, stored.csv.name, { persist: false });
		}
	}

	/**
	 * Read a file the user picked, working out which of the two it is.
	 *
	 * Extension first, then a look at the contents, so a PDF saved with the
	 * wrong extension still lands in the right slot.
	 */
	async loadFile(file: File): Promise<void> {
		const kind = await detectKind(file);
		if (kind === null) {
			this.error = `${file.name} is neither a PDF statement nor a CSV export.`;
			return;
		}

		this.busy = kind;
		try {
			if (kind === 'pdf') {
				await this.applyPdf(new Uint8Array(await file.arrayBuffer()), file.name);
			} else {
				this.applyCsv(await file.text(), file.name);
			}
		} catch (error: unknown) {
			this.error = describe(error, file.name);
		} finally {
			this.busy = null;
		}
	}

	private async applyPdf(
		bytes: Uint8Array,
		fileName: string,
		options: { persist?: boolean } = {}
	): Promise<void> {
		try {
			const statement = await readPdfStatement(toArrayBuffer(bytes));

			this.pdfStatement = statement;
			this.pdfName = fileName;
			this.error = null;
			this.selectDefaultAccount();

			this.files = { ...this.files, pdf: { name: fileName, base64: toBase64(bytes) } };
			if (options.persist !== false) this.persist();
		} catch (error: unknown) {
			this.error = describe(error, fileName);
		}
	}

	private applyCsv(text: string, fileName: string, options: { persist?: boolean } = {}): void {
		try {
			const result = parseStatement(text);

			this.csvTransactions = result.transactions;
			this.csvIssues = result.issues;
			this.csvName = fileName;
			this.error = null;
			this.selectDefaultAccount();

			this.files = { ...this.files, csv: { name: fileName, text } };
			if (options.persist !== false) this.persist();
		} catch (error: unknown) {
			this.error = describe(error, fileName);
		}
	}

	/**
	 * Point the view at the busiest account, and reset the period.
	 *
	 * Loading a second file can change which accounts exist, so the selection is
	 * re-derived rather than left pointing at something that may be gone.
	 */
	private selectDefaultAccount(): void {
		this.account = busiestAccount(this.transactions);
		this.range = 'all';
		this.customFrom = '';
		this.customTo = '';
		this.selectedMonth = '';
	}

	/** Step the month view one month either way, stopping at the ends. */
	stepMonth(offset: number): void {
		const index = this.months.indexOf(this.activeMonth);
		if (index < 0) return;

		const next = this.months[index + offset];
		if (next !== undefined) this.selectedMonth = next;
	}

	remove(kind: SourceKind): void {
		if (kind === 'pdf') {
			this.pdfStatement = null;
			this.pdfName = '';
			this.files = { ...this.files, pdf: undefined };
		} else {
			this.csvTransactions = [];
			this.csvIssues = [];
			this.csvName = '';
			this.files = { ...this.files, csv: undefined };
		}

		this.error = null;
		if (this.hasStatement) this.selectDefaultAccount();
		if (this.remember) this.persist();
	}

	/** @param balance The balance after the last transaction in this statement. */
	setAnchor(balance: number | null): void {
		const next = { ...this.anchors };
		if (balance === null) {
			delete next[this.account];
		} else {
			next[this.account] = { balance, asOf: this.latestDate };
		}

		this.anchors = next;
		saveAnchors(next);
	}

	setRemember(remember: boolean): void {
		this.remember = remember;

		if (remember) {
			this.persist();
		} else {
			clearKey('files');
		}
	}

	clear(): void {
		this.pdfStatement = null;
		this.csvTransactions = [];
		this.csvIssues = [];
		this.pdfName = '';
		this.csvName = '';
		this.files = {};
		this.error = null;
		clearKey('files');
	}

	private persist(): void {
		if (!this.remember) return;
		if (saveFiles(this.files)) return;

		this.remember = false;
		this.error = 'This browser would not store these files — they stay in memory until you reload.';
	}
}

function describe(error: unknown, fileName: string): string {
	if (error instanceof StatementFormatError) return `${fileName}: ${error.message}`;
	return `Could not read ${fileName}: ${error instanceof Error ? error.message : 'unknown error'}`;
}

const PDF_MAGIC = '%PDF';

async function detectKind(file: File): Promise<SourceKind | null> {
	const name = file.name.toLowerCase();
	if (name.endsWith('.pdf')) return 'pdf';
	if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';

	const head = await file.slice(0, PDF_MAGIC.length).text();
	if (head === PDF_MAGIC) return 'pdf';
	return file.type.includes('csv') || file.type.startsWith('text/') ? 'csv' : null;
}

/** A view onto exactly the bytes, never the whole backing buffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer as ArrayBuffer;
}

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
	// Chunked: spreading a megabyte into String.fromCharCode blows the stack.
	const parts: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		parts.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)));
	}
	return btoa(parts.join(''));
}

function toBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
