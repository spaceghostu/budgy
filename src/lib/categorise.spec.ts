import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyCategoryRules,
	isUncategorised,
	listRules,
	bankCategoryFor,
	resolveCategory,
	categoryOptions,
	uncategorisedGroups
} from './categorise.ts';
import { buildInsights } from './stats/insights.ts';
import { makeTransaction, resetTransactionIds } from './testing/transaction.ts';

beforeEach(() => resetTransactionIds());

/** A row the bank left blank, the way a PDF-only line arrives. */
function blank(overrides: Parameters<typeof makeTransaction>[0]) {
	return makeTransaction({
		bankCategory: 'Uncategorised',
		category: 'Uncategorised',
		...overrides
	});
}

describe('isUncategorised', () => {
	it('recognises the label both exports use', () => {
		expect(isUncategorised('Uncategorised')).toBe(true);
	});

	it('recognises it whatever the casing and spacing', () => {
		expect(isUncategorised('  UNCATEGORISED ')).toBe(true);
	});

	it('counts a missing label as one too', () => {
		expect(isUncategorised('')).toBe(true);
	});

	it('leaves a real category alone', () => {
		expect(isUncategorised('Groceries')).toBe(false);
	});
});

describe('categoryOptions', () => {
	it('offers the bank’s own list when the statement has none', () => {
		const options = categoryOptions([blank({ date: '2026-01-05', amount: -120 })]);

		expect(options).toContain('Groceries');
		expect(options).toContain('Eating Out and Takeouts');
		expect(options).toContain('Transfers');
	});

	it('never offers "Uncategorised" as something to choose', () => {
		expect(categoryOptions([blank({ date: '2026-01-05', amount: -120 })])).not.toContain(
			'Uncategorised'
		);
	});

	it('adds anything the statement itself uses', () => {
		const options = categoryOptions([
			makeTransaction({ date: '2026-01-05', amount: -120, category: 'School fees' })
		]);

		expect(options).toContain('School fees');
	});

	it('lists each category once, whatever case the file wrote it in', () => {
		const options = categoryOptions([
			makeTransaction({ date: '2026-01-05', amount: -120, category: 'groceries' })
		]);

		expect(options.filter((option) => option.toLowerCase() === 'groceries')).toHaveLength(1);
	});

	it('sorts them, so the list does not reorder itself as rows load', () => {
		const options = categoryOptions([]);

		expect([...options].sort((a, b) => a.localeCompare(b))).toEqual(options);
	});

	it('keeps offering one of the reader’s own that this statement never uses', () => {
		expect(categoryOptions([], ['School fees'])).toContain('School fees');
	});
});

describe('resolveCategory', () => {
	it('takes a name the reader typed', () => {
		expect(resolveCategory('School fees', [])).toBe('School fees');
	});

	it('tidies the spacing, so one category cannot arrive twice', () => {
		expect(resolveCategory('  School   fees ', [])).toBe('School fees');
	});

	it('answers with the existing category when the name is already taken', () => {
		expect(resolveCategory('groceries', ['Groceries'])).toBe('Groceries');
	});

	it('refuses a name that says nothing', () => {
		expect(resolveCategory('   ', [])).toBeNull();
	});

	it('refuses to make one out of what these rows already are', () => {
		expect(resolveCategory('Uncategorised', [])).toBeNull();
	});

	it('keeps a name to a label rather than a sentence', () => {
		expect(resolveCategory('x'.repeat(80), [])).toHaveLength(40);
	});
});

describe('bankCategoryFor', () => {
	it('takes the statement’s own pairing first', () => {
		const filed = [
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				bankCategory: 'Groceries and household',
				category: 'Groceries'
			})
		];

		expect(bankCategoryFor('Groceries', filed)).toBe('Groceries and household');
	});

	it('falls back to the bank’s taxonomy when these files never say', () => {
		expect(bankCategoryFor('Groceries', [])).toBe('Food and Drink');
	});

	it('knows a category of the reader’s own sits under nothing in particular', () => {
		expect(bankCategoryFor('School fees', [])).toBeNull();
	});
});

