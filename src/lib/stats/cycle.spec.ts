import { describe, expect, it } from 'vitest';
import {
	CALENDAR_START,
	cycleClosing,
	cycleDay,
	cycleLength,
	cycleOf,
	cycleOpening,
	cyclesBetween,
	nextCycle,
	readMonthStart
} from './cycle.ts';

describe('cycleOf', () => {
	it('is the calendar month while the cycle opens on the 1st', () => {
		expect(cycleOf('2026-07-01', CALENDAR_START)).toBe('2026-07');
		expect(cycleOf('2026-07-31', CALENDAR_START)).toBe('2026-07');
	});

	it('names a late-opening cycle after the month most of it falls in', () => {
		// 25 Jun to 24 Jul is mostly July, so it is July.
		expect(cycleOf('2026-06-25', 25)).toBe('2026-07');
		expect(cycleOf('2026-06-30', 25)).toBe('2026-07');
		expect(cycleOf('2026-07-24', 25)).toBe('2026-07');
		expect(cycleOf('2026-07-25', 25)).toBe('2026-08');
	});

	it('names an early-opening cycle after the month it starts in', () => {
		// 5 Jul to 4 Aug is mostly July, and July is where it opens.
		expect(cycleOf('2026-07-04', 5)).toBe('2026-06');
		expect(cycleOf('2026-07-05', 5)).toBe('2026-07');
		expect(cycleOf('2026-08-04', 5)).toBe('2026-07');
	});

	it('carries a late-opening cycle over the new year', () => {
		expect(cycleOf('2026-12-25', 25)).toBe('2027-01');
		expect(cycleOf('2027-01-24', 25)).toBe('2027-01');
	});

	it('holds the 16th as the line between the two namings', () => {
		expect(cycleOf('2026-07-20', 15)).toBe('2026-07');
		expect(cycleOf('2026-07-20', 16)).toBe('2026-08');
	});
});

describe('cycleOpening and cycleClosing', () => {
	it('spans the calendar month while the cycle opens on the 1st', () => {
		expect(cycleOpening('2026-02', CALENDAR_START)).toBe('2026-02-01');
		expect(cycleClosing('2026-02', CALENDAR_START)).toBe('2026-02-28');
		expect(cycleClosing('2024-02', CALENDAR_START)).toBe('2024-02-29');
	});

	it('opens in the month before the one it is named after when it starts late', () => {
		expect(cycleOpening('2026-07', 25)).toBe('2026-06-25');
		expect(cycleClosing('2026-07', 25)).toBe('2026-07-24');
	});

	it('opens in the month it is named after when it starts early', () => {
		expect(cycleOpening('2026-07', 5)).toBe('2026-07-05');
		expect(cycleClosing('2026-07', 5)).toBe('2026-08-04');
	});

	it('closes the day before the next one opens, whatever the months are worth', () => {
		expect(cycleOpening('2026-03', 28)).toBe('2026-02-28');
		expect(cycleClosing('2026-03', 28)).toBe('2026-03-27');
		// February is short, so the cycle before it is the short one.
		expect(cycleLength('2026-03', 28)).toBe(28);
		expect(cycleLength('2026-02', 28)).toBe(31);
	});
});

describe('cycleDay', () => {
	it('counts from the day the cycle opened, not from the 1st', () => {
		expect(cycleDay('2026-06-25', 25)).toBe(1);
		expect(cycleDay('2026-07-01', 25)).toBe(7);
		expect(cycleDay('2026-07-24', 25)).toBe(30);
	});

	it('is the day of the month while the cycle opens on the 1st', () => {
		expect(cycleDay('2026-07-09', CALENDAR_START)).toBe(9);
	});
});

describe('cyclesBetween', () => {
	it('names every cycle from one to the other, inclusive', () => {
		expect(cyclesBetween('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
	});

	it('is a single cycle when both ends are the same', () => {
		expect(cyclesBetween('2026-07', '2026-07')).toEqual(['2026-07']);
	});

	it('steps over the new year', () => {
		expect(nextCycle('2026-12')).toBe('2027-01');
	});
});

describe('readMonthStart', () => {
	it('takes any day a month is sure to have', () => {
		expect(readMonthStart(1)).toBe(1);
		expect(readMonthStart(28)).toBe(28);
		expect(readMonthStart('25')).toBe(25);
	});

	it('falls back to the 1st rather than trusting a stored oddity', () => {
		// 29 to 31 would skip whole cycles in February, so they are not offered.
		expect(readMonthStart(29)).toBe(CALENDAR_START);
		expect(readMonthStart(0)).toBe(CALENDAR_START);
		expect(readMonthStart(7.5)).toBe(CALENDAR_START);
		expect(readMonthStart('later')).toBe(CALENDAR_START);
		expect(readMonthStart(null)).toBe(CALENDAR_START);
	});
});
