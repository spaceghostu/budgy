<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCount, formatCurrency, formatDate, formatMonth } from '../format.ts';
	import { counted, type ExpectedPayment, type Forecast } from '../stats/forecast.ts';

	interface Props {
		forecast: Forecast;
		/**
		 * Count a charge, or stop counting it.
		 *
		 * Left out where nothing can act on the answer — a list that offers a tick
		 * box and then ignores it would be worse than one that offers none.
		 */
		ontoggle?: (key: string, include: boolean) => void;
		/**
		 * Take up one of last month's payees. See {@link Forecast.candidates}.
		 *
		 * A different act from counting a charge already on the list, and so a
		 * different callback: this one adds a charge that was not there before.
		 */
		onvouch?: (payment: ExpectedPayment) => void;
		/**
		 * How many charges are ticked off in total, on screen or not.
		 *
		 * A choice is remembered for as long as it is made, but a charge is only
		 * *shown* while the forecast expects it — a metric that does not count that
		 * side, or a subscription that has since gone quiet, leaves the choice with
		 * no row to sit on. Said plainly here rather than left as state nobody can
		 * see, and cleared by the same control.
		 */
		remembered?: number;
		/** Count everything again — every choice, not only the rows on screen. */
		onclear?: () => void;
		/**
		 * Take a charge the reader added back out.
		 *
		 * Only their own rows can go: one the history found is a fact about the
		 * statement, and the tick box is how a reader disagrees with it.
		 */
		onremove?: (key: string) => void;
		/** Offer last month's payees from a different month. */
		onmonth?: (month: string) => void;
	}

	const { forecast, ontoggle, onvouch, remembered, onclear, onremove, onmonth }: Props = $props();

	const id = $props.id();

	/** Offered rows shown before the "show all" control appears. */
	const CANDIDATE_LIMIT = 8;

	let expanded = $state(false);

	/** Only what is still ticked adds up — the figures follow the boxes. */
	const outgoing = $derived(
		counted(forecast.expected).filter((payment) => payment.flow === 'expense')
	);
	const incoming = $derived(
		counted(forecast.expected).filter((payment) => payment.flow === 'income')
	);
	const dropped = $derived(forecast.expected.filter((payment) => !payment.included));
	/** Choices with no row on screen to sit on. See {@link Props.remembered}. */
	const elsewhere = $derived(Math.max((remembered ?? dropped.length) - dropped.length, 0));

	/** What is not being counted, said in one phrase or not at all. */
	const uncounted = $derived.by(() => {
		if (dropped.length === 0 && elsewhere === 0) return '';
		if (elsewhere === 0) return `${dropped.length} not counted`;
		if (dropped.length === 0) {
			return `${formatCount(elsewhere, 'charge')} ticked off elsewhere`;
		}

		return `${dropped.length} not counted, ${elsewhere} more ticked off elsewhere`;
	});

	const owed = $derived(sum(outgoing));
	const due = $derived(sum(incoming));

	/**
	 * The bottom line, with each side named only when there is one.
	 *
	 * A money-in forecast has nothing leaving the account, and "R0.00 still
	 * expected to leave" would be a figure standing in for an absence.
	 */
	const headline = $derived(
		[
			outgoing.length > 0 ? `${formatCurrency(owed)} still expected to leave` : '',
			incoming.length > 0 ? `${formatCurrency(due)} still expected to come in` : ''
		]
			.filter((half) => half !== '')
			.join(', and ')
	);

	// A long month can leave sixty payees on offer, and burying five commitments
	// under them would answer a question nobody asked first.
	const offered = $derived(
		expanded ? forecast.candidates : forecast.candidates.slice(0, CANDIDATE_LIMIT)
	);

	/** Newest first, the way a reader reads back through their own months. */
	const monthChoices = $derived([...forecast.candidateMonths].reverse());

	/** What the offer is, in one sentence — and what to do when there is none. */
	const offerNote = $derived.by(() => {
		const month = formatMonth(forecast.candidateMonth);
		if (forecast.candidates.length === 0) {
			// The invitation only where there is a picker to take it up with. An
			// instruction pointing at a control that is not there is worse than no
			// instruction at all.
			const elsewhere = monthChoices.length > 1 ? ' Try another month.' : '';

			return `Nothing left from ${month} — every payee it had is either counted above or already seen this month.${elsewhere}`;
		}

		return `${formatCount(forecast.candidates.length, 'payee')} ${month} has that this month has not seen yet. None of it is counted — tick anything you know is coming back, and it joins the list above at what its own history says it takes.`;
	});

	function sum(payments: readonly { amount: number }[]): number {
		return payments.reduce((total, payment) => total + payment.amount, 0);
	}

	/**
	 * The evidence behind one row, in a sentence: when it is due, what it is
	 * filed under, and how many months said so.
	 */
	function detail(payment: ExpectedPayment): string {
		// A late charge is named by the day it missed, not by the day it has been
		// moved to: that one is the next day left, the same for every late charge
		// on the list, and so tells a reader nothing about the one in front of
		// them. Where it has been moved to is said after it, and only when the two
		// are actually different days.
		const when = payment.overdue
			? [
					`was due ${formatDate(payment.dueDate)}`,
					payment.date !== payment.dueDate ? `now expected ${formatDate(payment.date)}` : ''
				]
					.filter((half) => half !== '')
					.join(', ')
			: `around ${formatDate(payment.date)}`;

		// A charge with nothing behind it says so plainly rather than claiming
		// nought past months, which reads as evidence weighed and found wanting
		// where the truth is that there was none to weigh.
		const evidence =
			payment.seen > 0 ? `seen in ${formatCount(payment.seen, 'past month')}` : 'nothing behind it';

		return [
			when,
			payment.category,
			payment.source === 'added' ? 'added by you' : '',
			payment.source === 'added' && payment.seen === 0 ? '' : evidence
		]
			.filter((part) => part !== '')
			.join(' · ');
	}

	/** What the row's box says, for a reader who cannot see the strike-through. */
	function boxLabel(payment: ExpectedPayment): string {
		const amount = `${payment.merchant}, ${formatCurrency(payment.amount)}`;
		if (payment.source === 'candidate') return `Expect ${amount}`;

		return payment.included ? `Counting ${amount}` : `Not counting ${amount}`;
	}

	/** Ticking an offer takes it up; ticking anything else counts it. */
	function toggle(payment: ExpectedPayment, next: boolean): void {
		if (payment.source === 'candidate') {
			if (next) onvouch?.(payment);
			return;
		}

		ontoggle?.(payment.key, next);
	}
