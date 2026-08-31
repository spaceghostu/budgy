<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import ChartCard from './ChartCard.svelte';
	import MonthlyTotalsChart from './MonthlyTotalsChart.svelte';
	import MonthlyTotalsTable from './MonthlyTotalsTable.svelte';
	import { formatCount, formatMonth } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import { buildMonthlyTotals, typicalMonth } from '../stats/monthly.ts';
	import type { MonthMetric, Transaction } from '../types.ts';

	interface Props {
		/**
		 * Every transaction for the account, **not** the period-filtered slice: a
		 * chart that compares months cannot be scoped to one of them.
		 */
		transactions: readonly Transaction[];
		/** The month the rest of the page is looking at, drawn in full strength. */
		focusMonth: string;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { transactions, focusMonth, monthStart = CALENDAR_START }: Props = $props();

	const METRICS: readonly { id: MonthMetric; label: string }[] = [
		{ id: 'net', label: 'Net' },
		{ id: 'out', label: 'Money out' },
		{ id: 'in', label: 'Money in' }
	];

	/** Offered only when there are more months than that, or it is just "All". */
	const COUNTS = [3, 6, 12];

	let metric = $state<MonthMetric>('net');
	/** Months to draw. Empty stands for every month, not for none. */
	let picked = $state<readonly string[]>([]);
	let showTypical = $state(true);

	const all = $derived(buildMonthlyTotals(transactions, metric, monthStart));
	const available = $derived(all.map((month) => month.month));

	const shown = $derived(
		picked.length === 0 ? all : all.filter((month) => picked.includes(month.month))
	);

	/** A median of one month is that month, which is not a comparison. */
	const typical = $derived(showTypical && shown.length > 1 ? typicalMonth(shown) : null);

	/** Follow the page's month while it is on screen, else the newest drawn. */
	const focus = $derived(
		shown.some((month) => month.month === focusMonth) ? focusMonth : (shown.at(-1)?.month ?? '')
	);

	const counts = $derived(COUNTS.filter((count) => count < available.length));

	const subtitle = $derived(
		shown.length === all.length
			? `Every month's running total on the same days — all ${formatCount(all.length, 'month')}, whichever period is selected above`
			: `${formatCount(shown.length, 'month')} of ${all.length}, laid over the same days`
	);

	function isLastN(count: number): boolean {
		return (
			picked.length === count && available.slice(-count).every((month) => picked.includes(month))
		);
	}

	/** Blank while the selection is one the shortcuts do not describe. */
	const countChoice = $derived.by(() => {
		if (picked.length === 0) return 'all';
		return counts.find(isLastN)?.toString() ?? '';
	});

	/** Every month is selected unless a subset was picked. */
	const selectedMonths = $derived(picked.length === 0 ? [...available] : [...picked]);
</script>

<ChartCard title="Month against month" {subtitle}>
	{#snippet toolbar()}
		<div class="flex min-w-0 flex-col gap-1.5">
			<span id="metric-label" class="text-xs text-muted-foreground">Plot</span>
			<ToggleGroup
				type="single"
				variant="outline"
				size="sm"
				aria-labelledby="metric-label"
				value={metric}
				onValueChange={(next) => {
					// Something is always plotted, so the group cannot be emptied.
					if (next) metric = next as MonthMetric;
				}}
			>
				{#each METRICS as option (option.id)}
					<ToggleGroupItem value={option.id} class="text-[13px]">{option.label}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</div>

		{#if available.length > 1}
			<div class="flex min-w-0 flex-col gap-1.5">
				<span id="count-label" class="text-xs text-muted-foreground">Months</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="count-label"
					value={countChoice}
					onValueChange={(next) => {
						if (!next) return;
						picked = next === 'all' ? [] : available.slice(-Number(next));
					}}
				>
					{#each counts as count (count)}
						<ToggleGroupItem value={count.toString()} class="text-[13px]">
							Last {count}
						</ToggleGroupItem>
					{/each}
					<ToggleGroupItem value="all" class="text-[13px]">All</ToggleGroupItem>
				</ToggleGroup>
			</div>
		{/if}

		{#if shown.length > 1}
			<div class="flex items-center gap-1.75 pb-1.5">
				<Checkbox id="typical-month" bind:checked={showTypical} />
				<Label for="typical-month" class="text-[13px] font-normal text-muted-foreground">
					Typical month
				</Label>
			</div>
		{/if}

		{#if available.length > 1}
			<!-- Chips rather than a popover: same idiom as the period row, and every
			     month stays visible instead of hiding behind a disclosure.

			     Selected is the resting state here — most months are on — so the mark
			     is a quiet fill rather than a badge, and dropping one is the visible act. -->
			<ToggleGroup
				type="multiple"
				variant="outline"
				size="sm"
				spacing={1.5}
				class="basis-full flex-wrap"
				aria-label="Months to compare"
				value={selectedMonths}
				onValueChange={(next) => {
					// One month has to stay on screen — an empty chart is never the ask.
					if (next.length === 0) return;
					picked = next.length === available.length ? [] : next;
				}}
			>
				{#each [...available].reverse() as month (month)}
					<ToggleGroupItem value={month} class="text-xs">{formatMonth(month)}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		{/if}
	{/snippet}

	{#snippet chart()}
		<MonthlyTotalsChart months={shown} focusMonth={focus} {metric} {typical} {monthStart} />
	{/snippet}
	{#snippet table()}
		<MonthlyTotalsTable months={shown} {typical} {metric} />
	{/snippet}
</ChartCard>
