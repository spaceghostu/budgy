import { describe, expect, it } from 'vitest';
import { buildPayoff, comparePayoffs, PAYOFF_HORIZON_MONTHS, type PayoffDebt } from './payoff.ts';

function debt(overrides: Partial<PayoffDebt> & Pick<PayoffDebt, 'id'>): PayoffDebt {
	return { name: overrides.id, balance: 10_000, instalment: 500, annualRate: 12, ...overrides };
}

/** A dear small card and a cheap large loan — the pair the two orderings split on. */
const card = debt({ id: 'card', balance: 6000, instalment: 300, annualRate: 21 });
const loan = debt({ id: 'loan', balance: 3000, instalment: 300, annualRate: 9 });

describe('buildPayoff', () => {
	it('clears a single loan in the month the amortisation formula gives', () => {
		const plan = buildPayoff([debt({ id: 'loan' })], { extra: 0, strategy: 'minimums' });

		// n = -ln(1 - rB/P) / ln(1 + r), with r = 1% a month.
		const formula = Math.ceil(-Math.log(1 - (0.01 * 10_000) / 500) / Math.log(1.01));
		expect(plan.months).toBe(formula);

		// The same loan carried forward in plain floating point, as a second opinion.
		let balance = 10_000;
		let interest = 0;
		while (balance > 0) {
			interest += balance * 0.01;
			balance = balance * 1.01 - Math.min(500, balance * 1.01);
		}
		expect(Math.abs(plan.totalInterest - interest)).toBeLessThan(1);
	});

	it('clears a debt with no interest in balance over instalment months', () => {
		const plan = buildPayoff([debt({ id: 'loan', balance: 1050, annualRate: 0 })], {
			extra: 0,
			strategy: 'minimums'
		});

		expect(plan.months).toBe(3);
		expect(plan.totalInterest).toBe(0);
	});

	it('rolls a cleared instalment into the next debt', () => {
		const small = debt({ id: 'small', balance: 1000, instalment: 500, annualRate: 0 });
		const large = debt({ id: 'large', balance: 3000, instalment: 500, annualRate: 0 });

		const alone = buildPayoff([small, large], { extra: 0, strategy: 'minimums' });
		const rolled = buildPayoff([small, large], { extra: 0, strategy: 'snowball' });

		expect(alone.months).toBe(6);
		// Two months of 500 each, then 1 000 a month against the 2 000 left.
		expect(rolled.months).toBe(4);
	});

	it('sends spare money to the highest rate first on an avalanche', () => {
		const plan = buildPayoff([loan, card], { extra: 500, strategy: 'avalanche' });

		expect(plan.debts.map((entry) => entry.id)).toEqual(['card', 'loan']);
	});

	it('sends spare money to the smallest balance first on a snowball', () => {
		const plan = buildPayoff([card, loan], { extra: 500, strategy: 'snowball' });

		expect(plan.debts.map((entry) => entry.id)).toEqual(['loan', 'card']);
	});

	it('never costs more interest on an avalanche than on a snowball', () => {
		const { avalanche, snowball, minimums } = comparePayoffs([card, loan], 500);

		expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
		expect(snowball.totalInterest).toBeLessThan(minimums.totalInterest);
		expect(avalanche.months).toBeLessThan(minimums.months ?? 0);
	});

	it('ranks a debt with no rate after the ones that have one, and counts it', () => {
		const unknown = debt({ id: 'store', balance: 500, annualRate: null });
		const plan = buildPayoff([unknown, loan, card], { extra: 200, strategy: 'avalanche' });

		expect(plan.debts.map((entry) => entry.id)).toEqual(['card', 'loan', 'store']);
		expect(plan.ratesMissing).toBe(1);
		expect(plan.effective).toBe('avalanche');
		expect(plan.debts.at(-1)?.rateKnown).toBe(false);
	});

	it('falls back to smallest balance first when no rate is known at all', () => {
		const plan = buildPayoff(
			[debt({ id: 'big', annualRate: null }), debt({ id: 'tiny', balance: 800, annualRate: null })],
			{ extra: 100, strategy: 'avalanche' }
		);

		expect(plan.effective).toBe('snowball');
		expect(plan.debts.map((entry) => entry.id)).toEqual(['tiny', 'big']);
	});

	it('says when an instalment does not cover the interest, and that it never clears alone', () => {
		// 24% on 10 000 is 200 a month; 150 loses ground every month.
		const sinking = debt({ id: 'sinking', instalment: 150, annualRate: 24 });
		const plan = buildPayoff([sinking], { extra: 0, strategy: 'minimums' });

		expect(plan.months).toBeNull();
		expect(plan.debts[0].clearsIn).toBeNull();
		expect(plan.debts[0].shortOfInterest).toBe(true);
		expect(plan.timeline).toHaveLength(PAYOFF_HORIZON_MONTHS);
		expect(Number.isFinite(plan.totalInterest)).toBe(true);
	});

	it('stops counting interest on a balance it has stopped following', () => {
		// 30% on 1 000 against 5 a month runs away to the ceiling of ten times the
		// opening balance. No more than that can ever have been added to it.
		const runaway = debt({ id: 'runaway', balance: 1000, instalment: 5, annualRate: 30 });
		const plan = buildPayoff([runaway], { extra: 0, strategy: 'minimums' });

		expect(plan.totalInterest).toBeLessThanOrEqual(1000 * 9 + 5 * PAYOFF_HORIZON_MONTHS);
	});

	it('clears that same debt once there is spare money to reach it', () => {
		const sinking = debt({ id: 'sinking', instalment: 150, annualRate: 24 });
		const plan = buildPayoff([sinking], { extra: 400, strategy: 'avalanche' });

		expect(plan.months).not.toBeNull();
		expect(plan.debts[0].shortOfInterest).toBe(true);
	});

	it('assumes a minimum for a card the bureau gave no instalment for', () => {
		const plan = buildPayoff([debt({ id: 'card', instalment: 0, annualRate: 20 })], {
			extra: 0,
			strategy: 'minimums'
		});

		expect(plan.debts[0].minimumEstimated).toBe(true);
		expect(plan.months).not.toBeNull();
	});

	it('ignores spare money when asked what the minimums alone do', () => {
		const plan = buildPayoff([debt({ id: 'loan', annualRate: 0 })], {
			extra: 5000,
			strategy: 'minimums'
		});

		expect(plan.months).toBe(20);
	});

	it('comes to the same plan whatever order the debts arrive in', () => {
		const options = { extra: 250, strategy: 'avalanche' } as const;

		expect(buildPayoff([card, loan], options)).toEqual(buildPayoff([loan, card], options));
	});

	it('has nothing to plan for no debts, or for ones already settled', () => {
		const plan = buildPayoff([debt({ id: 'paid', balance: 0 })], {
			extra: 0,
			strategy: 'snowball'
		});

		expect(plan.months).toBe(0);
		expect(plan.debts).toEqual([]);
		expect(plan.timeline).toEqual([]);
	});
});
