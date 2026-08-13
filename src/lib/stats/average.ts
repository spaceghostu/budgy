/**
 * The two averages, kept together because the dashboard never shows one
 * without the other.
 *
 * They answer different questions, and money is exactly the kind of data that
 * pulls them apart: the mean says what the period cost per day or per month,
 * while the median says what a typical one cost. One rent payment in a month of
 * coffees moves the mean and leaves the median where it was, and a reader who
 * sees only the mean cannot tell which of those they are looking at.
 */

import { round } from './balance.ts';

/** Cents-rounded arithmetic mean. `0` for an empty series. */
export function mean(values: readonly number[]): number {
	if (values.length === 0) return 0;

	return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Cents-rounded middle value. An even-length series has no single middle, so
 * the two either side of it are averaged. `0` for an empty series.
 */
export function median(values: readonly number[]): number {
	if (values.length === 0) return 0;

	// Sorted on a copy: the caller's series is theirs, and the default
	// comparator would sort these as text.
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);

	return sorted.length % 2 === 1
		? round(sorted[middle])
		: round((sorted[middle - 1] + sorted[middle]) / 2);
}