describe('applyCategoryRules', () => {
	const rows = [
		blank({ date: '2026-01-05', amount: -120, merchant: 'CORNER SHOP' }),
		blank({ date: '2026-01-09', amount: -80, merchant: 'CORNER SHOP' }),
		makeTransaction({
			date: '2026-01-11',
			amount: -300,
			merchant: 'GYM',
			bankCategory: 'Recreation',
			category: 'Sport and Fitness'
		})
	];

	it('leaves the statement untouched when nothing has been filed', () => {
		expect(applyCategoryRules(rows, {})).toBe(rows);
	});

	it('files every unfiled row from the merchant', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': 'Groceries' });

		expect(applied.map((row) => row.category)).toEqual([
			'Groceries',
			'Groceries',
			'Sport and Fitness'
		]);
	});

	it('gives the row the bank heading its new category sits under', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': 'Groceries' });

		expect(applied[0].bankCategory).toBe('Food and Drink');
	});

	it('moves the heading with the category, whatever the bank had said', () => {
		// The heading is not a second opinion about where the row belongs — it is
		// what says whether the row is spending at all. Leaving it behind would
		// file a row as Groceries under Miscellaneous, which is neither.
		const partlyFiled = [
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				merchant: 'CORNER SHOP',
				bankCategory: 'Miscellaneous',
				category: 'Uncategorised'
			})
		];
		const applied = applyCategoryRules(partlyFiled, { 'CORNER SHOP': 'Groceries' });

		expect(applied[0]).toMatchObject({ bankCategory: 'Food and Drink', category: 'Groceries' });
	});

	it('overrides what the bank filed — the reader has the last word', () => {
		// The bank does not know the gym membership was a medical referral. A
		// breakdown that cannot be corrected is one a reader stops trusting.
		const applied = applyCategoryRules(rows, { GYM: 'Healthcare' });

		expect(applied[2]).toMatchObject({
			category: 'Healthcare',
			bankCategory: 'Health and Personal Care'
		});
	});

	it('moves an overridden row out of the bucket it was in', () => {
		const insights = buildInsights(applyCategoryRules(rows, { GYM: 'Healthcare' }), 0);

		expect(
			insights.categories.find((bucket) => bucket.label === 'Sport and Fitness')
		).toBeUndefined();
		expect(insights.categories.find((bucket) => bucket.label === 'Healthcare')?.total).toBe(300);
	});

	it('takes a row the bank filed out of spending when it is overridden to a transfer', () => {
		const applied = applyCategoryRules(rows, { GYM: 'Transfers' });

		expect(applied[2].flow).toBe('transfer');
		// The gym's 300 leaves; the two unfiled rows are still spending.
		expect(buildInsights(applied, 0).summary.expense).toBe(200);
	});

	it('takes the reader’s word over a heading that said the row was a transfer', () => {
		// The bank filed no category but called it an own-account move. Being told
		// it was groceries settles both questions, not one of them.
		const misfiled = [
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				merchant: 'CORNER SHOP',
				bankCategory: 'Not for Financial Analyser',
				category: 'Uncategorised',
				flow: 'transfer'
			})
		];
		const applied = applyCategoryRules(misfiled, { 'CORNER SHOP': 'Groceries' });

		expect(applied[0]).toMatchObject({ flow: 'expense', bankCategory: 'Food and Drink' });
	});

	it('leaves a row alone when the rule says what it already says', () => {
		// Not merely equal — the same object, so nothing downstream rebuilds.
		const applied = applyCategoryRules(rows, { GYM: 'Sport and Fitness' });

		expect(applied[2]).toBe(rows[2]);
	});

	it('reads a rule that differs only in casing as the category it names', () => {
		const applied = applyCategoryRules(rows, { GYM: 'sport and fitness' });

		expect(applied[2]).toBe(rows[2]);
	});

	it('keeps the classification when overridden to a name the bank never heard of', () => {
		// Renaming a bucket says nothing about whether the money left the household.
		const applied = applyCategoryRules(rows, { GYM: 'School fees' });

		expect(applied[2]).toMatchObject({
			category: 'School fees',
			bankCategory: 'Recreation',
			flow: 'expense'
		});
	});

	it('leaves merchants without a rule alone', () => {
		const applied = applyCategoryRules(rows, { SOMEWHERE_ELSE: 'Homeware' });

		expect(applied.map((row) => row.category)).toEqual([
			'Uncategorised',
			'Uncategorised',
			'Sport and Fitness'
		]);
	});

	it('changes nothing when applied twice', () => {
		const rules = { 'CORNER SHOP': 'Groceries' };
		const once = applyCategoryRules(rows, rules);

		expect(applyCategoryRules(once, rules)).toEqual(once);
	});

	it('moves the spending into its new bucket', () => {
		const insights = buildInsights(applyCategoryRules(rows, { 'CORNER SHOP': 'Coffee' }), 0);

		expect(insights.categories.find((bucket) => bucket.label === 'Coffee')?.total).toBe(200);
		expect(insights.categories.find((bucket) => bucket.label === 'Uncategorised')).toBeUndefined();
	});

	it('stops treating a row as spending once it is filed as an own-account transfer', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': 'Transfers' });

		expect(applied[0].flow).toBe('transfer');
		expect(buildInsights(applied, 0).summary.expense).toBe(300);
	});

	it('counts a row as a bank charge once it is filed as one', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': 'Bank Fees' });

		expect(applied[0].isFee).toBe(true);
		expect(buildInsights(applied, 0).summary.fees).toBe(200);
	});

	it('takes a deposit as income under its new category', () => {
		const applied = applyCategoryRules(
			[blank({ date: '2026-01-25', amount: 8000, merchant: 'EMPLOYER' })],
			{ EMPLOYER: 'Income Salary' }
		);

		expect(applied[0].flow).toBe('income');
		expect(buildInsights(applied, 8000).summary.income).toBe(8000);
	});

	it('files a row under a name of the reader’s own without inventing a category for it', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': 'School fees' });

		expect(applied[0]).toMatchObject({ category: 'School fees', bankCategory: 'Uncategorised' });
	});

	it('ignores a rule left blank rather than blanking the category', () => {
		const applied = applyCategoryRules(rows, { 'CORNER SHOP': '' });

		expect(applied[0].category).toBe('Uncategorised');
	});
});

