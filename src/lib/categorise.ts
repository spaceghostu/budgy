/**
 * Reader-supplied categories for the rows the bank left blank.
 *
 * A category here is the bank's sub-category — `Groceries`, `Fuel`, `Coffee` —
 * which is the level a reader can act on and the only level this app rolls up
 * by. See {@link Transaction.category}. A statement arrives only partly filed:
 * a PDF has no such column at all, and even the CSV files a good deal of real
 * spending under `Uncategorised`, enough to distort every breakdown on the
 * page.
 *
 * Rules are keyed by **merchant**, not by transaction. A transaction's id is
 * its position in a file (`csv:31`, `12345678901:4`), so loading the PDF beside
 * the CSV, or next month's export, renumbers them — and a label keyed by id
 * would then quietly land on a different transaction, the same trap the balance
 * anchor's `asOf` date exists to avoid. A merchant is derived from the
 * description and survives both, so one choice covers every row from that
 * merchant, in this statement and the next.
 *
 * Only unfiled rows are ever relabelled: what the bank said stays
 * authoritative, and applying the same rules twice changes nothing.
 */

import { classifyFlow, isFee, normaliseCategory } from './parse/normalise.ts';
import { round } from './stats/balance.ts';
import type { Transaction } from './types.ts';

/** What both exports call a row they have nothing to file under. */
export const UNCATEGORISED = 'Uncategorised';

/** Categories chosen by the reader, keyed by merchant. */
export type CategoryRules = Readonly<Record<string, string>>;

/** One of the bank's sub-categories, and the heading it sits under. */
export interface KnownCategory {
	readonly category: string;
	readonly bankCategory: string;
}

/**
 * The bank's own taxonomy.
 *
 * The list on screen is really the statement's own categories — the point is to
 * file a stray row beside the ones already there. This is the fallback for when
 * it cannot supply them: a certified PDF on its own has no such column, so every
 * row arrives unfiled and there would otherwise be nothing to choose from.
 *
 * The bank's heading beside each one is what makes a choice mean something
 * beyond a label: it is how `Transfers` still leaves spending and `Bank Fees`
 * still counts as a charge. See {@link bankCategoryFor}.
 */
export const BANK_CATEGORIES: readonly KnownCategory[] = [
	{ category: 'Accommodation', bankCategory: 'Recreation' },
	{ category: 'Adventure', bankCategory: 'Recreation' },
	{ category: 'Alcohol', bankCategory: 'Food and Drink' },
	{ category: 'Apps and Web Services', bankCategory: 'Miscellaneous' },
	{ category: 'Arts and Crafts', bankCategory: 'Miscellaneous' },
	{ category: 'Bank Fees', bankCategory: 'Fees and Interest' },
	{ category: 'Car Wash', bankCategory: 'Transport' },
	{ category: 'Clothes', bankCategory: 'Clothing' },
	{ category: 'Coffee', bankCategory: 'Food and Drink' },
	{ category: 'Courier Services', bankCategory: 'Miscellaneous' },
	{ category: 'Debt Repayment', bankCategory: 'Miscellaneous' },
	{ category: 'Digital Gaming', bankCategory: 'Recreation' },
	{ category: 'Digital Media', bankCategory: 'Recreation' },
	{ category: 'Donations', bankCategory: 'Miscellaneous' },
	{ category: 'Eating Out and Takeouts', bankCategory: 'Food and Drink' },
	{ category: 'Education', bankCategory: 'Miscellaneous' },
	{ category: 'Electronics', bankCategory: 'Home' },
	{ category: 'Events and Tickets', bankCategory: 'Recreation' },
	{ category: 'Experiences', bankCategory: 'Recreation' },
	{ category: 'Fabric and Yarn', bankCategory: 'Miscellaneous' },
	{ category: 'Flights', bankCategory: 'Transport' },
	{ category: 'Friends and Family', bankCategory: 'Miscellaneous' },
	{ category: 'Fuel', bankCategory: 'Transport' },
	{ category: 'Furniture', bankCategory: 'Home' },
	{ category: 'Gifts', bankCategory: 'Miscellaneous' },
	{ category: 'Groceries', bankCategory: 'Food and Drink' },
	{ category: 'Hair and Beauty', bankCategory: 'Health and Personal Care' },
	{ category: 'Health Products', bankCategory: 'Health and Personal Care' },
	{ category: 'Healthcare', bankCategory: 'Health and Personal Care' },
	{ category: 'Healthcare Services', bankCategory: 'Health and Personal Care' },
	{ category: 'Home Improvement', bankCategory: 'Home' },
	{ category: 'Homeware', bankCategory: 'Home' },
	{ category: 'Income Other', bankCategory: 'Other' },
	{ category: 'Income Salary', bankCategory: 'Salary' },
	{ category: 'Interest Earned', bankCategory: 'Interest Earned' },
	{ category: 'Interest Paid', bankCategory: 'Fees and Interest' },
	{ category: 'Levies', bankCategory: 'Home' },
	{ category: 'Medical Aid', bankCategory: 'Insurance' },
	{ category: 'Music', bankCategory: 'Recreation' },
	{ category: 'Other', bankCategory: 'Miscellaneous' },
	{ category: 'Parking', bankCategory: 'Transport' },
	{ category: 'Pets', bankCategory: 'Miscellaneous' },
	{ category: 'Phone and Internet', bankCategory: 'Home' },
	{ category: 'Printing', bankCategory: 'Miscellaneous' },
	{ category: 'Reading', bankCategory: 'Miscellaneous' },
	{ category: 'Savings Transfers', bankCategory: 'Not for Financial Analyser' },
	{ category: 'Short Term Insurance', bankCategory: 'Insurance' },
	{ category: 'Smoking', bankCategory: 'Miscellaneous' },
	{ category: 'Sport and Fitness', bankCategory: 'Recreation' },
	{ category: 'Stationery', bankCategory: 'Miscellaneous' },
	{ category: 'TV', bankCategory: 'Recreation' },
	{ category: 'Taxi', bankCategory: 'Transport' },
	{ category: 'Toll Fees', bankCategory: 'Transport' },
	{ category: 'Toys', bankCategory: 'Children' },
	{ category: 'Toys and Games', bankCategory: 'Recreation' },
	{ category: 'Train', bankCategory: 'Transport' },
	{ category: 'Transfers', bankCategory: 'Not for Financial Analyser' },
	{ category: 'Utilities and Rates', bankCategory: 'Home' },
	{ category: 'Vehicle Finance', bankCategory: 'Transport' },
	{ category: 'Vehicle Maintenance', bankCategory: 'Transport' },
	{ category: 'Water', bankCategory: 'Home' },
	{ category: 'Withdrawal', bankCategory: 'Cash' }
];

