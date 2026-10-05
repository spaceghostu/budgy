/**
 * Which debt to pay first, and what it is worth.
 *
 * The forecast answers whether this month's instalments can be met. This module
 * asks the longer question behind them: with the same instalments and whatever
 * can be spared on top, in what order do the debts go, when is the last one
 * gone, and what does the wait cost in interest.
 *
 * It is a simulation rather than a formula, one month at a time, because the
 * interesting part has no closed form: the moment a debt clears, its instalment
 * is free to go to the next one, and that roll-over is the whole reason an
 * ordering matters at all.
 *
 * Two things it cannot know, and says so rather than guessing:
 *
 * - **Rates.** A credit bureau reports balances and instalments, almost never
 *   the interest rate, so each one is the reader's to enter. A debt without a
 *   rate is simulated at no interest and ranked by balance, and
 *   {@link PayoffPlan.ratesMissing} counts them so a page can say the answer is
 *   only as good as what it was told.
 * - **Fees.** Monthly service fees and credit-life cover are not modelled, so
 *   {@link PayoffPlan.totalInterest} is a floor on what the debts cost.
 */

/**
 * - **avalanche** — highest rate first. The least interest paid, always.
 * - **snowball** — smallest balance first. Costs more, clears accounts sooner.
 * - **minimums** — every debt on its own instalment and nothing else, which is
 *   what happens if nothing is done. The line the other two are measured from.
 */
export type PayoffStrategy = 'avalanche' | 'snowball' | 'minimums';

/** One debt, as the simulation needs it. Amounts are positive rand. */
export interface PayoffDebt {
	readonly id: string;
	readonly name: string;
	readonly balance: number;
	/** Monthly. Zero where the bureau gave none — see {@link DebtPayoff.minimumEstimated}. */
	readonly instalment: number;
	/** Nominal annual rate as a percentage, or `null` when the reader has not said. */
	readonly annualRate: number | null;
}

/** What the plan says about one debt. */
export interface DebtPayoff {
	readonly id: string;
	readonly name: string;
	/** Place in the queue for spare money, 1 first. */
	readonly order: number;
	/** Months until it is gone, or `null` when it outlasts the horizon. */
	readonly clearsIn: number | null;
	/** Interest paid on it over the plan. Zero for a debt with no rate. */
	readonly interest: number;
	readonly rateKnown: boolean;
	/**
	 * True when its own instalment does not cover a month's interest.
	 *
	 * Left alone such a debt grows for ever. It can still clear inside a plan,
	 * once spare money reaches it — which is exactly what a page should say.
	 */
	readonly shortOfInterest: boolean;
	/**
	 * True when the bureau gave no instalment and one was assumed.
	 *
	 * Cards and facilities are often reported without one. The assumption is the
	 * larger of 3% of the balance and the month's interest plus 1% — roughly what
	 * a lender asks for, and always enough to make progress.
	 */
	readonly minimumEstimated: boolean;
}

/** Every debt added together at the end of one month. */
export interface PayoffMonth {
	readonly month: number;
	readonly balance: number;
}

export interface PayoffPlan {
	/** The ordering asked for. */
	readonly strategy: PayoffStrategy;
	/**
	 * The ordering actually used.
	 *
	 * Differs from {@link strategy} in one case: avalanche with no rates at all
	 * has nothing to rank by, and falls back to smallest balance first.
	 */
	readonly effective: PayoffStrategy;
	/** Months until every debt is gone, or `null` past the horizon. */
	readonly months: number | null;
	readonly totalInterest: number;
	/** In payoff order. */
	readonly debts: readonly DebtPayoff[];
	readonly timeline: readonly PayoffMonth[];
	/** How many debts were simulated without a rate. */
	readonly ratesMissing: number;
}

export interface PayoffOptions {
	/** Positive rand a month on top of the instalments. Ignored for `minimums`. */
	readonly extra: number;
	readonly strategy: PayoffStrategy;
}

/** Fifty years. Past this a debt is not being paid off, it is being serviced. */
export const PAYOFF_HORIZON_MONTHS = 600;

/** A balance is not followed past this multiple of where it started. */
const RUNAWAY_FACTOR = 10;

const ESTIMATED_MINIMUM_SHARE = 0.03;
const ESTIMATED_MINIMUM_PRINCIPAL = 0.01;

/** One debt mid-simulation. Money is whole cents, so months of adding do not drift. */
interface Running {
	readonly debt: PayoffDebt;
	readonly opening: number;
	readonly payment: number;
	readonly monthlyRate: number;
	readonly minimumEstimated: boolean;
	balance: number;
	interest: number;
	clearedIn: number | null;
}

/**
 * Simulate the debts to the end.
 *
 * @param debts Debts with nothing owed are ignored: there is nothing to plan.
 */
