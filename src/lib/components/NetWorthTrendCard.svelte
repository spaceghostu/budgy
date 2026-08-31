<script lang="ts">
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import ChartCard from './ChartCard.svelte';
	import NetWorthChart from './NetWorthChart.svelte';
	import NetWorthTable from './NetWorthTable.svelte';
	import { formatCount, formatDate } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import { monthsCovered, sliceNetWorth } from '../stats/networth.ts';
	import type { NetWorth } from '../stats/networth.ts';

	interface Props {
		/** Day of the month the reader's months open on. */
		monthStart?: number;
		/** Every account added up, across the statement's whole history. */
		worth: NetWorth;
	}

	const { worth, monthStart = CALENDAR_START }: Props = $props();

	/**
	 * The same steps the month-against-month card offers, so "last 6 months"
	 * names the same six months on both charts.
	 */
	const PERIODS = [3, 6, 12];

	/** Months to show. `null` stands for the whole history. */
	let months = $state<number | null>(null);

	const covered = $derived(monthsCovered(worth, monthStart));
	/** A period longer than the history is the history, so it is not offered. */
	const periods = $derived(PERIODS.filter((period) => period < covered));

	const window = $derived(sliceNetWorth(worth, months, monthStart));
	const from = $derived(window.days.at(0)?.date ?? '');
	const to = $derived(window.days.at(-1)?.date ?? '');

	const subtitle = $derived(
		window.days.length === 0
			? 'Every account added together'
			: months === null
				? `Every account added together, end to end across all ${formatCount(covered, 'month')}`
				: `Every account added together, from ${formatDate(from)} to ${formatDate(to)}`
	);
</script>

<ChartCard title="Net worth over time" {subtitle}>
	{#snippet toolbar()}
		{#if periods.length > 0}
			<div class="flex min-w-0 flex-col gap-1.5">
				<span id="trend-period-label" class="text-xs text-muted-foreground">Period</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="trend-period-label"
					value={months === null ? 'all' : months.toString()}
					onValueChange={(next) => {
						// Something is always plotted, so the group cannot be emptied.
						if (!next) return;
						months = next === 'all' ? null : Number(next);
					}}
				>
					{#each periods as period (period)}
						<ToggleGroupItem value={period.toString()} class="text-[13px]">
							Last {period}
						</ToggleGroupItem>
					{/each}
					<ToggleGroupItem value="all" class="text-[13px]">All</ToggleGroupItem>
				</ToggleGroup>
			</div>
		{/if}
	{/snippet}

	{#snippet chart()}
		<!-- The window carries its own opening level, so a shorter period moves
		     where the line starts without moving what it says the money was. -->
		<NetWorthChart days={window.days} opening={window.opening} isRelative={worth.isRelative} />
	{/snippet}
	{#snippet table()}
		<NetWorthTable days={window.days} opening={window.opening} />
	{/snippet}
</ChartCard>
