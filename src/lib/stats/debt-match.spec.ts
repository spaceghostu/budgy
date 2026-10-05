import { beforeEach, describe, expect, it } from 'vitest';
import { matchDebts, normaliseCreditor, toDebtCharges } from './debt-match.ts';
import type { Payee } from './forecast.ts';
import { makeCreditAccount, resetCreditAccountIds } from '../testing/credit.ts';

function payee(overrides: Partial<Payee> & Pick<Payee, 'merchant'>): Payee {
	return {
		flow: 'expense',
		amount: 500,
		months: 3,
		arrived: false,
		category: 'Debt Repayment',
		isDebitOrder: true,
		...overrides
	};
}

beforeEach(() => resetCreditAccountIds());

describe('normaliseCreditor', () => {
	it('keeps the words that say which lender it is', () => {
		expect(normaliseCreditor('Example Bank (Pty) Ltd')).toEqual(['EXAMPLE']);
		expect(normaliseCreditor('EXAMPLE 004123 LOAN')).toEqual(['EXAMPLE']);
	});

	it('reads two spellings of one lender as one', () => {
		expect(normaliseCreditor('First National Bank')).toEqual(normaliseCreditor('FNB'));
	});
});

describe('matchDebts', () => {
	it('pairs a lender with the truncated name its debit order carries', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind Finance (Pty) Ltd' });
		const [match] = matchDebts([loan], [payee({ merchant: 'NORTHW PL 00412', amount: 520 })], {});

		expect(match).toMatchObject({ merchant: 'NORTHW PL 00412', origin: 'suggested' });
		expect(match.score).toBeGreaterThan(0.6);
	});

	it('refuses a loan whose instalment is nowhere near what the payee takes', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind', instalment: 500 });
		const [match] = matchDebts([loan], [payee({ merchant: 'NORTHWIND', amount: 700 })], {});

		expect(match).toEqual({ accountId: 'loan', merchant: null, score: 0, origin: 'none' });
	});

	it('does not hold a card to its minimum, which is paid several times over', () => {
		const card = makeCreditAccount({
			id: 'card',
			kind: 'card',
			creditor: 'Northwind',
			instalment: 300
		});
		const [match] = matchDebts([card], [payee({ merchant: 'NORTHWIND', amount: 2000 })], {});

		expect(match.origin).toBe('suggested');
	});

	it('does not pair a card with the same bank’s monthly fee', () => {
		// The card and the fee share the one word that names the bank, and a card
		// is not held to its minimum — so only what kind of payment it is tells
		// them apart.
		const card = makeCreditAccount({
			id: 'card',
			kind: 'card',
			creditor: 'Northwind Bank Credit Card',
			instalment: 600
		});
		const fee = payee({
			merchant: 'Northwind Bank Monthly Account Fee',
			amount: 69.5,
			category: 'Bank Fees',
			isDebitOrder: false
		});

		expect(matchDebts([card], [fee], {})[0].origin).toBe('none');
	});

	it('treats a link to a payee the open statement lacks as nothing paying the debt', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind', instalment: 500 });
		const settings = { loan: { link: 'A PAYEE FROM LAST YEAR' } };
		const matches = matchDebts([loan], [payee({ merchant: 'Gym' })], settings);

		expect(matches[0]).toMatchObject({ merchant: 'A PAYEE FROM LAST YEAR', origin: 'missing' });
		expect(toDebtCharges([loan], matches, settings)[0].linkedMerchant).toBeNull();
	});

	it('refuses a payee that only shares the words every lender has', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind Bank' });
		const [match] = matchDebts([loan], [payee({ merchant: 'CONTOSO BANK' })], {});

		expect(match.origin).toBe('none');
	});

	it('gives one debit order to one debt, and to the better fit', () => {
		const near = makeCreditAccount({ id: 'near', creditor: 'Northwind', instalment: 500 });
		const far = makeCreditAccount({ id: 'far', creditor: 'Northwind', instalment: 560 });
		const matches = matchDebts([far, near], [payee({ merchant: 'NORTHWIND', amount: 500 })], {});

		expect(matches.map((match) => [match.accountId, match.origin])).toEqual([
			['far', 'none'],
			['near', 'suggested']
		]);
	});

	it('takes the link the reader made over a better-looking suggestion', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind' });
		const payees = [payee({ merchant: 'NORTHWIND' }), payee({ merchant: 'SOMETHING ELSE' })];
		const [match] = matchDebts([loan], payees, { loan: { link: 'SOMETHING ELSE' } });

		expect(match).toEqual({
			accountId: 'loan',
			merchant: 'SOMETHING ELSE',
			score: 1,
			origin: 'confirmed'
		});
	});

	it('keeps a confirmed payee off the table for every other debt', () => {
		const first = makeCreditAccount({ id: 'first', creditor: 'Contoso' });
		const second = makeCreditAccount({ id: 'second', creditor: 'Northwind' });
		const matches = matchDebts([first, second], [payee({ merchant: 'NORTHWIND' })], {
			first: { link: 'NORTHWIND' }
		});

		expect(matches[1].origin).toBe('none');
	});

	it('never suggests a payee again for a debt the reader said is not on the statement', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind' });
		const [match] = matchDebts([loan], [payee({ merchant: 'NORTHWIND' })], {
			loan: { link: null }
		});

		expect(match).toEqual({ accountId: 'loan', merchant: null, score: 0, origin: 'unlinked' });
	});

	it('does not take money coming in for a debt being paid', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind' });
		const [match] = matchDebts([loan], [payee({ merchant: 'NORTHWIND', flow: 'income' })], {});

		expect(match.origin).toBe('none');
	});

	it('comes to the same pairs whatever order the debts and payees arrive in', () => {
		const debts = [
			makeCreditAccount({ id: 'a', creditor: 'Northwind', instalment: 500 }),
			makeCreditAccount({ id: 'b', creditor: 'Contoso', instalment: 900 })
		];
		const payees = [
			payee({ merchant: 'CONTOSO', amount: 900 }),
			payee({ merchant: 'NORTHWIND', amount: 500 })
		];
		const byId = (matches: ReturnType<typeof matchDebts>) =>
			[...matches].sort((x, y) => x.accountId.localeCompare(y.accountId));

		expect(byId(matchDebts([...debts].reverse(), [...payees].reverse(), {}))).toEqual(
			byId(matchDebts(debts, payees, {}))
		);
	});
});

describe('toDebtCharges', () => {
	it('hands the forecast each instalment, with the payee that pays it', () => {
		const loan = makeCreditAccount({ id: 'loan', creditor: 'Northwind', instalment: 500 });
		const store = makeCreditAccount({ id: 'store', creditor: 'Contoso', instalment: 250 });
		const settings = { store: { paymentDay: 25 } };
		const matches = matchDebts([loan, store], [payee({ merchant: 'NORTHWIND' })], settings);

		expect(toDebtCharges([loan, store], matches, settings)).toEqual([
			{ accountId: 'loan', name: 'Northwind', amount: 500, day: 1, linkedMerchant: 'NORTHWIND' },
			{ accountId: 'store', name: 'Contoso', amount: 250, day: 25, linkedMerchant: null }
		]);
	});

	it('expects nothing for a debt the bureau gave no instalment for', () => {
		const card = makeCreditAccount({ id: 'card', kind: 'card', instalment: 0 });

		expect(toDebtCharges([card], matchDebts([card], [], {}), {})).toEqual([]);
	});
});
