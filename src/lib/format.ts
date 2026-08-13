/**
 * Display formatting. South African bank statements are in rand, written
 * `R1 234.56` — space-grouped thousands, full stop for cents.
 */

const GROUPED = new Intl.NumberFormat('en-US', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

const GROUPED_WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Narrow no-break space (U+202F) — the separator South African money uses
 * between thousands. Written as an escape so it cannot be mistaken for, or
 * silently replaced by, an ordinary space.
 */
export const GROUP_SEPARATOR = '\u202f';

export const CURRENCY_SYMBOL = 'R';

/** `-1234.5` becomes `-R1 234.50`. */
export function formatCurrency(value: number): string {
	const sign = value < 0 ? '-' : '';
	return `${sign}${CURRENCY_SYMBOL}${group(GROUPED.format(Math.abs(value)))}`;
}

/**
 * Drops the cents — for axis ticks and other places precision is noise.
 *
 * @param thousands Force (or forbid) the `R50k` form. An axis has to pick one
 * unit for all of its ticks: `R150k` above `R50 000` reads as two scales.
 * Left out, it is decided per value.
 */
export function formatCurrencyShort(value: number, thousands?: boolean): string {
	const magnitude = Math.abs(value);
	const sign = value < 0 ? '-' : '';
	const asThousands = thousands ?? magnitude >= 100_000;

	if (asThousands && magnitude >= 1000) {
		const scaled = magnitude / 1000;
		const decimals = scaled < 10 && !Number.isInteger(scaled) ? 1 : 0;
		return `${sign}${CURRENCY_SYMBOL}${scaled.toFixed(decimals)}k`;
	}
	return `${sign}${CURRENCY_SYMBOL}${group(GROUPED_WHOLE.format(magnitude))}`;
}

/** True when an axis reaching this far should be labelled in thousands. */
export function useThousands(ticks: readonly number[]): boolean {
	return Math.max(...ticks.map(Math.abs), 0) >= 100_000;
}

/** Always carries an explicit sign, so a positive delta reads as a gain. */
export function formatSigned(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return rounded > 0 ? `+${formatCurrency(rounded)}` : formatCurrency(rounded);
}

export function formatPercent(share: number): string {
	return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

/** `2026-08-09` becomes `9 Aug 2026`. */
export function formatDate(date: string): string {
	const parsed = new Date(`${date}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return date;

	return parsed.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `9 Aug`, or `9 Aug 25` for axis ticks on a chart that crosses a new year —
 * where a bare day and month would name two different dates.
 */
export function formatDateShort(timestamp: number, includeYear = false): string {
	return new Date(timestamp).toLocaleDateString('en-ZA', {
		day: 'numeric',
		month: 'short',
		...(includeYear ? { year: '2-digit' as const } : {})
	});
}

/**
 * The tooltip always carries the year: it is the one place a reader checks a
 * specific transaction, and a statement can span several.
 */
export function formatDateTime(timestamp: number): string {
	return new Date(timestamp).toLocaleString('en-ZA', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}

/**
 * `9 Aug 2026` on its own, or `9 Aug 2026, 16:34` when a clock time is known.
 *
 * A certified PDF prints no time, and the timestamp a row carries encodes its
 * place in the statement rather than a moment — so the time is shown only when
 * it came from a source that really had one.
 */
export function formatDateAndTime(date: string, time: string): string {
	const day = formatDate(date);
	return time === '' ? day : `${day}, ${time.slice(0, 5)}`;
}

/** True when the range crosses a new year, so ticks need one. */
export function spansYears(from: number, to: number): boolean {
	return new Date(from).getFullYear() !== new Date(to).getFullYear();
}

/** `2026-08` becomes `Aug 2026`. */
export function formatMonth(month: string): string {
	const parsed = new Date(`${month}-01T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return month;

	return parsed.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
	return `${value} ${value === 1 ? singular : plural}`;
}

/** Swap ASCII grouping commas for the thin space South African money uses. */
function group(formatted: string): string {
	return formatted.replace(/,/g, GROUP_SEPARATOR);
}
