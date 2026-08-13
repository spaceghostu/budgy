<script lang="ts">
	import { formatCount, formatCurrency, formatPercent } from '../format.ts';
	import type { Bucket } from '../types.ts';

	interface Props {
		buckets: readonly Bucket[];
		/** How many rows to show before folding the rest into "Other". */
		limit?: number;
		/** Noun for the hover/meta line, e.g. "transaction". */
		unit?: string;
		emptyMessage?: string;
	}

	const {
		buckets,
		limit = 8,
		unit = 'transaction',
		emptyMessage = 'Nothing to show.'
	}: Props = $props();

	/**
	 * Never generate more colours for a long tail — everything past the limit
	 * folds into a single "Other" row, as the palette rules require.
	 */
	const rows = $derived.by(() => {
		if (buckets.length <= limit) return buckets;

		const head = buckets.slice(0, limit);
		const tail = buckets.slice(limit);

		return [
			...head,
			{
				label: `Other (${tail.length})`,
				total: tail.reduce((sum, bucket) => sum + bucket.total, 0),
				count: tail.reduce((sum, bucket) => sum + bucket.count, 0),
				share: tail.reduce((sum, bucket) => sum + bucket.share, 0)
			}
		];
	});

	const max = $derived(Math.max(...rows.map((row) => row.total), 0));
</script>

{#if rows.length === 0}
	<p class="empty">{emptyMessage}</p>
{:else}
	<ul>
		{#each rows as row (row.label)}
			<li>
				<div class="head">
					<span class="label" title={row.label}>{row.label}</span>
					<span class="value">{formatCurrency(row.total)}</span>
				</div>
				<div class="track">
					<div class="bar" style:width="{max > 0 ? (row.total / max) * 100 : 0}%"></div>
				</div>
				<p class="meta">{formatCount(row.count, unit)} · {formatPercent(row.share)} of the total</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	li {
		min-width: 0;
		padding: 4px 6px;
		margin: -4px -6px;
		border-radius: var(--radius-md);
		transition: background 120ms ease;
	}

	li:hover {
		background: var(--surface-2);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		color: var(--text-primary);
	}

	.value {
		flex: none;
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.track {
		margin-top: 6px;
		height: 10px;
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.bar {
		height: 100%;
		min-width: 2px;
		background: var(--series-1);
		/* Square at the baseline, rounded at the data end. */
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.meta {
		margin: 5px 0 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.empty {
		margin: 0;
		padding: 32px 0;
		text-align: center;
		color: var(--text-muted);
	}
</style>
