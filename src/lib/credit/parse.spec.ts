import { describe, expect, it } from 'vitest';
import { CreditFormatError, importCreditReport, parseCreditReport } from './parse.ts';
import { FAKE_SECRETS, finance365Response } from '../testing/finance365.ts';

const TODAY = '2026-10-05';

describe('parseCreditReport', () => {
	it('reads each account as its lender and its figures', () => {
		const report = parseCreditReport(finance365Response(), TODAY);

		expect(report.score).toBe(640);
		expect(report.accounts).toHaveLength(2);
		expect(report.accounts[0]).toMatchObject({
			creditor: 'Northwind Personal Loans',
			kind: 'loan',
			balance: 42_000,
			instalment: 1500,
			arrears: 0,
			status: 'current'
		});
		expect(report.accounts[1]).toMatchObject({
			creditor: 'Contoso Credit Card',
			kind: 'card',
			arrears: 300,
			status: 'arrears'
		});
	});

	it('dates the report from Finance365, not from the day it was read', () => {
		expect(parseCreditReport(finance365Response(), TODAY).reportDate).toBe('2026-09-28');
	});

	it('falls back to today for a report that does not date itself', () => {
		const response = finance365Response() as { data: Record<string, unknown> };
		delete response.data.latestDate;

		expect(parseCreditReport(response, TODAY).reportDate).toBe(TODAY);
	});

	it('keeps exactly the fields of a credit account, and nothing Finance365 sent beside them', () => {
		const report = parseCreditReport(finance365Response(), TODAY);

		expect(Object.keys(report).sort()).toEqual(['accounts', 'reportDate', 'score']);
		expect(Object.keys(report.accounts[0]).sort()).toEqual([
			'arrears',
			'balance',
			'creditor',
			'id',
			'instalment',
			'kind',
			'limit',
			'opened',
			'status'
		]);
	});

	it('never carries an account number, an identity number, a name or a phone number', () => {
		const serialised = JSON.stringify(parseCreditReport(finance365Response(), TODAY));

		for (const secret of Object.values(FAKE_SECRETS)) {
			expect(serialised).not.toContain(secret);
		}
		expect(serialised).not.toContain('account_no');
		expect(serialised).not.toContain('abc123');
	});

	it('gives the same account the same id from one report to the next', () => {
		const first = parseCreditReport(finance365Response(), TODAY);
		const second = parseCreditReport(finance365Response({ score: 655 }), '2026-11-05');

		expect(second.accounts.map((account) => account.id)).toEqual(
			first.accounts.map((account) => account.id)
		);
	});

	it('tells apart two accounts that would otherwise share an id', () => {
		const twin = {
			provider_name: 'Contoso Store Account',
			account_no: '',
			current_balance: 800,
			overdue_amount: 0,
			instalment_amount: 100
		};
		const report = parseCreditReport(finance365Response({ accounts: [twin, twin] }), TODAY);
		const [first, second] = report.accounts.map((account) => account.id);

		expect(second).toBe(`${first}-2`);
	});

	it('reads money written out, and reads what it cannot as nothing', () => {
		const report = parseCreditReport(
			finance365Response({
				accounts: [
					{
						provider_name: 'Northwind',
						account_no: 12345678,
						current_balance: 'R 12,345.67',
						overdue_amount: null,
						instalment_amount: 'unknown'
					}
				]
			}),
			TODAY
		);

		expect(report.accounts[0]).toMatchObject({ balance: 12_345.67, arrears: 0, instalment: 0 });
	});

	it('reads a figure or a date no report could hold as nothing, so it can still be stored', () => {
		const response = finance365Response({
			accounts: [
				{
					provider_name: 'N'.repeat(500),
					account_no: '1',
					current_balance: 1e30,
					overdue_amount: 0,
					instalment_amount: '9'.repeat(40)
				}
			]
		}) as { data: Record<string, unknown> };
		response.data.latestDate = 8.6e15;

		const report = parseCreditReport(response, TODAY);

		expect(report.reportDate).toBe(TODAY);
		expect(report.accounts[0]).toMatchObject({ balance: 0, instalment: 0 });
		expect(report.accounts[0].creditor).toHaveLength(80);
	});

	it('accepts the report alone, as a reader copying from devtools might take it', () => {
		const whole = finance365Response() as { data: { latest: unknown } };

		expect(parseCreditReport(whole.data.latest, TODAY).accounts).toHaveLength(2);
		expect(parseCreditReport(whole.data, TODAY).accounts).toHaveLength(2);
	});

	it('says so when Finance365 has no report yet', () => {
		expect(() => parseCreditReport({ success: true, data: { latest: null } }, TODAY)).toThrow(
			/no credit report for you yet/
		);
	});

	it('says so when the report is still being prepared', () => {
		expect(() => parseCreditReport(finance365Response({ status: 'Pending' }), TODAY)).toThrow(
			/still preparing/
		);
	});

	it('refuses anything that is not a report, in words a reader can act on', () => {
		for (const junk of [null, 'hello', 42, [], { data: { latest: { accounts: 'none' } } }]) {
			expect(() => parseCreditReport(junk, TODAY)).toThrow(CreditFormatError);
		}
	});
});

describe('importCreditReport', () => {
	it('reads a pasted response the way a fetched one is read', () => {
		const report = importCreditReport(JSON.stringify(finance365Response()), TODAY);

		expect(report.accounts).toHaveLength(2);
	});

	it('refuses text that is not JSON without echoing it back', () => {
		const pasted = `not json ${FAKE_SECRETS.idNumber}`;

		expect(() => importCreditReport(pasted, TODAY)).toThrow(CreditFormatError);
		try {
			importCreditReport(pasted, TODAY);
		} catch (error: unknown) {
			expect(String(error)).not.toContain(FAKE_SECRETS.idNumber);
		}
	});
});