/** True when nothing is known about where this row belongs. */
export function isUncategorised(label: string): boolean {
	const normalised = normaliseCategory(label);
	return normalised === '' || normalised === normaliseCategory(UNCATEGORISED);
}

/**
 * Every category that can be chosen, alphabetically.
 *
 * What the statement uses, plus {@link BANK_CATEGORIES}, deduplicated
 * case-insensitively so a file that wrote `groceries` does not put a second
 * Groceries in the list.
 *
 * @param extra Categories of the reader's own that these files do not carry —
 * one made for a merchant this month's export happens not to mention would
 * otherwise drop off the list it was added to.
 */
export function categoryOptions(
	transactions: readonly Transaction[],
	extra: readonly string[] = []
): readonly string[] {
	const byKey = new Map<string, string>();

	const known = BANK_CATEGORIES.map((entry) => entry.category);
	for (const label of [...known, ...transactions.map((row) => row.category), ...extra]) {
		if (isUncategorised(label)) continue;

		const key = normaliseCategory(label);
		if (!byKey.has(key)) byKey.set(key, label.trim());
	}

	return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** The longest a category of the reader's own may be — a label, not a note. */
export const MAX_CATEGORY_LENGTH = 40;

/**
 * Take a category name the reader typed, and say what it means.
 *
 * A name that matches one of `options`, whatever its casing, resolves to that
 * one: two spellings of Groceries would otherwise split the same spending
 * across two bars.
 *
 * @returns the label to file under, or `null` when the name says nothing —
 * blank, or `Uncategorised`, which is what these rows already are.
 */
export function resolveCategory(name: string, options: readonly string[]): string | null {
	const trimmed = name.trim().replace(/\s+/g, ' ');
	if (trimmed === '' || isUncategorised(trimmed)) return null;

	const existing = options.find(
		(option) => normaliseCategory(option) === normaliseCategory(trimmed)
	);

	return existing ?? trimmed.slice(0, MAX_CATEGORY_LENGTH);
}

/**
 * The bank's own heading for a category, where that is known.
 *
 * The statement's own pairings come first — it is this reader's bank saying that
 * `Groceries` is Food and Drink — and the bank's published taxonomy stands in
 * when these particular files never mention it. A category the reader invented
 * sits under nothing in particular, and gets `null`.
 */
export function bankCategoryFor(
	category: string,
	transactions: readonly Transaction[]
): string | null {
	const key = normaliseCategory(category);
	const counts = new Map<string, number>();

	for (const transaction of transactions) {
		if (normaliseCategory(transaction.category) !== key) continue;
		if (isUncategorised(transaction.bankCategory)) continue;

		counts.set(transaction.bankCategory, (counts.get(transaction.bankCategory) ?? 0) + 1);
	}

	const seen = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).at(0);
	if (seen !== undefined) return seen[0];

	const known = BANK_CATEGORIES.find((entry) => normaliseCategory(entry.category) === key);
	return known?.bankCategory ?? null;
}

/**
 * Apply the reader's categories to the statement.
 *
 * @param transactions The statement as its files gave it.
 * @returns The same array when there is nothing to apply, so the derived chain
 * downstream does not rebuild on every keystroke elsewhere.
 */
export function applyCategoryRules(
	transactions: readonly Transaction[],
	rules: CategoryRules
): readonly Transaction[] {
	if (Object.keys(rules).length === 0) return transactions;

	return transactions.map((transaction) =>
		relabel(transaction, rules[transaction.merchant], transactions)
	);
}

