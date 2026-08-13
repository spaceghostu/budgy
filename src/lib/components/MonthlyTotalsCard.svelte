<script lang="ts">
	import ChartCard from './ChartCard.svelte';
	import MonthlyTotalsChart from './MonthlyTotalsChart.svelte';
	import MonthlyTotalsTable from './MonthlyTotalsTable.svelte';
	import { formatCount, formatMonth } from '../format.ts';
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
	}

	const { transactions, focusMonth }: Props = $props();

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

	const all = $derived(buildMonthlyTotals(transactions, metric));
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
		return picked.length === count && available.slice(-count).every(isPicked);
	}

	function isPicked(month: string): boolean {
		return picked.length === 0 || picked.includes(month);
	}

	function toggle(month: string): void {
		const current = picked.length === 0 ? available : picked;
		const next = current.includes(month)
			? current.filter((other) => other !== month)
			: [...current, month];

		// One month has to stay on screen — an empty chart is never the ask.
		if (next.length === 0) return;
		picked = next.length === available.length ? [] : next;
	}
</script>

<ChartCard title="Month against month" {subtitle}>
	{#snippet toolbar()}
		<div class="group">
			<span id="metric-label">Plot</span>
			<div class="segmented" role="group" aria-labelledby="metric-label">
				{#each METRICS as option (option.id)}
					<button
						type="button"
						class:selected={metric === option.id}
						aria-pressed={metric === option.id}
						onclick={() => (metric = option.id)}>{option.label}</button
					>
				{/each}
			</div>
		</div>

		{#if available.length > 1}
			<div class="group">
				<span id="count-label">Months</span>
				<div class="segmented" role="group" aria-labelledby="count-label">
					{#each counts as count (count)}
						<button
							type="button"
							class:selected={isLastN(count)}
							aria-pressed={isLastN(count)}
							onclick={() => (picked = available.slice(-count))}>Last {count}</button
						>
					{/each}
					<button
						type="button"
						class:selected={picked.length === 0}
						aria-pressed={picked.length === 0}
						onclick={() => (picked = [])}>All</button
					>
				</div>
			</div>
		{/if}

		{#if shown.length > 1}
			<label class="toggle">
				<input type="checkbox" bind:checked={showTypical} />
				<span>Typical month</span>
			</label>
		{/if}

		{#if available.length > 1}
			<!-- Chips rather than a popover: same idiom as the period row, and every
			     month stays visible instead of hiding behind a disclosure. -->
			<div class="chips" role="group" aria-label="Months to compare">
				{#each [...available].reverse() as month (month)}
					<button
						type="button"
						class:selected={isPicked(month)}
						aria-pressed={isPicked(month)}
						onclick={() => toggle(month)}>{formatMonth(month)}</button
					>
				{/each}
			</div>
		{/if}
	{/snippet}

	{#snippet chart()}
		<MonthlyTotalsChart months={shown} focusMonth={focus} {metric} {typical} />
	{/snippet}
	{#snippet table()}
		<MonthlyTotalsTable months={shown} {typical} {metric} />
	{/snippet}
</ChartCard>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	.group > span {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.segmented {
		display: inline-flex;
		flex-wrap: wrap;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface-1);
	}

	.segmented button {
		border: 0;
		background: transparent;
		padding: 5px 11px;
		font-size: 13px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.segmented button + button {
		border-left: 1px solid var(--border);
	}

	.segmented button:hover:not(.selected),
	.chips button:hover:not(.selected) {
		background: var(--surface-2);
	}

	.segmented button.selected {
		background: var(--surface-2);
		color: var(--text-primary);
		font-weight: 600;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		padding-bottom: 5px;
		font-size: 13px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.chips {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chips button {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		padding: 3px 9px;
		font-size: 12px;
		color: var(--text-muted);
		cursor: pointer;
	}

	/* Selected is the resting state here — most months are on — so the mark is a
	   quiet fill rather than a badge, and dropping one is the visible act. */
	.chips button.selected {
		border-color: var(--border-strong);
		background: var(--surface-2);
		color: var(--text-primary);
	}
</style>
