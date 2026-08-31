/**
 * How long the money lasts.
 *
 * The forecast next door answers "what will this month come to". This module
 * asks the shorter, more useful question a reader actually has on the 12th:
 * *from what is in the account right now, does it reach payday* — and if it
 * dips, when, and how far.
 *
 * It is the same projection, read on a different axis. Nothing here re-learns
 * anything from the statement: it takes one {@link Forecast}, anchors its line
 * to a real balance and crops it to the days that are still ahead. That is
 * deliberate — the tiles, the line and the list of expected payments all read
 * from the same single `buildForecast` call, so they cannot come to different
 * conclusions about the same month.
 *
 * Two things follow from being a balance rather than a total:
 *
 * - **It is always net.** Money out lowers it and money in raises it, so the
 *   forecast behind it has to be built with `metric: 'net'`. There is no such
 *   thing as a money-out-only balance.
 * - **It only knows what the statement knows.** Own-account transfers are not
 *   income or spending, so they are not in the projection — a standing sweep to
 *   savings will not show up here unless the reader adds it as a charge.
 *
 * Payday is the day the reader's next cycle opens — the setting in
 * {@link cycleOf}. So the line runs to the last day of this cycle, and
 * {@link Runway.payday} is the morning after it.
 */

import { cycleClosing, cycleDate, cycleOpening, nextCycle, CALENDAR_START } from './cycle.ts';
import { counted, type ExpectedPayment, type Forecast } from './forecast.ts';

/** One day between now and payday. */
export interface RunwayDay {
	/** Day of the cycle, so a point can be matched back to the forecast. */
	readonly day: number;
	readonly date: string;
	/** What the account is expected to hold at the end of this day. */
	readonly balance: number;
	/**
	 * The same day if the rest of the month runs as the leanest or the heaviest
	 * of the months behind it did. Equal to {@link balance} on the opening day,
	 * where the money is counted rather than projected.
	 */
	readonly low: number;
	readonly high: number;
	/** The charges expected to land on this day. Only the counted ones. */
	readonly payments: readonly ExpectedPayment[];
	/** False on the opening day alone — that one is the bank's own figure. */
	readonly isProjected: boolean;
}

/** The stretch between the last thing that happened and the next payday. */
export interface Runway {
	/** Today first, then one point per day left. Empty without a statement. */
	readonly days: readonly RunwayDay[];
	/** The last date the statement covers — where the projection starts. */
	readonly from: string;
	/** The last day of the cycle: the final day the money has to stretch over. */
	readonly to: string;
	/** The day the next cycle opens. See {@link cycleOf}. */
	readonly payday: string;
	/** Days still to be got through. Zero once the cycle is over. */
	readonly daysLeft: number;
	/** What the account holds on {@link from} — banked, not projected. */
	readonly opening: number;
	/** What it is expected to hold on {@link to}, the night before payday. */
	readonly closing: number;
	/**
	 * The day the balance is expected to be at its lowest.
	 *
	 * The figure the reader came for, and not the same as {@link closing}: a
	 * salary or a refund mid-month can lift the line back up, and a month that
	 * ends comfortably can still have a Tuesday in it that does not.
	 */
	readonly lowest: RunwayDay | null;
	/**
	 * The first day the balance is expected to go below zero, or `null`.
	 *
	 * Separate from {@link lowest} because they answer different questions —
	 * *how thin does it get* and *does it break* — and the second one is the one
	 * worth interrupting a reader for.
	 */
	readonly shortfall: RunwayDay | null;
	/** Every counted charge still to come, soonest first. */
	readonly payments: readonly ExpectedPayment[];
	/** Positive. What the counted charges take out between now and payday. */
	readonly committedOut: number;
	/** Positive. What they are expected to bring in. */
	readonly committedIn: number;
	/**
	 * Positive. Everything else the days left are expected to cost — the
	 * groceries and the coffees nobody can put a date on.
	 */
	readonly everyday: number;
	/** Complete past cycles the projection was learned from. */
	readonly monthsOfHistory: number;
	/** True when the cycle is over: there is nothing left to project. */
	readonly isComplete: boolean;
	/** True when there is no statement to project from at all. */
	readonly isEmpty: boolean;
}

