<script lang="ts">
	import { formatCurrency, formatPercent } from '../format.ts';
	import type { Bucket } from '../types.ts';

	interface Props {
		buckets: readonly Bucket[];
		heading: string;
	}

	const { buckets, heading }: Props = $props();
</script>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th scope="col">{heading}</th>
				<th scope="col" class="numeric">Total</th>
				<th scope="col" class="numeric">Count</th>
				<th scope="col" class="numeric">Share</th>
			</tr>
		</thead>
		<tbody>
			{#each buckets as bucket (bucket.label)}
				<tr>
					<td>{bucket.label}</td>
					<td class="numeric">{formatCurrency(bucket.total)}</td>
					<td class="numeric">{bucket.count}</td>
					<td class="numeric">{formatPercent(bucket.share)}</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="empty">Nothing to show.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
		max-height: 420px;
		overflow-y: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th {
		position: sticky;
		top: 0;
		background: var(--surface-1);
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-secondary);
		padding: 0 10px 8px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	td {
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 28px 0;
	}
</style>
