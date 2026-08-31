/**
 * What a "month" means in this app.
 *
 * Money does not always run from the 1st. A reader paid on the 25th lives in
 * cycles that open on the 25th, and a chart cut at midnight on the 1st splits
 * every one of their months in half. So the whole app asks this module where a
 * date falls rather than reading `YYYY-MM` off the front of it.
 *
 * A cycle keeps the same `YYYY-MM` shape as a calendar month, and is named
 * after the month **most of it falls in**: with a start of the 25th, the cycle
 * 25 June → 24 July is "July", which is what a reader paid on the 25th calls
 * it. With a start of the 5th, 5 July → 4 August is "July" as well. The naming
 * turns over at the 16th, and at a start of the 1st every cycle is exactly the
 * calendar month it is named after — so nothing about this module is visible
 * until the reader changes the setting.
 */

/** The default: cycles are calendar months. */
export const CALENDAR_START = 1;

/**
 * Days a cycle may open on.
 *
 * Capped at the 28th because every month has one. A start of the 30th would
 * have no opening day at all in February, and the cycle would either vanish or
 * silently move — neither of which a reader asked for.
 */
export const LAST_START = 28;

/** Days offered by the picker, so the list and the guard cannot disagree. */
export const MONTH_START_DAYS: readonly number[] = Array.from(
	{ length: LAST_START },
	(_, index) => index + 1
);

/**
 * Read a start day from somewhere untrusted — stored settings, a URL, a form.
 *
 * Anything that is not a day every month has falls back to the calendar month,
 * because a broken setting must not be able to cut the statement into cycles
 * nobody can reason about.
 */
export function readMonthStart(value: unknown): number {
	const day = typeof value === 'string' ? Number(value) : value;
	if (typeof day !== 'number' || !Number.isInteger(day)) return CALENDAR_START;

	return day >= CALENDAR_START && day <= LAST_START ? day : CALENDAR_START;
}

/** True while cycles are plain calendar months, and none of this shows. */
export function isCalendarStart(start: number): boolean {
	return readMonthStart(start) === CALENDAR_START;
}

/** The cycle a date falls in, as `YYYY-MM`. */
export function cycleOf(date: string, start: number): string {
	const day = readMonthStart(start);
	const opened = dayOf(date) >= day ? monthOf(date) : shift(monthOf(date), -1);

	// Named after the month it mostly covers: a cycle opening in the back half
	// of a month spends most of itself in the next one.
	return day <= 15 ? opened : shift(opened, 1);
}

/** The first date of a cycle, as `YYYY-MM-DD`. */
export function cycleOpening(cycle: string, start: number): string {
	const day = readMonthStart(start);
	const month = day <= 15 ? cycle : shift(cycle, -1);

	return `${month}-${pad(day)}`;
}

/** The last date of a cycle — the day before the next one opens. */
export function cycleClosing(cycle: string, start: number): string {
	return addDays(cycleOpening(nextCycle(cycle), start), -1);
}

/** How many days the cycle runs for. Between 28 and 31, like a month. */
export function cycleLength(cycle: string, start: number): number {
	return daysBetween(cycleOpening(cycle, start), cycleClosing(cycle, start)) + 1;
}

/** Where a date sits in its cycle, counting the opening day as 1. */
export function cycleDay(date: string, start: number): number {
	return daysBetween(cycleOpening(cycleOf(date, start), start), date) + 1;
}

/** The `n`th day of a cycle, as `YYYY-MM-DD`. Day 1 is the opening day. */
export function cycleDate(cycle: string, start: number, day: number): string {
	return addDays(cycleOpening(cycle, start), day - 1);
}

/** The cycle after this one. */
export function nextCycle(cycle: string): string {
	return shift(cycle, 1);
}

/** Every cycle from `from` to `to`, inclusive and in order. */
export function cyclesBetween(from: string, to: string): readonly string[] {
	const cycles: string[] = [];

	for (let cycle = from; cycle <= to; cycle = nextCycle(cycle)) cycles.push(cycle);

	return cycles;
}

/** The cycle `count` cycles before this one. */
export function cyclesBefore(cycle: string, count: number): string {
	return shift(cycle, -count);
}

/** How many cycles apart two cycles are — negative when `to` is the earlier. */
export function cyclesApart(from: string, to: string): number {
	return index(to) - index(from);
}

function monthOf(date: string): string {
	return date.slice(0, 7);
}

function dayOf(date: string): number {
	return Number(date.slice(8, 10));
}

function pad(day: number): string {
	return `${day}`.padStart(2, '0');
}

/** A month as a single number, so months can be added and subtracted. */
function index(month: string): number {
	const [year, position] = month.split('-').map(Number);

	return year * 12 + (position - 1);
}

function shift(month: string, by: number): string {
	const total = index(month) + by;

	return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/**
 * Date arithmetic in UTC.
 *
 * A cycle is a run of calendar days, and only UTC counts them the same length
 * every time: a local-time day is 23 or 25 hours long twice a year, which is
 * enough to move a cycle boundary by one.
 */
function addDays(date: string, days: number): string {
	const moved = new Date(toUtc(date) + days * MS_PER_DAY);

	return moved.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
	return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

function toUtc(date: string): number {
	return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, dayOf(date));
}

const MS_PER_DAY = 86_400_000;