</script>

{#snippet row(payment: ExpectedPayment, box: string)}
	{@const boxed = payment.source === 'candidate' ? onvouch !== undefined : ontoggle !== undefined}
	<li class="min-w-0 border-t py-2.5">
		<div class="flex items-baseline gap-2.5">
			{#if boxed}
				<!-- Sits with the row rather than in a column of its own: the tick is
				     about this charge, and a gutter of boxes would read as a selection
				     to act on later rather than a figure to count now. -->
				<Checkbox
					id={box}
					class="translate-y-0.5"
					checked={payment.included}
					aria-label={boxLabel(payment)}
					onCheckedChange={(next) => toggle(payment, next === true)}
				/>
			{/if}
			<Label
				for={box}
				class={cn(
					'flex min-w-0 flex-1 items-baseline justify-between gap-3 font-normal',
					boxed ? 'cursor-pointer' : 'cursor-auto'
				)}
			>
				<span
					class={cn('min-w-0 truncate text-[13px]', !payment.included && 'text-faint')}
					title={payment.merchant}
				>
					{payment.merchant}
				</span>
				<span
					class={cn(
						'flex-none text-[13px] font-semibold tabular-nums',
						payment.included && payment.flow === 'income' && 'text-positive',
						!payment.included && 'text-faint',
						!payment.included && payment.source !== 'candidate' && 'line-through'
					)}
				>
					{payment.flow === 'income' ? '+' : ''}{formatCurrency(payment.amount)}
				</span>
			</Label>
			{#if onremove && payment.source === 'added'}
				<Button
					variant="ghost"
					size="icon"
					class="size-6 flex-none text-muted-foreground hover:text-destructive"
					aria-label="Remove {payment.merchant}"
					onclick={() => onremove(payment.key)}
				>
					<XIcon aria-hidden="true" class="size-3.5" />
				</Button>
			{/if}
		</div>
		<p
			class={cn('mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-faint', boxed && 'ml-6.5')}
		>
			{#if payment.isDebitOrder}
				<Badge
					variant="outline"
					class="rounded-full border-input px-1.5 py-px text-[11px] font-normal text-muted-foreground"
				>
					Debit order
				</Badge>
			{/if}
			{#if payment.overdue && payment.source !== 'candidate'}
				<!-- Late, not cancelled: it is still counted, on the first day left. -->
				<Badge
					variant="outline"
					class="rounded-full border-input px-1.5 py-px text-[11px] font-normal text-muted-foreground"
				>
					Late
				</Badge>
			{/if}
			<span>{detail(payment)}</span>
		</p>
	</li>
{/snippet}

{#if forecast.expected.length === 0}
	<p class="py-6 text-center text-[13px] text-faint">
		{#if forecast.month === ''}
			Nothing to expect yet.
		{:else if forecast.isComplete}
			The month is over, so nothing more is expected of it.
		{:else if forecast.monthsOfHistory === 0}
			No complete month sits behind this one yet, so there is no history to expect anything from. A
			second month's export gives this something to work with.
		{:else}
			Nothing the history calls regular is still to come this month.
		{/if}
	</p>
{:else}
	<div class="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<p class="text-[13px] text-muted-foreground">
			{#if headline === ''}
				<strong class="text-[15px] text-foreground">Nothing counted</strong>
			{:else}
				<strong class="text-[15px] text-foreground">{headline}</strong>
			{/if}
			· {formatCount(counted(forecast.expected).length, 'charge')}
			{#if uncounted !== ''}
				<span class="text-faint">· {uncounted}</span>
			{/if}
		</p>

		{#if onclear && uncounted !== ''}
			<Button
				variant="outline"
				size="xs"
				class="border-input hover:border-series"
				onclick={onclear}
			>
				Count all again
			</Button>
		{/if}
	</div>

	<ul class="flex list-none flex-col p-0">
		{#each forecast.expected as payment, index (payment.key)}
			{@render row(payment, `${id}-e-${index}`)}
		{/each}
	</ul>
{/if}

{#if forecast.candidateMonths.length > 0}
	<!-- What the recurring test is silent about, which is most of a month. Not
	     counted, and not guessed at either: last month is simply laid out for the
	     reader to say which of it is coming back. -->
	<section class={cn(forecast.expected.length > 0 && 'mt-5 border-t pt-4')}>
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<!-- The month is named by the picker beside it, or by the sentence under
			     it where there is no picker — saying it three times would read as a
			     mistake rather than as emphasis. -->
			<h4 class="text-[13px] font-semibold">Everything else</h4>

			{#if onmonth && monthChoices.length > 1}
				<!-- Beside the heading it changes, not up with the controls that scope the
				     whole card: this one moves which month is being read back through, and
				     nothing else on the page answers to it. -->
				<Select.Root
					type="single"
					value={forecast.candidateMonth}
					onValueChange={(month) => onmonth(month)}
				>
					<Select.Trigger aria-label="Month to offer from" class="h-8 w-33 text-[13px]">
						{formatMonth(forecast.candidateMonth)}
					</Select.Trigger>
					<Select.Content>
						{#each monthChoices as month (month)}
							<Select.Item value={month} label={formatMonth(month)}>
								{formatMonth(month)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}
		</div>

		<p class="mt-0.5 mb-1.5 text-xs text-muted-foreground">{offerNote}</p>

		<ul class="flex list-none flex-col p-0">
			{#each offered as payment, index (payment.key)}
				{@render row(payment, `${id}-c-${index}`)}
			{/each}
		</ul>

		{#if forecast.candidates.length > CANDIDATE_LIMIT}
			<Button
				variant="outline"
				size="xs"
				class="mt-3 border-input hover:border-series"
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? 'Show fewer' : `Show all ${forecast.candidates.length}`}
			</Button>
		{/if}
	</section>
{/if}

{#if ontoggle && forecast.expected.length > 0}
	<p class="mt-3.5 border-t pt-3 text-xs text-faint">
		Untick anything that is not coming — a subscription cancelled, a loan settled — and the
		projection stops counting it. The row stays, so nothing disappears from the history that named
		it, and the choice is remembered for next month's export.
	</p>
{/if}
