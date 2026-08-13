import { describe, expect, it } from 'vitest';
import {
	barPath,
	linearScale,
	nearestIndex,
	niceDomain,
	niceTicks,
	stepAfterAreaPath,
	stepAfterPath
} from './scale.ts';

describe('linearScale', () => {
	it('maps the domain onto the range', () => {
		const scale = linearScale([0, 100], [0, 500]);

		expect(scale(0)).toBe(0);
		expect(scale(50)).toBe(250);
		expect(scale(100)).toBe(500);
	});

	it('handles an inverted range, as SVG y-axes need', () => {
		const scale = linearScale([0, 100], [300, 0]);

		expect(scale(0)).toBe(300);
		expect(scale(100)).toBe(0);
	});

	it('pins a zero-width domain to the middle instead of dividing by zero', () => {
		const scale = linearScale([42, 42], [0, 300]);

		expect(scale(42)).toBe(150);
	});
});

describe('niceTicks', () => {
	it('produces round numbers a reader recognises', () => {
		expect(niceTicks(0, 10000, 5)).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
	});

	it('covers a range that does not start at zero', () => {
		expect(niceTicks(-2000, 6000, 4)).toEqual([-2000, 0, 2000, 4000, 6000]);
	});

	it('does not drift on fractional steps', () => {
		expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6000000000000001, 0.8, 1]);
	});

	it('returns a single tick for a flat domain', () => {
		expect(niceTicks(5, 5)).toEqual([5]);
	});

	it('tolerates a reversed domain', () => {
		expect(niceTicks(100, 0, 2)).toEqual([0, 50, 100]);
	});

	it('returns nothing for a non-finite domain', () => {
		expect(niceTicks(Number.NaN, 10)).toEqual([]);
	});
});

describe('niceDomain', () => {
	it('pads outwards to round numbers', () => {
		expect(niceDomain(1234, 8765, 5)).toEqual([0, 10000]);
	});

	it('gives a flat domain room to breathe', () => {
		expect(niceDomain(100, 100)).toEqual([90, 110]);
	});

	it('gives a flat zero domain room to breathe', () => {
		expect(niceDomain(0, 0)).toEqual([-1, 1]);
	});
});

describe('stepAfterPath', () => {
	it('holds each value until the next point', () => {
		const path = stepAfterPath([
			{ x: 0, y: 10 },
			{ x: 5, y: 20 },
			{ x: 9, y: 4 }
		]);

		expect(path).toBe('M0,10H5V20H9V4');
	});

	it('is empty for no points', () => {
		expect(stepAfterPath([])).toBe('');
	});
});

describe('stepAfterAreaPath', () => {
	it('closes the step line down to the baseline', () => {
		const path = stepAfterAreaPath(
			[
				{ x: 0, y: 10 },
				{ x: 5, y: 20 }
			],
			100
		);

		expect(path).toBe('M0,10H5V20V100H0Z');
	});

	it('is empty for no points', () => {
		expect(stepAfterAreaPath([], 100)).toBe('');
	});
});

describe('barPath', () => {
	it('rounds the top of an upward bar and squares it at the baseline', () => {
		expect(barPath(10, 20, 16, 40, 4, 'top')).toBe('M10,60V24Q10,20 14,20H22Q26,20 26,24V60Z');
	});

	it('rounds the bottom of a downward bar', () => {
		expect(barPath(10, 20, 16, 40, 4, 'bottom')).toBe('M10,20V56Q10,60 14,60H22Q26,60 26,56V20Z');
	});

	it('never rounds more than the bar can carry', () => {
		// A 2px-tall bar cannot take a 4px radius without turning into a lens.
		expect(barPath(0, 0, 16, 2, 4, 'top')).toBe('M0,2V2Q0,0 2,0H14Q16,0 16,2V2Z');
	});

	it('collapses safely for a zero-height bar', () => {
		expect(barPath(0, 0, 16, 0, 4, 'top')).toBe('M0,0V0Q0,0 0,0H16Q16,0 16,0V0Z');
	});
});

describe('nearestIndex', () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 20, y: 0 }
	];

	it('snaps to the closest point, so readers aim at a date not a line', () => {
		expect(nearestIndex(points, 11)).toBe(1);
		expect(nearestIndex(points, 19)).toBe(2);
	});

	it('clamps beyond either end', () => {
		expect(nearestIndex(points, -50)).toBe(0);
		expect(nearestIndex(points, 500)).toBe(2);
	});

	it('reports no index for an empty series', () => {
		expect(nearestIndex([], 5)).toBe(-1);
	});
});
