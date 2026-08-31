<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import { formatCount, formatCurrency, formatDate, formatOrdinal } from '../format.ts';
	import {
		CALENDAR_START,
		cycleDate,
		cycleLength,
		isCalendarStart,
		LAST_START
	} from '../stats/cycle.ts';
	import type { AddedCharge, Payee } from '../stats/forecast.ts';

	interface Props {
		/**
		 * Payees the statement has, for the half of the ask that is not custom.
		 * Read by {@link listPayees}, so the figure beside a name here is the one
		 * the forecast will expect once it is picked.
		 */
		payees: readonly Payee[];
		/**
		 * Day of the month the reader's months open on.
		 *
		 * The day entered here is a day of *their* month, not of the calendar —
		 * that is what the forecast does with it — so with a month that opens on
		 * the 25th, day 1 is the 25th. The form has to say so, or a reader would
		 * enter the 1st and watch a bill land three weeks early.
		 */
		monthStart?: number;
		/** The `YYYY-MM` cycle being forecast, for naming the date a day lands on. */
		month?: string;
		onadd: (charge: AddedCharge) => void;
	}

	const { payees, monthStart = CALENDAR_START, month = '', onadd }: Props = $props();

	/** Days a month can have. A charge on the 31st lands on the last day of a short one. */
	const LAST_DAY = 31;

	let open = $state(false);
	let picking = $state(false);
	let flow = $state<'income' | 'expense'>('expense');
	let query = $state('');
	/** The payee chosen off the list, or `null` while the name is the reader's own. */
	let picked = $state<Payee | null>(null);
	let amount = $state('');
	let day = $state('');

	const name = $derived(picked?.merchant ?? query.trim());

	/** Only payees on the side of the money the charge is on. */
	const choices = $derived(payees.filter((payee) => payee.flow === flow));

	/**
	 * What the charge would be, or the reason it is not one yet.
	 *
	 * Read while it is typed rather than checked on submit, so the button says
	 * what is missing by being disabled beside the field that is missing it.
	 */
	const problem = $derived.by(() => {
		if (name === '') return 'Name the payee, or pick one from the list.';
		if (picked !== null) return null;
		if (!(Number(amount) > 0)) return 'How much is it for?';

		const chosen = Number(day);
		if (!Number.isInteger(chosen) || chosen < 1 || chosen > LAST_DAY) {
			return `Which day of the month? 1 to ${LAST_DAY}.`;
		}

		return null;
	});

	/** What the history says a picked payee takes, said before it is added. */
	const preview = $derived.by(() => {
		if (picked === null) return '';
		if (picked.months === 0) return 'Nothing in this statement to go on yet.';

		const figures = `${formatCurrency(picked.amount)} a month across ${formatCount(picked.months, 'month')}`;

		// Said before it is added, not discovered afterwards by a list that does
		// not change: this month already has the money, so there is nothing left
		// of it to expect.
		if (picked.arrived) {
			return `${figures}. It has already billed this month, so it will be expected from next month.`;
		}

		return `${figures} — the figures follow its history, so a price that moves is expected at the new one.`;
	});

	/** True while a day of the reader's month is not a day of the calendar's. */
	const shifted = $derived(!isCalendarStart(monthStart));

	/**
	 * The day entered, said back as the date it lands on.
	 *
	 * The one unambiguous way to show what "day 12" means when months open on
	 * the 25th — an ordinal alone leaves the reader to do cycle arithmetic in
	 * their head, which is the arithmetic this whole page exists to do for them.
	 */
	const lands = $derived.by(() => {
		const chosen = Number(day);
		if (month === '' || !Number.isInteger(chosen) || chosen < 1 || chosen > LAST_DAY) return '';

		// Clamped the way the forecast clamps it: a charge entered on the 31st
		// lands on the last day of a month that has none, exactly as the bank
		// would take it, rather than falling into the month after.
		const landed = Math.min(chosen, cycleLength(month, monthStart));

		return formatDate(cycleDate(month, monthStart, landed));
	});

	function reset(): void {
		flow = 'expense';
		query = '';
		picked = null;
		amount = '';
		day = '';
	}

	function choose(payee: Payee): void {
		picked = payee;
		query = payee.merchant;
		picking = false;
	}

	/** Typing past a chosen payee is naming one of the reader's own again. */
	function retype(next: string): void {
		query = next;
		picked = null;
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (problem !== null) return;

		onadd(
			picked !== null
				? { kind: 'merchant', merchant: picked.merchant, flow }
				: {
						kind: 'custom',
						id: crypto.randomUUID(),
						name,
						flow,
						amount: Number(amount),
						day: Number(day),
						category: ''
					}
		);

		open = false;
		reset();
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) reset();
	}}
