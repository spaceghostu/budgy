import { describe, expect, it } from 'vitest';
import {
	GROUP_SEPARATOR as SPACE,
	formatCount,
	formatCurrency,
	formatCurrencyShort,
	formatDate,
	formatDateShort,
	formatDateTime,
	formatMonth,
	formatPercent,
	formatSigned,
	spansYears,
	useThousands
} from './format.ts';

describe('formatCurrency', () => {
	it('groups thousands with a narrow no-break space, not a comma', () => {
		expect(SPACE).toBe('\u202f');
	});

	it.each([
		[0, `R0.00`],
		[5, `R5.00`],
		[1234.5, `R1${SPACE}234.50`],
		[-1234.5, `-R1${SPACE}234.50`],
		[1234567.891, `R1${SPACE}234${SPACE}567.89`]
	])('formats %s as %s', (value, expected) => {
		expect(formatCurrency(value)).toBe(expected);
	});
});

describe('formatCurrencyShort', () => {
	it('drops the cents, because axis ticks do not need them', () => {
		expect(formatCurrencyShort(20000)).toBe(`R20${SPACE}000`);
	});

	it('switches to thousands past six figures, so ticks stay short', () => {
		expect(formatCurrencyShort(250000)).toBe('R250k');
		expect(formatCurrencyShort(-250000)).toBe('-R250k');
	});

	it('keeps a negative sign on small values', () => {
		expect(formatCurrencyShort(-500)).toBe('-R500');
	});

	it('can be forced into thousands, so one axis uses one unit throughout', () => {
		// R150k above R50 000 reads as two different scales.
		expect(formatCurrencyShort(50000, true)).toBe('R50k');
		expect(formatCurrencyShort(150000, true)).toBe('R150k');
	});

	it('leaves zero and sub-thousand ticks alone even in thousands mode', () => {
		expect(formatCurrencyShort(0, true)).toBe('R0');
		expect(formatCurrencyShort(500, true)).toBe('R500');
	});

	it('keeps one decimal on an awkward thousands tick', () => {
		expect(formatCurrencyShort(2500, true)).toBe('R2.5k');
	});
});

describe('useThousands', () => {
	it('switches an axis to thousands once its ticks reach six figures', () => {
		expect(useThousands([0, 50000, 100000, 150000])).toBe(true);
	});

	it('leaves a smaller axis in full figures', () => {
		expect(useThousands([0, 2000, 4000])).toBe(false);
	});

	it('copes with an empty axis', () => {
		expect(useThousands([])).toBe(false);
	});
});

describe('formatSigned', () => {
	it('marks a gain explicitly', () => {
		expect(formatSigned(1234.5)).toBe(`+R1${SPACE}234.50`);
	});

	it('leaves a loss with its own minus', () => {
		expect(formatSigned(-1234.5)).toBe(`-R1${SPACE}234.50`);
	});

	it('does not sign a zero', () => {
		expect(formatSigned(0)).toBe('R0.00');
	});

	it('does not sign a value that rounds to zero', () => {
		expect(formatSigned(0.001)).toBe('R0.00');
	});
});

describe('formatPercent', () => {
	it('rounds to whole percent at readable sizes', () => {
		expect(formatPercent(0.6543)).toBe('65%');
	});

	it('keeps a decimal for small shares, so they do not all read as 0%', () => {
		expect(formatPercent(0.005)).toBe('0.5%');
	});
});

describe('date formatting', () => {
	it('writes a full date for headings', () => {
		expect(formatDate('2026-08-09')).toBe('09 Aug 2026');
	});

	it('returns unparseable input unchanged rather than showing "Invalid Date"', () => {
		expect(formatDate('not-a-date')).toBe('not-a-date');
		expect(formatMonth('not-a-month')).toBe('not-a-month');
	});

	it('writes a short date for axis ticks', () => {
		expect(formatDateShort(new Date('2026-08-09T00:00:00').getTime())).toBe('09 Aug');
	});

	it('adds the year to a tick when the chart crosses one', () => {
		expect(formatDateShort(new Date('2026-08-09T00:00:00').getTime(), true)).toBe('09 Aug 26');
	});

	it('always names the year in the tooltip, since a statement can span several', () => {
		const stamp = formatDateTime(new Date('2026-08-09T16:34:49').getTime());

		expect(stamp).toContain('09 Aug');
		expect(stamp).toContain('2026');
		expect(stamp).toContain('16:34');
	});

	it('knows when a range crosses a new year', () => {
		const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

		expect(spansYears(day('2025-01-01'), day('2026-08-13'))).toBe(true);
		expect(spansYears(day('2026-01-01'), day('2026-12-31'))).toBe(false);
	});

	it('writes a month label', () => {
		expect(formatMonth('2026-08')).toBe('Aug 2026');
	});
});

describe('formatCount', () => {
	it('keeps the singular for one', () => {
		expect(formatCount(1, 'transaction')).toBe('1 transaction');
	});

	it('pluralises everything else, including zero', () => {
		expect(formatCount(0, 'transaction')).toBe('0 transactions');
		expect(formatCount(4, 'transaction')).toBe('4 transactions');
	});

	it('takes an irregular plural', () => {
		expect(formatCount(2, 'penny', 'pence')).toBe('2 pence');
	});
});
