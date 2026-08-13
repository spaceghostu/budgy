<script lang="ts">
	import { formatCount, formatCurrency, formatDate, formatMonth } from '../format.ts';
	import type { RecurringCharge } from '../types.ts';

	interface Props {
		charges: readonly RecurringCharge[];
		/** Rows shown before the "show all" control appears. */
		limit?: number;
	}

	const { charges, limit = 12 }: Props = $props();

	let expanded = $state(false);

	const total = $derived(charges.reduce((sum, charge) => sum + charge.latestAmount, 0));
	// A two-year statement can turn up dozens of repeating charges; the biggest
	// are the ones worth acting on, and the rest are a click away.
	const visible = $derived(expanded ? charges : charges.slice(0, limit));

	/** Naming twenty months would swamp the line; a span says the same thing. */
	function monthsLabel(months: readonly string[]): string {
		if (months.length <= 3) return `seen in ${months.map(formatMonth).join(', ')}`;

		return `seen in ${months.length} months, ${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`;
	}
</script>

{#if charges.length === 0}
	<p class="empty">
		No repeating charges found in this period. A longer statement gives this more to work with.
	</p>
{:else}
	<p class="total">
		<strong>{formatCurrency(total)}</strong> a month across
		{formatCount(charges.length, 'repeating charge')}
	</p>

	<ul>
		{#each visible as charge (charge.merchant)}
			<li>
				<div class="row">
					<span class="name" title={charge.merchant}>{charge.merchant}</span>
					<span class="amount">{formatCurrency(charge.latestAmount)}</span>
				</div>
				<p class="meta">
					{#if charge.isDebitOrder}<span class="tag">Debit order</span>{/if}
					{charge.category} · last on {formatDate(charge.lastSeen)}
					{#if charge.count > 1}
						· {formatCount(charge.count, 'charge')}
					{/if}
					{#if charge.months.length > 1}
						· {monthsLabel(charge.months)}
						{#if charge.meanAmount !== charge.latestAmount || charge.medianAmount !== charge.latestAmount}
							· mean {formatCurrency(charge.meanAmount)}, median
							{formatCurrency(charge.medianAmount)} a month
						{/if}
					{/if}
				</p>
			</li>
		{/each}
	</ul>

	{#if charges.length > limit}
		<button type="button" onclick={() => (expanded = !expanded)}>
			{expanded ? 'Show fewer' : `Show all ${charges.length}`}
		</button>
	{/if}
{/if}

<style>
	.total {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.total strong {
		color: var(--text-primary);
		font-size: 15px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	li {
		padding: 10px 0;
		border-top: 1px solid var(--border);
		min-width: 0;
	}

	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
	}

	.amount {
		flex: none;
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.meta {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.tag {
		display: inline-block;
		margin-right: 6px;
		padding: 1px 6px;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		font-size: 11px;
		color: var(--text-secondary);
	}

	.empty {
		margin: 0;
		padding: 24px 0;
		text-align: center;
		color: var(--text-muted);
		font-size: 13px;
	}

	button {
		margin-top: 12px;
		padding: 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 12px;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--series-1);
	}
</style>
