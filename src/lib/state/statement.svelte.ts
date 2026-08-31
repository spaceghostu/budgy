import {
	applyCategoryRules,
	listRules,
	resolveCategory,
	categoryOptions,
	uncategorisedGroups,
	type CategoryRules
} from '../categorise.ts';
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
import { buildBalanceSeries, hasPrintedBalances, usesPrintedBalances } from '../stats/balance.ts';
import { CALENDAR_START, readMonthStart } from '../stats/cycle.ts';
import { addedKey, type AddedCharge } from '../stats/forecast.ts';
import { listMonths } from '../stats/monthly.ts';
import { buildNetWorth } from '../stats/networth.ts';
import type { Insights, ParseIssue, Transaction } from '../types.ts';
import { StatementLibrary } from './library.svelte.ts';
import type { StatementSummary } from './library.ts';
import {
	clearKey,
	loadAddedCharges,
	loadAnchors,
	loadCategoryRules,
	loadDroppedCharges,
	loadFiles,
	loadMonthStart,
	loadOwnCategories,
	loadRecentCategories,
	saveAddedCharges,
	saveAnchors,
	saveCategoryRules,
	saveDroppedCharges,
	saveMonthStart,
	saveOwnCategories,
	saveRecentCategories,
	withRecentCategory,
	type Anchor
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
 *
 * That pair is one *statement*, and every one uploaded is filed into
 * {@link library} rather than replacing the last — which is what makes a year of
 * exports a history you can step back through. Adding the second file to the
 * statement on screen completes that entry; starting a new one files the next.
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

	/**
	 * The day of the month the reader's months open on.
	 *
	 * Money does not always run from the 1st — a reader paid on the 25th lives in
	 * months that open on the 25th. Kept here rather than per page because it is
	 * one answer to "what is a month", and every month-shaped figure in the app
	 * has to give the same one. See {@link cycleOf}.
	 */
	monthStart = $state(CALENDAR_START);

	/** Balance anchors by account key, for the CSV-only case. */
	anchors = $state<Record<string, Anchor>>({});
	/** Categories the reader chose for merchants the bank left unfiled. */
	categoryRules = $state<CategoryRules>({});
	/** Category names the reader made up, kept whether or not a rule uses one. */
	ownCategories = $state<readonly string[]>([]);
	/**
	 * Charges the reader has told the forecast are not coming.
	 *
	 * Kept here rather than on the page so the choice survives a visit to another
	 * page and a reload — the history will go on saying the gym bills on the 20th
	 * long after it was cancelled, and the reader should only have to say
	 * otherwise once. See {@link ExpectedPayment.key} for what the strings are.
	 */
	droppedCharges = $state<readonly string[]>([]);
	/**
	 * Charges the reader has added to the forecast themselves.
	 *
	 * Kept beside {@link droppedCharges} because they are the same act from two
	 * directions — the reader correcting what the history could and could not
	 * see — and neither should have to be said twice. See {@link AddedCharge}.
	 */
	addedCharges = $state<readonly AddedCharge[]>([]);
	/** The categories last chosen, most recent first. */
	recentCategories = $state<readonly string[]>([]);

	/** Every statement kept on this device, and which of them is on screen. */
	readonly library = new StatementLibrary();

	/** The files behind the open statement, kept so it can be re-filed whole. */
	private pdfBytes: Uint8Array | null = null;
	private csvText = '';

	private readonly merged = $derived(mergeStatements(this.pdfStatement, this.csvTransactions));

	/**
	 * The statement, with the reader's own categories folded in.
	 *
	 * Applied here, where the CSV-only and merged paths meet, so everything
	 * downstream — breakdowns, recurring charges, the search table, what Claude
	 * is sent — sees one filing rather than each having to know about the rules.
	 */
	readonly transactions = $derived(
		applyCategoryRules(this.merged.transactions, this.categoryRules)
	);
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
	readonly months = $derived(listMonths(this.accountTransactions, this.monthStart));

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
			selectedMonth: this.activeMonth,
			monthStart: this.monthStart
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

	/**
	 * What the account stands at on {@link latestDate}.
	 *
	 * Read from the whole account history rather than the period on screen,
	 * because a balance is not a property of a date range: filtering to last week
	 * does not change what is in the bank. The forecast is the one page that
	 * needs this — everything else is asking about a period — and it hides the
	 * period row for the same reason.
	 */
	readonly balanceNow = $derived(
		buildBalanceSeries(this.accountTransactions, this.anchor).at(-1)?.balance ?? 0
	);

	/**
	 * True while {@link balanceNow} is a shape rather than real money.
	 *
	 * The same question {@link isRelative} answers, asked of the whole history
	 * instead of the visible slice — and asked through the very function that
	 * builds the series, so the two cannot disagree about whether the number is
	 * the bank's or an anchor's.
	 */
	readonly balanceNowIsRelative = $derived(
		!usesPrintedBalances(this.accountTransactions) &&
			(this.storedAnchor === undefined || this.storedAnchor.asOf !== this.latestDate)
	);

	/**
	 * Entered balances by account, with stale ones dropped.
	 *
	 * Keyed by account rather than by the current selection, because net worth
	 * has to add up accounts the reader is not looking at. The all-accounts key
	 * is a selection and not an account, so it never contributes.
	 */
	private readonly accountAnchors = $derived(this.resolveAnchors());

	readonly insights: Insights = $derived(
		buildInsights(
			this.visible,
			anchorForSlice(this.accountTransactions, this.visible, this.anchor),
			this.monthStart
		)
	);

	/**
	 * Net worth across every account, over the statement's whole history.
	 *
	 * Deliberately built from {@link transactions} rather than the filtered
	 * slice: a level needs the whole chain behind it, and net worth is not a
	 * question about one account or one period.
	 */
	readonly netWorth = $derived(buildNetWorth(this.transactions, this.accountAnchors));

	/**
	 * What the categoriser offers: this statement's own categories, the bank's,
	 * and any the reader has made — including one made for a merchant that these
	 * particular files do not happen to mention.
	 */
	readonly categoryOptions = $derived(
		categoryOptions(this.transactions, [
			...Object.values(this.categoryRules),
			...this.ownCategories
		])
	);

	/**
	 * The shortlist the picker offers above the full list.
	 *
	 * Filtered against the options rather than shown raw, so a category that only
	 * existed in a statement since replaced cannot be offered as a choice that
	 * then resolves to nothing.
	 */
	readonly recentOptions = $derived(
		this.recentCategories.filter((category) => this.categoryOptions.includes(category))
	);

	/** Merchants in the current view that are still unfiled, heaviest first. */
	readonly uncategorised = $derived(uncategorisedGroups(this.visible));

	/** The choices already made, counted against the whole statement, not the view. */
	readonly appliedRules = $derived(listRules(this.categoryRules, this.merged.transactions));

	constructor() {
		this.monthStart = loadMonthStart();
		this.anchors = loadAnchors();
		this.categoryRules = loadCategoryRules();
		this.ownCategories = loadOwnCategories();
		this.recentCategories = loadRecentCategories();
		this.droppedCharges = loadDroppedCharges();
		this.addedCharges = loadAddedCharges();
	}

	/**
	 * Read the history, and re-open the statement this browser was last on.
	 *
	 * Called once for the whole app rather than per page: the state is shared
	 * across routes, so landing on any of them restores the same statement.
	 */
	async restore(): Promise<void> {
		await this.library.refresh();
		if (await this.adoptLegacyFiles()) return;

		const id = this.library.activeId;
		if (id !== '') await this.openEntry(id);
	}

	/**
	 * File whatever an older version of the app was keeping, then forget its key.
	 *
	 * That scheme held one statement in local storage and replaced it on the next
	 * upload. Dropping it silently on first load would lose the statement the
	 * reader had asked to keep, so it becomes the first entry in the history.
	 *
	 * @returns true when a statement was adopted and is now on screen.
	 */
	private async adoptLegacyFiles(): Promise<boolean> {
		const stored = loadFiles();
		if (stored.csv === undefined && stored.pdf === undefined) return false;

		clearKey('files');

		this.reset();
		if (stored.pdf !== undefined) {
			await this.applyPdf(toBytes(stored.pdf.base64), stored.pdf.name, { persist: false });
		}
		if (stored.csv !== undefined) {
			await this.applyCsv(stored.csv.text, stored.csv.name, { persist: false });
		}
		if (!this.hasStatement) return false;

		this.library.setActive('');
		await this.saveCurrent();
		return true;
	}

	/** Put a saved statement on screen, in place of whatever is there now. */
	async openEntry(id: string): Promise<void> {
		const payload = await this.library.open(id);
		if (payload === null) {
			// Deleted in another tab, or the store was cleared under us.
			if (this.library.activeId === id) this.library.setActive('');
			return;
		}

		this.reset();
		this.busy = payload.pdf !== undefined ? 'pdf' : 'csv';
		try {
			if (payload.pdf !== undefined) {
				await this.applyPdf(payload.pdf.bytes, payload.pdf.name, { persist: false });
			}
			if (payload.csv !== undefined) {
				await this.applyCsv(payload.csv.text, payload.csv.name, { persist: false });
			}
		} finally {
			this.busy = null;
		}
	}

	/**
	 * Clear the screen so the next upload starts its own entry.
	 *
	 * Not a delete: the statement being closed is already filed, and this is the
	 * difference between adding February's export to January's statement and
	 * filing it as February's.
	 */
	startNew(): void {
		this.reset();
		this.library.setActive('');
	}

	/** Take a statement out of the history, closing it if it is the one open. */
	async deleteEntry(id: string): Promise<void> {
		const wasOpen = this.library.activeId === id;

		await this.library.remove(id);
		if (wasOpen) this.reset();
	}

	/** Forget every saved statement, and close the one on screen. */
	async clearAll(): Promise<void> {
		this.reset();
		await this.library.clearAll();
	}

	/**
	 * Turn keeping uploads on this device on or off.
	 *
	 * Turning it back on files what is already on screen, so the setting reads as
	 * "keep my statements" rather than "keep the ones after this".
	 */
	async setKeepUploads(keep: boolean): Promise<void> {
		await this.library.setKeepUploads(keep);
		if (keep) await this.saveCurrent();
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
				await this.applyCsv(await file.text(), file.name);
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
			this.pdfBytes = bytes;
			this.error = null;
			this.selectDefaultAccount();

			if (options.persist !== false) await this.saveCurrent();
		} catch (error: unknown) {
			this.error = describe(error, fileName);
		}
	}

	private async applyCsv(
		text: string,
		fileName: string,
		options: { persist?: boolean } = {}
	): Promise<void> {
		try {
			const result = parseStatement(text);

			this.csvTransactions = result.transactions;
			this.csvIssues = result.issues;
			this.csvName = fileName;
			this.csvText = text;
			this.error = null;
			this.selectDefaultAccount();

			if (options.persist !== false) await this.saveCurrent();
		} catch (error: unknown) {
			this.error = describe(error, fileName);
		}
	}

	/**
	 * File the statement on screen, under the entry it belongs to.
	 *
	 * A statement with no entry yet is given one here, which is what makes the
	 * first file of a pair open a new history entry and the second update it.
	 */
	private async saveCurrent(): Promise<void> {
		if (!this.hasStatement) return;
		// Checked before an id is handed out, not just before the write: an id
		// pointing at a statement that was never filed would send the next visit
		// looking for one, and it would report the miss as something going wrong.
		if (!this.library.keepUploads) return;

		if (this.library.activeId === '') this.library.setActive(crypto.randomUUID());

		await this.library.save(this.library.activeId, {
			pdf: this.pdfBytes === null ? undefined : { name: this.pdfName, bytes: this.pdfBytes },
			csv: this.csvText === '' ? undefined : { name: this.csvName, text: this.csvText },
			summary: this.summarise()
		});
	}

	/**
	 * The stored anchors, reduced to the ones still true of this statement.
	 *
	 * An anchor is measured after an account's most recent transaction, so a
	 * newer export moves the ground under it: the account name is unchanged and
	 * the balance is stale. Each is checked against its own account's last date
	 * rather than the statement's, since accounts stop on different days.
	 */
	private resolveAnchors(): Record<string, number> {
		const lastDates: Record<string, string> = {};
		// Oldest first, so the last date written for an account is its most recent.
		for (const transaction of this.transactions) lastDates[transaction.account] = transaction.date;

		const resolved: Record<string, number> = {};
		for (const [account, anchor] of Object.entries(this.anchors)) {
			if (account === ALL_ACCOUNTS) continue;
			if (anchor.asOf !== lastDates[account]) continue;

			resolved[account] = anchor.balance;
		}

		return resolved;
	}

	/** What the history list says about this statement, without reopening it. */
	private summarise(): StatementSummary {
		return {
			from: this.transactions[0]?.date ?? '',
			to: this.transactions.at(-1)?.date ?? '',
			accounts: [...this.accounts],
			transactionCount: this.transactions.length
		};
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

	/**
	 * Move the day the reader's months open on.
	 *
	 * The month picker's selection is left alone: it is re-derived against the new
	 * cut, and {@link activeMonth} already falls back to the newest month when the
	 * one it named no longer exists.
	 *
	 * @param day 1 to 28 — see {@link readMonthStart} for why it stops there.
	 */
	setMonthStart(day: number): void {
		this.monthStart = readMonthStart(day);
		saveMonthStart(this.monthStart);
	}

	/** Step the month view one month either way, stopping at the ends. */
	stepMonth(offset: number): void {
		const index = this.months.indexOf(this.activeMonth);
		if (index < 0) return;

		const next = this.months[index + offset];
		if (next !== undefined) this.selectedMonth = next;
	}

	async remove(kind: SourceKind): Promise<void> {
		if (kind === 'pdf') {
			this.pdfStatement = null;
			this.pdfName = '';
			this.pdfBytes = null;
		} else {
			this.csvTransactions = [];
			this.csvIssues = [];
			this.csvName = '';
			this.csvText = '';
		}

		this.error = null;
		if (this.hasStatement) {
			this.selectDefaultAccount();
			await this.saveCurrent();
			return;
		}

		// The last file is gone, so there is no statement left to keep.
		const id = this.library.activeId;
		if (id !== '') await this.deleteEntry(id);
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

	/**
	 * File every unfiled transaction from a merchant under one category.
	 *
	 * Kept on this device, and left in place when the files are cleared: the
	 * labelling is the reader's, not the statement's, and next month's export
	 * arrives with the same merchants unfiled.
	 *
	 * @param category One of {@link categoryOptions}, or a name of the reader's
	 * own — resolved by {@link resolveCategory}, so a name already on the list is
	 * filed under the one that is there rather than beside it. A blank drops the
	 * rule again, and a name that means nothing is ignored.
	 */
	setCategory(merchant: string, category: string): void {
		const next = { ...this.categoryRules };
		if (category === '') {
			delete next[merchant];
		} else {
			const resolved = resolveCategory(category, this.categoryOptions);
			if (resolved === null) return;

			next[merchant] = resolved;
			this.rememberCategory(resolved);
		}

		this.categoryRules = next;
		saveCategoryRules(next);
	}

	/**
	 * Keep a chosen category, and put it at the head of the shortlist.
	 *
	 * A name the statement itself does not carry is one the reader invented, and
	 * is kept in its own right — otherwise re-filing that merchant somewhere else
	 * would take the category down with the rule, and it would have to be typed
	 * again.
	 */
	private rememberCategory(category: string): void {
		const recent = withRecentCategory(this.recentCategories, category);
		this.recentCategories = recent;
		saveRecentCategories(recent);

		const known = categoryOptions(this.transactions);
		if (known.includes(category) || this.ownCategories.includes(category)) return;

		const own = [...this.ownCategories, category];
		this.ownCategories = own;
		saveOwnCategories(own);
	}

	/**
	 * Count a forecast charge, or stop counting it.
	 *
	 * @param key A charge's {@link ExpectedPayment.key}.
	 * @param counted Whether the projection should include it.
	 */
	setChargeCounted(key: string, counted: boolean): void {
		// Taken out either way, then put back on the end when it is not counted:
		// one path, and no way to list the same charge twice.
		const rest = this.droppedCharges.filter((dropped) => dropped !== key);
		const next = counted ? rest : [...rest, key];

		this.droppedCharges = next;
		saveDroppedCharges(next);
	}

	/**
	 * Count every forecast charge again, forgetting every choice.
	 *
	 * All of them, not only the ones a page happens to be showing: a choice with
	 * no row left to sit on is the one a reader has no other way to undo.
	 */
	clearDroppedCharges(): void {
		this.droppedCharges = [];
		saveDroppedCharges([]);
	}

	/**
	 * Add a charge to the forecast, or replace one already added.
	 *
	 * Replaced by key rather than appended, so vouching for the same payee twice
	 * — or editing a charge of the reader's own — leaves one row and not two.
	 * Adding one also counts it again, since ticking a charge off and then adding
	 * it back can only mean the reader has changed their mind.
	 */
	addCharge(charge: AddedCharge): void {
		const key = addedKey(charge);
		const rest = this.addedCharges.filter((added) => addedKey(added) !== key);

		this.addedCharges = [...rest, charge];
		saveAddedCharges(this.addedCharges);
		this.setChargeCounted(key, true);
	}

	/**
	 * Stop counting a charge.
	 *
	 * A payee the reader vouched for off last month's list is un-vouched rather
	 * than struck through. The row exists only because of that tick, so taking
	 * the tick away should put it back where it was — one of last month's offers,
	 * ready to be ticked again — instead of leaving a struck line that only a
	 * second, different control can undo.
	 *
	 * A charge they typed keeps its row and is merely uncounted: retyping one is
	 * not one click, and the row is the only copy of what they typed.
	 */
	stopCounting(key: string): void {
		const vouched = this.addedCharges.some(
			(charge) => charge.kind === 'merchant' && addedKey(charge) === key
		);

		if (vouched) this.removeCharge(key);
		else this.setChargeCounted(key, false);
	}

	/**
	 * Take a charge the reader added back out of the forecast.
	 *
	 * Its tick goes with it: a key nothing can name again is state with nothing
	 * left to say.
	 */
	removeCharge(key: string): void {
		const rest = this.addedCharges.filter((added) => addedKey(added) !== key);
		// Only what was actually removed gives up its tick. A key naming a charge
		// the history found is not the reader's to remove, and quietly counting it
		// again would undo a choice they had made about something else.
		if (rest.length === this.addedCharges.length) return;

		this.addedCharges = rest;
		saveAddedCharges(rest);
		this.setChargeCounted(key, true);
	}

	/** Drop the statement on screen. The history is not touched. */
	private reset(): void {
		this.pdfStatement = null;
		this.csvTransactions = [];
		this.csvIssues = [];
		this.pdfName = '';
		this.csvName = '';
		this.pdfBytes = null;
		this.csvText = '';
		this.error = null;
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

/** Only the old local-storage scheme needed base64; the library takes bytes. */
function toBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
