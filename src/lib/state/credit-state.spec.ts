import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditReport } from '../credit/types.ts';
import { makeCreditAccount, resetCreditAccountIds } from '../testing/credit.ts';

const { CreditState } = await import('./credit.svelte.ts');

function install(): void {
	const entries = new Map<string, string>();

	vi.stubGlobal('localStorage', {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => void entries.set(key, value),
		removeItem: (key: string) => void entries.delete(key)
	});
}

function report(reportDate: string, overrides: Partial<CreditReport> = {}): CreditReport {
	return { reportDate, score: 640, accounts: [makeCreditAccount()], ...overrides };
}

beforeEach(() => {
	resetCreditAccountIds();
	install();
});
afterEach(() => vi.unstubAllGlobals());

describe('CreditState', () => {
	it('starts with no report and nothing owed', () => {
		const credit = new CreditState();

		expect(credit.latest).toBeNull();
		expect(credit.open).toEqual([]);
	});

	it('keeps each report and reads the newest, whatever order they arrive in', () => {
		const credit = new CreditState();
		credit.accept(report('2026-09-01'));
		credit.accept(report('2026-08-01'));

		expect(credit.snapshots.map((snapshot) => snapshot.reportDate)).toEqual([
			'2026-08-01',
			'2026-09-01'
		]);
		expect(credit.latest?.reportDate).toBe('2026-09-01');
	});

	it('replaces a report brought in twice for the same day', () => {
		const credit = new CreditState();
		credit.accept(report('2026-09-01', { score: 600 }));
		credit.accept(report('2026-09-01', { score: 650 }));

		expect(credit.snapshots).toHaveLength(1);
		expect(credit.latest?.score).toBe(650);
	});

	it('leaves settled, closed and ignored accounts out of what is open', () => {
		const owed = makeCreditAccount({ id: 'owed' });
		const settled = makeCreditAccount({ id: 'settled', balance: 0 });
		const closed = makeCreditAccount({ id: 'closed', status: 'closed' });
		const aside = makeCreditAccount({ id: 'aside' });

		const credit = new CreditState();
		credit.accept(report('2026-09-01', { accounts: [owed, settled, closed, aside] }));
		credit.setIgnored('aside', true);

		expect(credit.open.map((account) => account.id)).toEqual(['owed']);
		expect(credit.ignored.map((account) => account.id)).toEqual(['aside']);
	});

	it('remembers a rate across a reload', () => {
		new CreditState().setRate('owed', 21.5);

		expect(new CreditState().settings).toEqual({ owed: { rate: 21.5 } });
	});

	it('refuses a rate nothing could be charged at', () => {
		const credit = new CreditState();
		credit.setRate('owed', Number.NaN);
		credit.setRate('owed', -3);

		expect(credit.settings).toEqual({});
	});

	it('tells "not on my statement" apart from never having been asked', () => {
		const credit = new CreditState();
		credit.link('owed', 'EXAMPLE LOANS');
		expect(credit.settings.owed.link).toBe('EXAMPLE LOANS');

		credit.unlink('owed');
		expect(new CreditState().settings.owed.link).toBeNull();

		credit.resetLink('owed');
		expect(new CreditState().settings).toEqual({});
	});

	it('keeps what was said about a debt when a newer report arrives', () => {
		const credit = new CreditState();
		credit.accept(report('2026-08-01'));
		credit.setRate('debt0', 18);
		credit.accept(report('2026-09-01', { accounts: [] }));

		expect(credit.settings).toEqual({ debt0: { rate: 18 } });
	});

	it('forgets every report and setting when asked to', () => {
		const credit = new CreditState();
		credit.accept(report('2026-09-01'));
		credit.setRate('debt0', 18);
		credit.setExtra(750);
		credit.clear();

		const reloaded = new CreditState();
		expect(reloaded.snapshots).toEqual([]);
		expect(reloaded.settings).toEqual({});
		expect(reloaded.extra).toBe(0);
	});
});