describe('uncategorisedGroups', () => {
	it('groups what is left by merchant, heaviest first', () => {
		const groups = uncategorisedGroups([
			blank({ date: '2026-01-05', amount: -120, merchant: 'CORNER SHOP' }),
			blank({ date: '2026-01-09', amount: -80, merchant: 'CORNER SHOP' }),
			blank({ date: '2026-01-11', amount: -900, merchant: 'LANDLORD' })
		]);

		expect(groups.map((group) => group.merchant)).toEqual(['LANDLORD', 'CORNER SHOP']);
		expect(groups[1]).toMatchObject({ count: 2, total: 200, lastSeen: '2026-01-09' });
	});

	it('leaves out everything the bank already filed', () => {
		const groups = uncategorisedGroups([
			makeTransaction({ date: '2026-01-05', amount: -120, merchant: 'GROCER' })
		]);

		expect(groups).toEqual([]);
	});

	it('asks about a row the bank filed at category level but no further', () => {
		const groups = uncategorisedGroups([
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				merchant: 'GROCER',
				bankCategory: 'Miscellaneous',
				category: 'Uncategorised'
			})
		]);

		expect(groups.map((group) => group.merchant)).toEqual(['GROCER']);
	});

	it('leaves out own-account transfers, which no breakdown counts anyway', () => {
		const groups = uncategorisedGroups([
			blank({
				date: '2026-01-05',
				amount: -500,
				merchant: 'INTER ACCOUNT TRANSFER',
				description: 'Inter account transfer',
				flow: 'transfer'
			})
		]);

		expect(groups).toEqual([]);
	});

	it('leaves out rows worth nothing', () => {
		const groups = uncategorisedGroups([
			blank({ date: '2026-01-05', amount: 0, merchant: 'REVERSAL', flow: 'noop' })
		]);

		expect(groups).toEqual([]);
	});

	it('suggests the category the same merchant already carries elsewhere', () => {
		const groups = uncategorisedGroups([
			makeTransaction({ date: '2026-01-05', amount: -120, merchant: 'GROCER' }),
			makeTransaction({ date: '2026-01-06', amount: -140, merchant: 'GROCER' }),
			blank({ date: '2026-01-09', amount: -80, merchant: 'GROCER' })
		]);

		expect(groups[0].suggestion).toBe('Groceries');
	});

	it('suggests the one the merchant is filed under most often', () => {
		const groups = uncategorisedGroups([
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				merchant: 'GROCER',
				category: 'Coffee'
			}),
			makeTransaction({ date: '2026-01-06', amount: -140, merchant: 'GROCER' }),
			makeTransaction({ date: '2026-01-07', amount: -160, merchant: 'GROCER' }),
			blank({ date: '2026-01-09', amount: -80, merchant: 'GROCER' })
		]);

		expect(groups[0].suggestion).toBe('Groceries');
	});

	it('settles a merchant filed both ways the same way every time', () => {
		const rows = [
			makeTransaction({
				date: '2026-01-05',
				amount: -120,
				merchant: 'GROCER',
				category: 'Coffee'
			}),
			makeTransaction({ date: '2026-01-06', amount: -140, merchant: 'GROCER' }),
			blank({ date: '2026-01-09', amount: -80, merchant: 'GROCER' })
		];

		expect(uncategorisedGroups(rows)[0].suggestion).toBe('Coffee');
		expect(uncategorisedGroups([...rows].reverse())[0].suggestion).toBe('Coffee');
	});

	it('suggests nothing when the merchant has never been filed', () => {
		const groups = uncategorisedGroups([blank({ date: '2026-01-09', amount: -80 })]);

		expect(groups[0].suggestion).toBeNull();
	});

	it('carries an example description, since a merchant name can read like a code', () => {
		const groups = uncategorisedGroups([
			blank({ date: '2026-01-09', amount: -80, merchant: 'ABC', description: 'ABC 998877' })
		]);

		expect(groups[0].example).toBe('ABC 998877');
	});
});

