<script lang="ts">
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import ChartCard from './ChartCard.svelte';
	import MonthComparisonChart from './MonthComparisonChart.svelte';
	import MonthComparisonTable from './MonthComparisonTable.svelte';
	import { formatCount, formatMonth } from '../format.ts';
	import { compareMonths } from '../stats/compare.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import { listMonths } from '../stats/monthly.ts';
	import type { CompareDimension, Transaction } from '../types.ts';

	interface Props {
		/**
		 * Every transaction for the account, **not** the period-filtered slice: a
		 * card that compares months cannot be scoped to one of them.
		 */
		transactions: readonly Transaction[];
		/** The month the rest of the page is looking at — where the window ends. */
		focusMonth: string;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
		/**
		 * Opens the rows behind a label. Given the months the figure stood for, so
		 * the list the reader lands on is the one they clicked and not a wider one:
		 * a single month's bar opens that month, the row's own heading opens all of
		 * the months compared.
		 */
		onselect?: (label: string, months: readonly string[], dimension: CompareDimension) => void;
	}

	const { transactions, focusMonth, monthStart = CALENDAR_START, onselect }: Props = $props();

	const DIMENSIONS: readonly { id: CompareDimension; label: string }[] = [
		{ id: 'category', label: 'Category' },
		{ id: 'merchant', label: 'Merchant' }
	];

	/** Offered only when there are more months than that, or it is just "All". */
	const COUNTS = [3, 6, 12];

	/**
	 * How many months the card opens on.
	 *
	 * Three rather than everything the statement has: a dozen bars per category
	 * is a picture nobody reads, and the question this card answers first is what
	 * moved lately. The table takes as many as the reader asks it for.
	 */
	const DEFAULT_COUNT = 3;

	let dimension = $state<CompareDimension>('category');
	/** `null` while the reader has not chosen — the card follows the page instead. */
	let picked = $state<readonly string[] | null>(null);

	const available = $derived(listMonths(transactions, monthStart));

	/**
	 * The last few months up to the one the page is on.
	 *
	 * The period row above cannot scope this card, but it can say where the
	 * reader is looking: parked on June, the comparison opens on June and the two
	 * before it rather than on months they have navigated away from. Choosing
	 * months explicitly stops it moving — a selection that shifted under the
	 * reader when they changed the period would not be a selection.
	 */
	const followed = $derived.by(() => {
		const end = available.indexOf(focusMonth);
		const stop = end < 0 ? available.length : end + 1;

		return available.slice(Math.max(stop - DEFAULT_COUNT, 0), stop);
	});

	const shown = $derived(picked ?? followed);
	const comparison = $derived(compareMonths(transactions, shown, dimension, monthStart));

	const counts = $derived(COUNTS.filter((count) => count < available.length));
	const noun = $derived(dimension === 'merchant' ? 'merchant' : 'category');

	const subtitle = $derived(
		shown.length < 2
			? `Spending by ${noun}, one month at a time — pick a second month to compare against`
			: `Spending by ${noun} across ${formatCount(shown.length, 'month')}, side by side`
	);

	function isLastN(count: number): boolean {
		return (
			shown.length === count && available.slice(-count).every((month) => shown.includes(month))
		);
	}

	/** Blank while the selection is one the shortcuts do not describe. */
	const countChoice = $derived.by(() => {
		if (shown.length === available.length) return 'all';
		return counts.find(isLastN)?.toString() ?? '';
	});

	/** One month when a month's own bar was clicked, otherwise all of them. */
	const select = $derived(
		onselect === undefined
			? undefined
			: (label: string, month?: string) =>
					onselect(label, month === undefined ? shown : [month], dimension)
	);
</script>

<ChartCard title="What changed, month against month" {subtitle}>
	{#snippet toolbar()}
		<div class="flex min-w-0 flex-col gap-1.5">
			<span id="compare-by-label" class="text-xs text-muted-foreground">Compare by</span>
			<ToggleGroup
				type="single"
				variant="outline"
				size="sm"
				aria-labelledby="compare-by-label"
				value={dimension}
				onValueChange={(next) => {
					// Something is always rolled up, so the group cannot be emptied.
					if (next) dimension = next as CompareDimension;
				}}
			>
				{#each DIMENSIONS as option (option.id)}
					<ToggleGroupItem value={option.id} class="text-[13px]">{option.label}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</div>

		{#if available.length > 1}
			<div class="flex min-w-0 flex-col gap-1.5">
				<span id="compare-count-label" class="text-xs text-muted-foreground">Months</span>
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="compare-count-label"
					value={countChoice}
					onValueChange={(next) => {
						if (!next) return;
						picked = next === 'all' ? [...available] : available.slice(-Number(next));
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

			<!-- Chips rather than a popover: the same idiom as the month-against-month
			     card above, and every month stays visible instead of hiding behind a
			     disclosure. Unselected is the resting state here — the card opens on a
			     few months — so adding one is the visible act. -->
			<ToggleGroup
				type="multiple"
				variant="outline"
				size="sm"
				spacing={1.5}
				class="basis-full flex-wrap"
				aria-label="Months to compare"
				value={[...shown]}
				onValueChange={(next) => {
					// One month has to stay on screen — an empty card is never the ask.
					if (next.length === 0) return;
					picked = [...next].sort();
				}}
			>
				{#each [...available].reverse() as month (month)}
					<ToggleGroupItem value={month} class="text-xs">{formatMonth(month)}</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		{/if}
	{/snippet}

	{#snippet chart()}
		<MonthComparisonChart {comparison} {monthStart} onselect={select} />
	{/snippet}
	{#snippet table()}
		<MonthComparisonTable {comparison} {monthStart} onselect={select} />
	{/snippet}
</ChartCard>
