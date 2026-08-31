<script lang="ts">
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import ChartCard from './ChartCard.svelte';
	import MonthlyTotalsChart from './MonthlyTotalsChart.svelte';
	import MonthlyTotalsTable from './MonthlyTotalsTable.svelte';
	import { formatCount, formatMonth } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import { netWorthByMonth } from '../stats/networth.ts';
	import type { NetWorth } from '../stats/networth.ts';

	interface Props {
		/** Every account added up, across the statement's whole history. */
		worth: NetWorth;
		/** The month the reader is otherwise looking at, drawn in full strength. */
		focusMonth: string;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { worth, focusMonth, monthStart = CALENDAR_START }: Props = $props();

	/** Offered only when there are more months than that, or it is just "All". */
	const COUNTS = [3, 6, 12];

	/** Months to draw. Empty stands for every month, not for none. */
	let picked = $state<readonly string[]>([]);

	const all = $derived(netWorthByMonth(worth, monthStart));
	const available = $derived(all.map((month) => month.month));

	const shown = $derived(
		picked.length === 0 ? all : all.filter((month) => picked.includes(month.month))
	);

	const focus = $derived(
		shown.some((month) => month.month === focusMonth) ? focusMonth : (shown.at(-1)?.month ?? '')
	);

	const counts = $derived(COUNTS.filter((count) => count < available.length));

	const subtitle = $derived(
		shown.length === all.length
			? `Everything you own on each day of the month — all ${formatCount(all.length, 'month')}, laid over each other`
			: `${formatCount(shown.length, 'month')} of ${all.length}, laid over the same days`
	);

	/**
	 * Unlike a flow chart, nothing resets here, so the wording has to say where
	 * each line comes from — a reader who has seen the month-against-month chart
	 * will otherwise read these as month totals.
	 */
	const caption = $derived(
		worth.isRelative
			? `A shape rather than money: ${listNames(worth.unanchored)} ${worth.unanchored.length === 1 ? 'has' : 'have'} no balance set, so the whole line is out by whatever sits there. The movement is still true.`
			: 'Every account added together, held between the days it moved. Nothing resets at the start of a month — each line carries on from where the last closed. The stronger the colour, the more recent the month.'
	);

	function listNames(names: readonly string[]): string {
		if (names.length <= 1) return names[0] ?? '';
		return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
	}

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

<ChartCard title="Net worth, month against month" {subtitle}>
	{#snippet toolbar()}
		{#if available.length > 1}
			<div class="flex min-w-0 flex-col gap-1.5">
				<span id="worth-count-label" class="text-xs text-muted-foreground">Months</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="worth-count-label"
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
		<!-- No typical line: a median across absolute levels would sit wherever the
		     middle month's balance happened to be, which says nothing about a
		     typical month. And no zero baseline — see the chart's own note. -->
		<MonthlyTotalsChart
			months={shown}
			focusMonth={focus}
			{caption}
			{monthStart}
			baseline="data"
			shade="recency"
			label="Net worth through the month, one line per month, shaded from the oldest month to the newest. Switch to the table view for the underlying figures."
		/>
	{/snippet}
	{#snippet table()}
		<MonthlyTotalsTable
			months={shown}
			signed={false}
			{monthStart}
			caption="Net worth on each day of the month, one column per month."
		/>
	{/snippet}
</ChartCard>