export interface RunwayOptions {
	/**
	 * What the account holds on the forecast's `asOf` date.
	 *
	 * Real money where the bank printed it or the reader entered it, and `0`
	 * where neither did — in which case the line is still the right shape, it
	 * just reads as net change. The caller says which, the way the balance chart
	 * and net worth already do.
	 */
	readonly balance: number;
	/** Day of the month a cycle opens on — payday. See {@link cycleOf}. */
	readonly monthStart?: number;
}

/**
 * Crop a forecast to the days ahead and anchor it to a balance.
 *
 * @param forecast Built with `metric: 'net'`. See the note at the top of this
 * module — a balance has no money-out-only reading.
 */
export function buildRunway(forecast: Forecast, options: RunwayOptions): Runway {
	const start = options.monthStart ?? CALENDAR_START;
	const opening = round(options.balance);

	if (forecast.month === '' || forecast.points.length === 0) return emptyRunway(opening);

	const from = forecast.asOf === '' ? cycleOpening(forecast.month, start) : forecast.asOf;
	const to = cycleClosing(forecast.month, start);
	const payday = cycleOpening(nextCycle(forecast.month), start);

	// The line is a running net total from the first day of the cycle. Only the
	// part of it that has not happened yet belongs on a balance, so today's
	// total is subtracted out and the rest is carried on top of real money.
	const today = Math.max(forecast.elapsedDays, 1);
	const banked = forecast.points[today - 1]?.total ?? 0;

	const payments = counted(forecast.expected);
	const byDay = new Map<number, ExpectedPayment[]>();
	for (const payment of payments) {
		byDay.set(payment.day, [...(byDay.get(payment.day) ?? []), payment]);
	}

	const days: RunwayDay[] = [];
	for (let day = today; day <= forecast.length; day += 1) {
		const point = forecast.points[day - 1];
		if (point === undefined) continue;

		days.push({
			day,
			date: cycleDate(forecast.month, start, day),
			balance: round(opening + point.total - banked),
			low: round(opening + point.low - banked),
			high: round(opening + point.high - banked),
			payments: byDay.get(day) ?? [],
			isProjected: point.isProjected
		});
	}

	return {
		days,
		from,
		to,
		payday,
		daysLeft: Math.max(forecast.length - forecast.elapsedDays, 0),
		opening,
		closing: days.at(-1)?.balance ?? opening,
		lowest: lowestOf(days),
		shortfall: days.find((day) => day.balance < 0) ?? null,
		payments,
		committedOut: round(sum(payments, 'expense')),
		committedIn: round(sum(payments, 'income')),
		// Reported as a magnitude, like every other figure a reader reads: on a
		// net forecast the everyday channel is spending, and so is negative.
		everyday: round(Math.abs(forecast.everyday)),
		monthsOfHistory: forecast.monthsOfHistory,
		isComplete: forecast.isComplete,
		isEmpty: false
	};
}

/**
 * The thinnest the balance gets, earliest of any ties.
 *
 * Earliest because the reader is being warned, and a warning is only useful
 * before the day it is about.
 */
function lowestOf(days: readonly RunwayDay[]): RunwayDay | null {
	return days.reduce<RunwayDay | null>(
		(lowest, day) => (lowest === null || day.balance < lowest.balance ? day : lowest),
		null
	);
}

function emptyRunway(opening: number): Runway {
	return {
		days: [],
		from: '',
		to: '',
		payday: '',
		daysLeft: 0,
		opening,
		closing: opening,
		lowest: null,
		shortfall: null,
		payments: [],
		committedOut: 0,
		committedIn: 0,
		everyday: 0,
		monthsOfHistory: 0,
		isComplete: false,
		isEmpty: true
	};
}

function sum(payments: readonly ExpectedPayment[], flow: 'income' | 'expense'): number {
	return payments
		.filter((payment) => payment.flow === flow)
		.reduce((total, payment) => total + payment.amount, 0);
}

/** Money is decimal; floating-point sums drift. Settle to cents at each step. */
function round(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