function relabel(
	transaction: Transaction,
	category: string | undefined,
	transactions: readonly Transaction[]
): Transaction {
	if (category === undefined || category === '') return transaction;
	if (!isUncategorised(transaction.category)) return transaction;

	const filed = { ...transaction, category };

	// The bank's own heading still decides what the row *is* rather than only
	// where it is filed — its transfer and fee headings are read the same way
	// here as for an imported row, and every total downstream reads `flow`. So a
	// row the bank never filed takes the heading its new category sits under, and
	// is classified again from there.
	const heading = isUncategorised(transaction.bankCategory)
		? bankCategoryFor(category, transactions)
		: null;
	if (heading === null) return filed;

	const classifiable = {
		amount: transaction.amount,
		type: transaction.type,
		bankCategory: heading,
		description: transaction.description
	};

	return {
		...filed,
		bankCategory: heading,
		flow: classifyFlow(classifiable),
		isFee: isFee(classifiable)
	};
}

/** A merchant whose rows are still unfiled. */
export interface MerchantGroup {
	readonly merchant: string;
	readonly count: number;
	/** Positive magnitude of everything this merchant moved. */
	readonly total: number;
	readonly lastSeen: string;
	/** The most recent description, since a merchant name can read like a code. */
	readonly example: string;
	/** The category this merchant's other rows carry, when it has some. */
	readonly suggestion: string | null;
}

/**
 * True when a row is one the reader is asked about, and counted as covered once
 * they answer.
 *
 * Own-account transfers and zero-value rows are left out: no breakdown counts
 * them, so labelling one would change nothing on screen. A transfer the rules in
 * `parse/normalise.ts` did not recognise is still an expense at this point, so it
 * does appear — and filing it under `Transfers` is how the reader corrects that.
 */
function needsFiling(transaction: Transaction): boolean {
	return (
		isUncategorised(transaction.category) &&
		transaction.flow !== 'transfer' &&
		transaction.flow !== 'noop'
	);
}

/** What still needs a category, by merchant, heaviest first. */
export function uncategorisedGroups(
	transactions: readonly Transaction[]
): readonly MerchantGroup[] {
	const known = filedByMerchant(transactions);
	const groups = new Map<string, { count: number; total: number; latest: Transaction }>();

	for (const transaction of transactions) {
		if (!needsFiling(transaction)) continue;

		const group = groups.get(transaction.merchant);
		groups.set(transaction.merchant, {
			count: (group?.count ?? 0) + 1,
			total: (group?.total ?? 0) + Math.abs(transaction.amount),
			latest:
				group === undefined || transaction.timestamp >= group.latest.timestamp
					? transaction
					: group.latest
		});
	}

	return [...groups.entries()]
		.map(([merchant, group]) => ({
			merchant,
			count: group.count,
			total: round(group.total),
			lastSeen: group.latest.date,
			example: group.latest.description,
			suggestion: known.get(merchant) ?? null
		}))
		.sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant));
}

/**
 * The category each merchant is already filed under, where one is.
 *
 * A merchant that half matched the CSV is the common case — the matched rows
 * carry the bank's filing and the rest do not — so the answer is usually
 * sitting in the statement already.
 */
function filedByMerchant(transactions: readonly Transaction[]): Map<string, string> {
	const counts = new Map<string, Map<string, number>>();

	for (const transaction of transactions) {
		if (isUncategorised(transaction.category)) continue;

		const byCategory = counts.get(transaction.merchant) ?? new Map<string, number>();
		byCategory.set(transaction.category, (byCategory.get(transaction.category) ?? 0) + 1);
		counts.set(transaction.merchant, byCategory);
	}

	return new Map(
		[...counts.entries()].map(([merchant, byCategory]) => [
			merchant,
			[...byCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
		])
	);
}

/** A rule the reader has set, and how much of the statement it covers. */
export interface AppliedRule {
	readonly merchant: string;
	readonly category: string;
	readonly count: number;
}

/**
 * The rules in force, by merchant.
 *
 * @param transactions The statement as its files gave it, *before*
 * {@link applyCategoryRules} — the count is how many rows the choice covers,
 * which is only visible while they are still unfiled. It counts the same rows
 * {@link uncategorisedGroups} asked about, so a merchant listed as two
 * transactions does not become three the moment it is filed. A rule with no rows
 * at all is kept: rules outlive the statement that prompted them, and one for a
 * merchant this month has none of still has to be removable.
 */
export function listRules(
	rules: CategoryRules,
	transactions: readonly Transaction[]
): readonly AppliedRule[] {
	const counts = new Map<string, number>();
	for (const transaction of transactions) {
		if (!needsFiling(transaction)) continue;
		counts.set(transaction.merchant, (counts.get(transaction.merchant) ?? 0) + 1);
	}

	return Object.entries(rules)
		.map(([merchant, category]) => ({
			merchant,
			category,
			count: counts.get(merchant) ?? 0
		}))
		.sort((a, b) => a.merchant.localeCompare(b.merchant));
}
