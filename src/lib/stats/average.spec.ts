import { describe, expect, it } from 'vitest';
import { mean, median } from './average.ts';

describe('mean', () => {
	it('is the total spread evenly across the series', () => {
		expect(mean([100, 200, 900])).toBe(400);
	});

	it('settles to cents rather than carrying float drift', () => {
		expect(mean([0.1, 0.2])).toBe(0.15);
		expect(mean([10, 10, 10.01])).toBe(10);
	});

	it('is zero for an empty series, not NaN', () => {
		// The dashboard derives a summary before any file is loaded, so an empty
		// series has to render as a number rather than as "RNaN".
		expect(mean([])).toBe(0);
	});
});

describe('median', () => {
	it('is the middle value of an odd-length series', () => {
		expect(median([900, 100, 200])).toBe(200);
	});

	it('averages the two middle values of an even-length series', () => {
		expect(median([100, 200, 300, 900])).toBe(250);
	});

	it('ignores an outlier that drags the mean', () => {
		const values = [100, 100, 100, 100, 10_000];
		expect(median(values)).toBe(100);
		expect(mean(values)).toBe(2080);
	});

	it('sorts numerically, not as text', () => {
		// The default comparator would order these 10, 100, 9 and answer 100.
		expect(median([9, 10, 100])).toBe(10);
	});

	it('leaves its input alone', () => {
		const values = [900, 100, 200];
		median(values);
		expect(values).toEqual([900, 100, 200]);
	});

	it('is zero for an empty series, not NaN', () => {
		expect(median([])).toBe(0);
	});
});