export function buildPayoff(debts: readonly PayoffDebt[], options: PayoffOptions): PayoffPlan {
	const open = debts.filter((debt) => debt.balance > 0);
	const ratesMissing = open.filter((debt) => debt.annualRate === null).length;
	const effective =
		options.strategy === 'avalanche' && ratesMissing === open.length && open.length > 0
			? 'snowball'
			: options.strategy;

	const queue = ordered(open, effective).map(start);
	const spare = options.strategy === 'minimums' ? 0 : toCents(Math.max(options.extra, 0));
	const rollsOver = options.strategy !== 'minimums';

	const timeline: PayoffMonth[] = [];
	let months: number | null = queue.length === 0 ? 0 : null;

	for (let month = 1; month <= PAYOFF_HORIZON_MONTHS && months === null; month += 1) {
		let pool = spare;

		for (const running of queue) {
			if (running.balance === 0) {
				// A cleared debt's instalment is the money the next one is paid with.
				if (rollsOver) pool += running.payment;
				continue;
			}

			accrue(running);
			const paid = Math.min(running.payment, running.balance);
			running.balance -= paid;
			if (rollsOver) pool += running.payment - paid;
		}

		for (const running of queue) {
			if (pool === 0) break;

			const paid = Math.min(pool, running.balance);
			running.balance -= paid;
			pool -= paid;
		}

		for (const running of queue) {
			if (running.balance === 0 && running.clearedIn === null) running.clearedIn = month;
		}

		timeline.push({ month, balance: fromCents(sum(queue.map((running) => running.balance))) });
		if (queue.every((running) => running.balance === 0)) months = month;
	}

	return {
		strategy: options.strategy,
		effective,
		months,
		totalInterest: fromCents(sum(queue.map((running) => running.interest))),
		debts: queue.map(describe),
		timeline,
		ratesMissing
	};
}

/** What the two orderings buy over doing nothing, side by side. */
export interface PayoffComparison {
	readonly minimums: PayoffPlan;
	readonly avalanche: PayoffPlan;
	readonly snowball: PayoffPlan;
}

export function comparePayoffs(debts: readonly PayoffDebt[], extra: number): PayoffComparison {
	return {
		minimums: buildPayoff(debts, { extra: 0, strategy: 'minimums' }),
		avalanche: buildPayoff(debts, { extra, strategy: 'avalanche' }),
		snowball: buildPayoff(debts, { extra, strategy: 'snowball' })
	};
}

/**
 * The queue spare money is paid down.
 *
 * Every comparison ends on the id, so the same debts in a different order come
 * out as the same plan.
 */
function ordered(debts: readonly PayoffDebt[], strategy: PayoffStrategy): readonly PayoffDebt[] {
	const byBalance = (a: PayoffDebt, b: PayoffDebt): number =>
		a.balance - b.balance || rateOf(b) - rateOf(a) || a.id.localeCompare(b.id);

	if (strategy !== 'avalanche') return [...debts].sort(byBalance);

	// Known rates first, highest leading. A debt whose rate nobody has entered
	// cannot be ranked by it, so those follow, smallest first.
	const known = debts.filter((debt) => debt.annualRate !== null);
	const unknown = debts.filter((debt) => debt.annualRate === null);

	return [
		...known.sort(
			(a, b) => rateOf(b) - rateOf(a) || a.balance - b.balance || a.id.localeCompare(b.id)
		),
		...unknown.sort(byBalance)
	];
}

function rateOf(debt: PayoffDebt): number {
	return debt.annualRate ?? 0;
}

function start(debt: PayoffDebt): Running {
	const opening = toCents(debt.balance);
	const monthlyRate = Math.max(rateOf(debt), 0) / 1200;
	const given = toCents(Math.max(debt.instalment, 0));
	const minimumEstimated = given === 0;
	const payment = minimumEstimated
		? Math.max(
				Math.round(opening * ESTIMATED_MINIMUM_SHARE),
				Math.round(opening * (monthlyRate + ESTIMATED_MINIMUM_PRINCIPAL)),
				1
			)
		: given;

	return {
		debt,
		opening,
		payment,
		monthlyRate,
		minimumEstimated,
		balance: opening,
		interest: 0,
		clearedIn: null
	};
}

/** Add a month's interest, unless the balance has already run away. */
function accrue(running: Running): void {
	const ceiling = running.opening * RUNAWAY_FACTOR;
	if (running.balance >= ceiling) return;

	// Only what is actually added is counted as paid, or a balance held at the
	// ceiling would go on running up interest it is no longer being charged.
	const interest = Math.min(
		Math.round(running.balance * running.monthlyRate),
		ceiling - running.balance
	);
	running.balance += interest;
	running.interest += interest;
}

function describe(running: Running, index: number): DebtPayoff {
	return {
		id: running.debt.id,
		name: running.debt.name,
		order: index + 1,
		clearsIn: running.clearedIn,
		interest: fromCents(running.interest),
		rateKnown: running.debt.annualRate !== null,
		shortOfInterest: running.payment <= Math.round(running.opening * running.monthlyRate),
		minimumEstimated: running.minimumEstimated
	};
}

function toCents(rand: number): number {
	return Math.round(rand * 100);
}

function fromCents(cents: number): number {
	return cents / 100;
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
