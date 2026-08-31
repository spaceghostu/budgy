import { describe, expect, it } from 'vitest';
import { failureReason, updateState } from './update-state.js';

describe('updateState', () => {
	it('says which version is the latest when there is nothing to do', () => {
		const state = updateState({ phase: 'current', version: '1.2.0' });

		expect(state.message).toBe('Budgy 1.2.0 is the latest version.');
		expect(state.latest).toBe('');
		expect(state.percent).toBe(0);
	});

	it('names both versions when an update is waiting', () => {
		const state = updateState({ phase: 'available', version: '1.2.0', latest: '1.3.0' });

		expect(state.message).toBe('Budgy 1.3.0 is available — you have 1.2.0.');
	});

	it('carries the percentage into the sentence while downloading', () => {
		const state = updateState({
			phase: 'downloading',
			version: '1.2.0',
			latest: '1.3.0',
			percent: 41.6
		});

		expect(state.percent).toBe(42);
		expect(state.message).toBe('Downloading Budgy 1.3.0 — 42%.');
	});

	it('never reports a percentage a progress bar cannot draw', () => {
		const over = updateState({ phase: 'downloading', version: '1', latest: '2', percent: 140 });
		const under = updateState({ phase: 'downloading', version: '1', latest: '2', percent: -3 });
		const nonsense = updateState({
			phase: 'downloading',
			version: '1',
			latest: '2',
			percent: Number.NaN
		});

		expect(over.percent).toBe(100);
		expect(under.percent).toBe(0);
		expect(nonsense.percent).toBe(0);
	});

	it('says when the update goes in, rather than that it is finished', () => {
		const state = updateState({ phase: 'ready', version: '1.2.0', latest: '1.3.0' });

		expect(state.message).toBe('Budgy 1.3.0 is ready, and installs when you quit.');
	});

	it('shows why a check failed, since offline and broken are different', () => {
		const state = updateState({ phase: 'failed', version: '1.2.0', reason: 'net::ERR_OFFLINE' });

		expect(state.message).toBe('Could not check for updates: net::ERR_OFFLINE');
	});

	it('still says something when the failure had no reason to give', () => {
		expect(updateState({ phase: 'failed', version: '1.2.0' }).message).toBe(
			'Could not check for updates.'
		);
	});

	it('tells a build that cannot update itself apart from one that is current', () => {
		const state = updateState({ phase: 'unsupported', version: '1.2.0' });

		expect(state.message).toContain('does not update itself');
		expect(state.message).not.toContain('latest');
	});

	it('gives every phase the same shape, so the window never reads a missing field', () => {
		const phases = /** @type {const} */ ([
			'unsupported',
			'idle',
			'checking',
			'current',
			'available',
			'downloading',
			'ready',
			'failed'
		]);

		for (const phase of phases) {
			const state = updateState({ phase, version: '1.2.0' });

			expect(Object.keys(state).sort()).toEqual([
				'latest',
				'message',
				'percent',
				'phase',
				'version'
			]);
			expect(typeof state.message).toBe('string');
			expect(state.percent).toBe(0);
		}
	});
});

describe('failureReason', () => {
	it('takes the first line, so a stack never reaches the window', () => {
		const error = new Error('Cannot find channel\n    at Object.<anonymous> (/app/index.js:1:1)');

		expect(failureReason(error)).toBe('Cannot find channel');
	});

	it('reads a thrown string as its own reason', () => {
		expect(failureReason('404 Not Found')).toBe('404 Not Found');
	});

	it('shortens a reason too long to belong on a card', () => {
		const reason = failureReason(new Error('x'.repeat(400)));

		expect(reason).toHaveLength(200);
		expect(reason.endsWith('…')).toBe(true);
	});

	it('says something for a failure that was not an error at all', () => {
		expect(failureReason(undefined)).toBe('undefined');
	});
});
