/**
 * Test-only: an answer shaped like Finance365's, made of nothing real.
 *
 * Every personal value here is an obvious fake of the right shape, so a spec
 * can assert that none of them survives being read.
 */
export const FAKE_SECRETS = {
	idNumber: '9001015800085',
	phone: '0820000000',
	name: 'Jordan Example',
	loanNumber: '4000111122223333',
	cardNumber: '5500666677778888'
} as const;

export function finance365Response(overrides: Record<string, unknown> = {}): unknown {
	return {
		success: true,
		message: '',
		data: {
			latest: {
				status: 'Complete',
				score: 640,
				user: { id_number: FAKE_SECRETS.idNumber, name: FAKE_SECRETS.name },
				phone_number: FAKE_SECRETS.phone,
				accounts: [
					{
						provider_name: 'Northwind Personal Loans',
						account_no: FAKE_SECRETS.loanNumber,
						open_balance: 60_000,
						current_balance: 42_000,
						overdue_amount: 0,
						instalment_amount: 1500
					},
					{
						provider_name: 'Contoso Credit Card',
						account_no: FAKE_SECRETS.cardNumber,
						open_balance: 15_000,
						current_balance: 9000,
						overdue_amount: 300,
						instalment_amount: 450
					}
				],
				impacts: [{ impact_type: 'payment_history', rating: 50 }],
				attachments: [{ id_ref: 'abc123', filename: 'report.pdf' }],
				...overrides
			},
			latestDate: Date.UTC(2026, 8, 28, 9, 30),
			averageScore: 610,
			maximumScore: 1000
		}
	};
}
