import { describe, expect, it } from 'vitest';
import { isSettling, type UpdatePhase } from './update.ts';

describe('isSettling', () => {
	it('waits on the phases the shell is still moving through', () => {
		// These two are the shell mid-request. Nothing in the window resolves
		// them, so anything reading state on a timer has to keep reading.
		expect(isSettling('checking')).toBe(true);
		expect(isSettling('downloading')).toBe(true);
	});

	it('stops on the phases that are an answer', () => {
		const settled: readonly UpdatePhase[] = [
			'unsupported',
			'current',
			'available',
			'ready',
			'failed'
		];

		for (const phase of settled) expect(isSettling(phase)).toBe(false);
	});

	it('does not wait on idle, where nothing was ever asked', () => {
		// Waiting here would poll forever for an answer nobody sent for.
		expect(isSettling('idle')).toBe(false);
	});
});
