import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ExpectedPayments from './ExpectedPayments.svelte';
import { formatCurrency } from '../format.ts';
import { buildForecast, type AddedCharge } from '../stats/forecast.ts';
import { makeTransaction } from '../testing/transaction.ts';
import type { Transaction } from '../types.ts';

/** A gym on the 20th of two whole months, and a July that stops on the 10th. */
const STATEMENT: readonly Transaction[] = [
	makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-05-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
	makeTransaction({ date: '2026-06-28', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-04', amount: -100, merchant: 'Shop' }),
	makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
];

/** Two whole months, each with a payee of its own to offer. */
const TWO_MONTHS: readonly Transaction[] = [
	...STATEMENT,
	makeTransaction({ date: '2026-05-09', amount: -700, merchant: 'Dentist' }),
	makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' })
];

const RENT: AddedCharge = {
	kind: 'custom',
	id: 'r1',
	name: 'Rent',
	flow: 'expense',
	amount: 8000,
	day: 25,
	category: ''
};

interface DrawOptions {
	readonly transactions?: readonly Transaction[];
	readonly excluded?: readonly string[];
	readonly added?: readonly AddedCharge[];
	readonly onremove?: (key: string) => void;
	readonly onvouch?: (payment: { merchant: string; flow: string }) => void;
	readonly onmonth?: (month: string) => void;
	readonly candidateMonth?: string;
	readonly remembered?: number;
	readonly ontoggle?: (key: string, include: boolean) => void;
	readonly onclear?: () => void;
}

function draw(options: DrawOptions = {}) {
	const forecast = buildForecast(options.transactions ?? STATEMENT, {
		metric: 'out',
		excluded: options.excluded,
		added: options.added,
		candidateMonth: options.candidateMonth
	});

	return render(ExpectedPayments, {
		props: {
			forecast,
			remembered: options.remembered,
			ontoggle: options.ontoggle,
			onclear: options.onclear,
			onremove: options.onremove,
			onvouch: options.onvouch,
			onmonth: options.onmonth
		}
	});
}

describe('ExpectedPayments.svelte', () => {
	it('names each charge, what it takes and when', async () => {
		draw();

		const row = page.getByRole('listitem');

		await expect.element(row.getByText('Gym')).toBeInTheDocument();
		await expect.element(row.getByText(formatCurrency(500))).toBeInTheDocument();
		await expect.element(row.getByText(/around 20 Jul 2026/)).toBeInTheDocument();
		await expect.element(page.getByText('Debit order')).toBeInTheDocument();
	});

	it('leads with what is still to leave the account', async () => {
		draw();

		await expect.element(page.getByRole('strong')).toHaveTextContent(formatCurrency(500));
		await expect.element(page.getByText(/still expected to leave/)).toBeInTheDocument();
	});

	it('marks a charge that has missed its usual day', async () => {
		draw({
			transactions: [
				makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-05-05', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-06-05', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
			]
		});

		await expect.element(page.getByText('Late')).toBeInTheDocument();
		await expect
			.element(
				page.getByRole('listitem').getByText(/was due 05 Jul 2026, now expected 11 Jul 2026/)
			)
			.toBeInTheDocument();
	});

	it('says when the month has already had everything the history names', async () => {
		draw({
			transactions: [
				...STATEMENT,
				makeTransaction({ date: '2026-07-09', amount: -500, merchant: 'Gym', type: 'Debit order' })
			]
		});

		await expect
			.element(page.getByText('Nothing the history calls regular is still to come this month.'))
			.toBeInTheDocument();
	});

	it('asks for a second month rather than guessing from one', async () => {
		draw({
			transactions: [makeTransaction({ date: '2026-07-04', amount: -150, merchant: 'Shop' })]
		});

		await expect
			.element(page.getByText(/No complete month sits behind this one yet/))
			.toBeInTheDocument();
	});

	it('offers no tick box where nothing could act on it', async () => {
		draw();

		expect(await page.getByRole('checkbox').all()).toHaveLength(0);
	});

	it('reports a charge being ticked off', async () => {
		const ontoggle = vi.fn();
		draw({ ontoggle });

		const box = page.getByRole('checkbox', { name: `Counting Gym, ${formatCurrency(500)}` });
		await expect.element(box).toBeChecked();
		await box.click();

		expect(ontoggle).toHaveBeenCalledWith('expense:Gym', false);
	});

	it('toggles the box from the row beside it, whatever the merchant is called', async () => {
		// A merchant's name goes in the label, never in the id — `Real-time payment
		// Developer Hut (Pty)` is a perfectly ordinary payee and not an id at all.
		const ontoggle = vi.fn();
		draw({
			transactions: [
				makeTransaction({ date: '2026-05-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({
					date: '2026-05-20',
					amount: -500,
					merchant: 'Real-time payment Developer Hut (Pty)',
					type: 'Debit order'
				}),
				makeTransaction({
					date: '2026-06-20',
					amount: -500,
					merchant: 'Real-time payment Developer Hut (Pty)',
					type: 'Debit order'
				}),
				makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
			],
			ontoggle
		});

		await page.getByText('Real-time payment Developer Hut (Pty)').click();

		expect(ontoggle).toHaveBeenCalledWith('expense:Real-time payment Developer Hut (Pty)', false);
	});

	it('keeps a ticked-off charge on the list, struck through and uncounted', async () => {
		draw({ excluded: ['expense:Gym'], ontoggle: () => {} });

		// The row stays — its absence is what is moving the figures.
		await expect
			.element(page.getByRole('checkbox', { name: `Not counting Gym, ${formatCurrency(500)}` }))
			.not.toBeChecked();
		await expect.element(page.getByRole('listitem').getByText('Gym')).toBeInTheDocument();

		// …and the total above it stops counting it.
		await expect.element(page.getByText('Nothing counted')).toBeInTheDocument();
		await expect.element(page.getByText(/1 not counted/)).toBeInTheDocument();
	});

	it('puts every ticked-off charge back at once', async () => {
		const onclear = vi.fn();
		draw({ excluded: ['expense:Gym'], onclear });

		await page.getByRole('button', { name: 'Count all again' }).click();

		expect(onclear).toHaveBeenCalled();
	});

	it('owns up to a choice with no row on screen to sit on', async () => {
		// Two charges ticked off; only one of them is expected under this metric,
		// so the other has nothing on screen — and is said rather than hidden.
		const onclear = vi.fn();
		draw({ excluded: ['expense:Gym'], remembered: 3, onclear });

		await expect
			.element(page.getByText(/1 not counted, 2 more ticked off elsewhere/))
			.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Count all again' })).toBeInTheDocument();
	});

	it('offers the way back even when nothing on screen is ticked off', async () => {
		draw({ remembered: 2, onclear: () => {} });

		await expect.element(page.getByText(/2 charges ticked off elsewhere/)).toBeInTheDocument();
	});

	it('says which rows the reader put there, and offers to take them back', async () => {
		const onremove = vi.fn();
		draw({ added: [RENT], onremove });

		await expect.element(page.getByText(/added by you/)).toBeInTheDocument();
		await page.getByRole('button', { name: 'Remove Rent' }).click();

		expect(onremove).toHaveBeenCalledWith('custom:r1');
	});

	it('offers no way to remove a charge the history found', async () => {
		draw({ added: [RENT], onremove: () => {} });

		// The gym is the statement's own finding — disagreeing with it is what the
		// tick box is for.
		expect(await page.getByRole('button', { name: 'Remove Gym' }).all()).toHaveLength(0);
	});

	it('does not weigh evidence it never had', async () => {
		draw({ added: [RENT] });

		await expect.element(page.getByText(/added by you$/)).toBeInTheDocument();
		expect(await page.getByText(/0 past months/).all()).toHaveLength(0);
	});

	it('lays last month out, counting none of it', async () => {
		// The vet is a one-off as far as the test is concerned, so it is offered
		// rather than expected — and offered unticked.
		draw({
			transactions: [
				...STATEMENT,
				makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' })
			],
			ontoggle: () => {},
			onvouch: () => {}
		});

		await expect.element(page.getByText(/1 payee Jun 2026 has/)).toBeInTheDocument();
		await expect
			.element(page.getByRole('checkbox', { name: `Expect Vet, ${formatCurrency(400)}` }))
			.not.toBeChecked();
		// …while the charge the test did find is ticked.
		await expect
			.element(page.getByRole('checkbox', { name: `Counting Gym, ${formatCurrency(500)}` }))
			.toBeChecked();
	});

	it('takes up a payee from last month when it is ticked', async () => {
		const onvouch = vi.fn();
		draw({
			transactions: [
				...STATEMENT,
				makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' })
			],
			ontoggle: () => {},
			onvouch
		});

		await page.getByRole('checkbox', { name: `Expect Vet, ${formatCurrency(400)}` }).click();

		expect(onvouch).toHaveBeenCalledWith(
			expect.objectContaining({ merchant: 'Vet', flow: 'expense' })
		);
	});

	it('holds a long month back behind one control', async () => {
		const many = Array.from({ length: 12 }, (_, index) =>
			makeTransaction({
				date: '2026-06-14',
				amount: -(100 + index),
				merchant: `Payee ${index}`
			})
		);
		draw({ transactions: [...STATEMENT, ...many], ontoggle: () => {}, onvouch: () => {} });

		expect(await page.getByRole('checkbox').all()).toHaveLength(9);

		await page.getByRole('button', { name: 'Show all 12' }).click();

		expect(await page.getByRole('checkbox').all()).toHaveLength(13);
	});

	it('offers no boxes on last month where nothing could act on them', async () => {
		draw({
			transactions: [
				...STATEMENT,
				makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' })
			]
		});

		await expect.element(page.getByText(/1 payee Jun 2026 has/)).toBeInTheDocument();
		expect(await page.getByRole('checkbox').all()).toHaveLength(0);
	});

	it('reads back through the months on offer', async () => {
		const onmonth = vi.fn();
		draw({ transactions: TWO_MONTHS, ontoggle: () => {}, onvouch: () => {}, onmonth });

		// The last whole month, until asked otherwise.
		await expect
			.element(page.getByText(/Jun 2026 has that this month has not seen/))
			.toBeInTheDocument();

		await page.getByRole('button', { name: 'Month to offer from' }).click();
		await page.getByRole('option', { name: 'May 2026' }).click();

		expect(onmonth).toHaveBeenCalledWith('2026-05');
	});

	it('offers the month it was asked for', async () => {
		draw({
			transactions: TWO_MONTHS,
			candidateMonth: '2026-05',
			ontoggle: () => {},
			onvouch: () => {},
			onmonth: () => {}
		});

		await expect
			.element(page.getByText(/May 2026 has that this month has not seen/))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('checkbox', { name: `Expect Dentist, ${formatCurrency(700)}` }))
			.toBeInTheDocument();
	});

	it('keeps the picker on a month that has nothing left to offer', async () => {
		// Finding nothing must not take the way back out with it.
		draw({
			transactions: [
				...STATEMENT,
				makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' })
			],
			candidateMonth: '2026-05',
			ontoggle: () => {},
			onvouch: () => {},
			onmonth: () => {}
		});

		await expect.element(page.getByText(/Nothing left from May 2026/)).toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Month to offer from' }))
			.toBeInTheDocument();
	});

	it('does not send a reader to a picker that is not there', async () => {
		// One complete month, and everything it had is either counted above or
		// already seen this month — so there is nowhere else to look.
		draw({
			transactions: [
				makeTransaction({ date: '2026-06-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-06-20', amount: -500, merchant: 'Gym', type: 'Debit order' }),
				makeTransaction({ date: '2026-07-10', amount: -100, merchant: 'Shop' })
			],
			ontoggle: () => {},
			onvouch: () => {},
			onmonth: () => {}
		});

		await expect.element(page.getByText(/Nothing left from Jun 2026/)).toBeInTheDocument();
		expect(await page.getByText(/Try another month/).all()).toHaveLength(0);
		expect(await page.getByRole('button', { name: 'Month to offer from' }).all()).toHaveLength(0);
	});

	it('offers no picker where there is only one month to read back through', async () => {
		draw({
			transactions: [
				makeTransaction({ date: '2026-06-01', amount: -100, merchant: 'Shop' }),
				makeTransaction({ date: '2026-06-14', amount: -400, merchant: 'Vet' }),
				makeTransaction({ date: '2026-07-10', amount: -50, merchant: 'Shop' })
			],
			ontoggle: () => {},
			onvouch: () => {},
			onmonth: () => {}
		});

		await expect
			.element(page.getByText(/Jun 2026 has that this month has not seen/))
			.toBeInTheDocument();
		expect(await page.getByRole('button', { name: 'Month to offer from' }).all()).toHaveLength(0);
	});
});