>
	<Dialog.Trigger class={buttonVariants({ variant: 'outline', size: 'sm' })}>
		<PlusIcon aria-hidden="true" />
		Add a payment
	</Dialog.Trigger>

	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="text-[15px]">Add a payment</Dialog.Title>
			<Dialog.Description class="text-[13px]">
				For what the recurring test could not see. Pick a payee out of your own statement and it
				brings its own figures, or type a bill that is not in these files at all.
			</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="flex flex-col gap-1.5">
				<span id="charge-flow" class="text-xs text-muted-foreground">Direction</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="charge-flow"
					value={flow}
					onValueChange={(next) => {
						if (!next) return;
						flow = next as 'income' | 'expense';
						// The payee lists differ by side, so a choice made on the other
						// one is no longer a choice that was offered.
						picked = null;
					}}
				>
					<ToggleGroupItem value="expense" class="text-[13px]">Money out</ToggleGroupItem>
					<ToggleGroupItem value="income" class="text-[13px]">Money in</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="charge-name" class="text-xs text-muted-foreground">Payee</Label>
				<Popover.Root bind:open={picking}>
					<div class="flex gap-1.5">
						<Input
							id="charge-name"
							class="text-[13px]"
							placeholder="Who takes it, or what it is"
							autocomplete="off"
							value={query}
							oninput={(event) => retype(event.currentTarget.value)}
						/>
						<Popover.Trigger
							class={buttonVariants({ variant: 'default', size: 'sm' })}
							disabled={choices.length === 0}
						>
							Pick from history
						</Popover.Trigger>
					</div>

					<Popover.Content class="w-[--bits-popover-anchor-width] p-0" align="end">
						<Command.Root>
							<Command.Input placeholder="Search payees…" />
							<Command.List>
								<Command.Empty class="py-4 text-[13px] text-faint">
									No payee by that name — add it as your own instead.
								</Command.Empty>
								{#each choices as payee (payee.merchant)}
									<Command.Item
										value={payee.merchant}
										onSelect={() => choose(payee)}
										class="text-[13px]"
									>
										<span class="min-w-0 flex-1 truncate">{payee.merchant}</span>
										<span class="flex-none text-xs text-faint tabular-nums">
											{formatCurrency(payee.amount)}
										</span>
									</Command.Item>
								{/each}
							</Command.List>
						</Command.Root>
					</Popover.Content>
				</Popover.Root>

				{#if preview !== ''}
					<p class="text-xs text-faint">{preview}</p>
				{:else if choices.length > 0}
					<p class="text-xs text-faint">
						{formatCount(choices.length, 'payee')} in your statement to choose from — one picked here
						goes on tracking its own price, and needs no amount or day.
					</p>
				{/if}
			</div>

			<!-- Asked only where nothing can answer them. A payee out of the statement
			     brings its own figures, and typing over them here would quietly stop
			     them tracking the history that is the reason for picking it. -->
			{#if picked === null}
				<div class="flex flex-wrap gap-4">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<Label for="charge-amount" class="text-xs text-muted-foreground">Amount</Label>
						<Input
							id="charge-amount"
							type="number"
							inputmode="decimal"
							step="0.01"
							min="0"
							class="text-[13px]"
							placeholder="0.00"
							bind:value={amount}
						/>
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<Label for="charge-day" class="text-xs text-muted-foreground">
							{shifted ? 'Day of your month' : 'Day of the month'}
						</Label>
						<Input
							id="charge-day"
							type="number"
							inputmode="numeric"
							min="1"
							max={LAST_DAY}
							class="text-[13px]"
							placeholder={`${LAST_START}`}
							bind:value={day}
						/>
						{#if lands !== ''}
							<!-- Said as a date, because with months that open on the 25th a
							     bare ordinal is a different day from the one it names. -->
							<p class="text-xs text-faint">
								{#if shifted}
									Day 1 is the {formatOrdinal(monthStart)}, so this lands on {lands} this month.
								{:else}
									Lands on {lands} this month.
								{/if}
							</p>
						{:else if shifted}
							<p class="text-xs text-faint">
								Counted from the {formatOrdinal(monthStart)}, the day your months open.
							</p>
						{/if}
						{#if Number(day) > LAST_START}
							<p class="text-xs text-faint">
								The {formatOrdinal(Number(day))} falls on the last day of a month that has none.
							</p>
						{/if}
					</div>
				</div>
			{/if}

			<Dialog.Footer class="gap-2">
				{#if problem !== null}
					<p class="mr-auto self-center text-xs text-faint">{problem}</p>
				{/if}
				<Dialog.Close class={buttonVariants({ variant: 'outline', size: 'sm' })}
					>Cancel</Dialog.Close
				>
				<Button type="submit" size="sm" disabled={problem !== null}>Add it</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
