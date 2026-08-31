import { describe, expect, it } from 'vitest';
import { envApiKey, hasEnvKey } from './env.ts';

/**
 * What this build was given, tested without saying it.
 *
 * The value under test is a real credential on a machine that has one, and a
 * failed `toBe` prints what it compared — so every assertion here is about a
 * length or a boolean. Nothing in this file can put a key in test output.
 */
describe('envApiKey', () => {
	it('is a string whether or not a key was configured', () => {
		expect(typeof envApiKey()).toBe('string');
	});

	it('has no surrounding whitespace, which would be sent as part of the key', () => {
		expect(envApiKey().length).toBe(envApiKey().trim().length);
	});
});

describe('hasEnvKey', () => {
	it('says a build carries a key exactly when there is one to carry', () => {
		expect(hasEnvKey()).toBe(envApiKey().length > 0);
	});
});
