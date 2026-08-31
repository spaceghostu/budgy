<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ButtonGroup } from '$lib/components/ui/button-group/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import { formatDate, formatMonth } from '../format.ts';
	import { CALENDAR_START, cycleClosing, cycleOpening } from '../stats/cycle.ts';
	import {
		RANGE_OPTIONS,
		ALL_ACCOUNTS,
		type RangePreset,
		type StatementState
	} from '../state/statement.svelte.ts';

	interface Props {
		state: StatementState;
		/**
		 * How much of the row applies to the page under it.
		 *
		 * `account` is for a page that answers about the whole statement rather
		 * than a slice of it, but still about one account — a forecast is learned
		 * from the months either side of the one it is about, so a period would
		 * scope away the very history it reads. Offering a control that changes
		 * nothing is worse than not offering it.
		 */
		scope?: 'full' | 'account';
	}

	const { state, scope = 'full' }: Props = $props();

	const showAccounts = $derived(state.accounts.length > 1);
	const showPeriod = $derived(scope === 'full');

	const monthIndex = $derived(state.months.indexOf(state.activeMonth));
	const atOldest = $derived(monthIndex <= 0);
	const atNewest = $derived(monthIndex < 0 || monthIndex === state.months.length - 1);

	const accountLabel = $derived(state.account === ALL_ACCOUNTS ? 'All accounts' : state.account);

	/**
	 * Which days "Aug 2026" actually covers, spelled out.
	 *
	 * Only while the months are not the calendar's: there the name says it, and a
	 * second line repeating "1 Aug – 31 Aug" would be noise.
	 */
	const span = $derived.by(() => {
		if (state.monthStart === CALENDAR_START || state.activeMonth === '') return '';

		const from = cycleOpening(state.activeMonth, state.monthStart);
		const to = cycleClosing(state.activeMonth, state.monthStart);

		return `${formatDate(from)} – ${formatDate(to)}`;
	});
</script>

<!-- One row, above everything it scopes: every figure below re-renders together. -->
<div class="flex flex-wrap items-end gap-4">
	{#if showAccounts}
		<div class="flex min-w-0 flex-col gap-1.5">
			<Label for="account" class="text-xs text-muted-foreground">Account</Label>
			<Select.Root type="single" bind:value={state.account}>
				<Select.Trigger id="account" class="text-[13px]">{accountLabel}</Select.Trigger>
				<Select.Content>
					{#each state.accounts as account (account)}
						<Select.Item value={account} label={account}>{account}</Select.Item>
					{/each}
					<Select.Item value={ALL_ACCOUNTS} label="All accounts">All accounts</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if showPeriod}
		<div class="flex min-w-0 flex-col gap-1.5">
			<span id="range-label" class="text-xs text-muted-foreground">Period</span>
			<ToggleGroup
				type="single"
				variant="outline"
				aria-labelledby="range-label"
				value={state.range}
				onValueChange={(next) => {
					// Some period is always in force, so the group cannot be emptied.
					if (next) state.range = next as RangePreset;
				}}
			>
				{#each RANGE_OPTIONS as option (option.id)}
					<ToggleGroupItem value={option.id} class="text-[13px]">{option.label}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</div>

		{#if state.range === 'month'}
			<div class="flex min-w-0 flex-col gap-1.5">
				<span id="month-label" class="text-xs text-muted-foreground">
					Showing{#if span !== ''}<span class="text-faint"> · {span}</span>{/if}
				</span>
				<!-- Arrows for the common step, the select for a jump across the year. -->
				<ButtonGroup aria-labelledby="month-label">
					<Button
						variant="outline"
						size="icon"
						aria-label="Previous month"
						disabled={atOldest}
						onclick={() => state.stepMonth(-1)}
					>
						<ChevronLeftIcon aria-hidden="true" />
					</Button>
					<!-- Reads from the resolved month, not the raw selection, which starts
					     blank and stands for "whichever month is newest". -->
					<Select.Root
						type="single"
						value={state.activeMonth}
						onValueChange={(month) => (state.selectedMonth = month)}
					>
						<Select.Trigger aria-label="Month" class="min-w-29.5 text-[13px]">
							{formatMonth(state.activeMonth)}
						</Select.Trigger>
						<Select.Content>
							{#each [...state.months].reverse() as month (month)}
								<Select.Item value={month} label={formatMonth(month)}>
									{formatMonth(month)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						variant="outline"
						size="icon"
						aria-label="Next month"
						disabled={atNewest}
						onclick={() => state.stepMonth(1)}
					>
						<ChevronRightIcon aria-hidden="true" />
					</Button>
				</ButtonGroup>
			</div>
		{/if}

		{#if state.range === 'custom'}
			<div class="flex min-w-0 flex-col gap-1.5">
				<Label for="from" class="text-xs text-muted-foreground">From</Label>
				<Input
					id="from"
					type="date"
					class="w-fit text-[13px]"
					bind:value={state.customFrom}
					min={state.earliestDate}
					max={state.latestDate}
				/>
			</div>
			<div class="flex min-w-0 flex-col gap-1.5">
				<Label for="to" class="text-xs text-muted-foreground">To</Label>
				<Input
					id="to"
					type="date"
					class="w-fit text-[13px]"
					bind:value={state.customTo}
					min={state.earliestDate}
					max={state.latestDate}
				/>
			</div>
		{/if}
	{/if}
</div>
