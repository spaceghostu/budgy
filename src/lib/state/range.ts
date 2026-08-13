import { monthEnd } from '../stats/monthly.ts';
import type { Transaction } from '../types.ts';

export type RangePreset = 'all' | '7d' | '30d' | '90d' | 'month' | 'custom';

export interface RangeOption {
	readonly id: RangePreset;
	readonly label: string;
}

/** Presets first, custom last — nobody fights a calendar for "last 30 days". */
export const RANGE_OPTIONS: readonly RangeOption[] = [
	{ id: 'all', label: 'All' },
	{ id: 'month', label: 'Month' },
	{ id: '7d', label: 'Last 7 days' },
	{ id: '30d', label: 'Last 30 days' },
	{ id: '90d', label: 'Last 90 days' },
	{ id: 'custom', label: 'Custom' }
];

/** Anchor key used when the view spans every account in the file. */
export const ALL_ACCOUNTS = '__all__';

const MS_PER_DAY = 86_400_000;

export interface RangeInput {
	readonly range: RangePreset;
	readonly customFrom: string;
	readonly customTo: string;
	readonly earliestDate: string;
	readonly latestDate: string;
	/** `YYYY-MM` the month view is parked on. Blank means the newest month. */
	readonly selectedMonth: string;
}

export interface Bounds {
	readonly from: string | null;
	readonly to: string | null;
}

/**
 * Turn the selected preset into inclusive ISO bounds.
 *
 * Presets count back from the statement's most recent transaction rather than
 * today: a statement downloaded last month would otherwise show "last 7 days"
 * as an empty chart.
 */
export function resolveRange(input: RangeInput): Bounds {
	if (input.latestDate === '') return { from: null, to: null };

	if (input.range === 'custom') {
		return {
			from: input.customFrom === '' ? null : input.customFrom,
			to: input.customTo === '' ? null : input.customTo
		};
	}
	if (input.range === 'all') return { from: null, to: null };
	if (input.range === 'month') {
		// The whole calendar month, even for a month the statement stops part-way
		// into: the filter is inclusive, so an open end simply takes what exists.
		const month = input.selectedMonth === '' ? input.latestDate.slice(0, 7) : input.selectedMonth;
		return { from: `${month}-01`, to: monthEnd(month) };
	}

	const days = { '7d': 7, '30d': 30, '90d': 90 }[input.range];
	const latest = new Date(`${input.latestDate}T00:00:00`).getTime();

	return { from: toIsoDate(latest - (days - 1) * MS_PER_DAY), to: input.latestDate };
}

/**
 * Default to the account with the most activity — for a single-account export
 * that is simply the only account, and for a multi-account one it is the
 * account the user most likely came to look at.
 */
export function busiestAccount(transactions: readonly Transaction[]): string {
	const counts = new Map<string, number>();
	for (const transaction of transactions) {
		counts.set(transaction.account, (counts.get(transaction.account) ?? 0) + 1);
	}

	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	return ranked.at(0)?.[0] ?? ALL_ACCOUNTS;
}

function toIsoDate(timestamp: number): string {
	const date = new Date(timestamp);
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');

	return `${date.getFullYear()}-${month}-${day}`;
}