describe('listRules', () => {
	const rows = [
		blank({ date: '2026-01-05', amount: -120, merchant: 'CORNER SHOP' }),
		blank({ date: '2026-01-09', amount: -80, merchant: 'CORNER SHOP' }),
		makeTransaction({ date: '2026-01-11', amount: -300, merchant: 'CORNER SHOP' })
	];

	it('counts every row the rule moves, filed or not', () => {
		// Two unfiled rows and one the bank filed as Groceries: the choice moves
		// all three, and the list is where a reader sees how far it reaches.
		const listed = listRules({ 'CORNER SHOP': 'Homeware' }, rows);

		expect(listed).toEqual([{ merchant: 'CORNER SHOP', category: 'Homeware', count: 3 }]);
	});

	it('counts a row a rule would turn into spending', () => {
		const listed = listRules({ 'CORNER SHOP': 'Homeware' }, [
			...rows,
			blank({ date: '2026-01-12', amount: -50, merchant: 'CORNER SHOP', flow: 'transfer' })
		]);

		expect(listed[0].count).toBe(4);
	});

	it('counts nothing for a rule that says what the bank already said', () => {
		// The choice stands and stays removable; it simply moves nothing today.
		const listed = listRules({ 'CORNER SHOP': 'Groceries' }, [rows[2]]);

		expect(listed[0].count).toBe(0);
	});

	it('keeps a rule for a merchant this statement never mentions', () => {
		const listed = listRules({ LANDLORD: 'Levies' }, rows);

		expect(listed).toEqual([{ merchant: 'LANDLORD', category: 'Levies', count: 0 }]);
	});

	it('lists them by merchant, so the list holds still as rules are added', () => {
		const listed = listRules({ ZOO: 'Experiences', ARCADE: 'Digital Gaming' }, rows);

		expect(listed.map((rule) => rule.merchant)).toEqual(['ARCADE', 'ZOO']);
	});
});
