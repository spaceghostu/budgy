<script lang="ts">
	import { formatCurrency, formatDate } from '../format.ts';
	import type { Transaction } from '../types.ts';

	interface Props {
		transactions: readonly Transaction[];
		emptyMessage?: string;
	}

	const { transactions, emptyMessage = 'Nothing to show.' }: Props = $props();
</script>

{#if transactions.length === 0}
	<p class="empty">{emptyMessage}</p>
{:else}
	<ol>
		{#each transactions as transaction (transaction.id)}
			<li>
				<div class="row">
					<!-- The merchant, not the raw statement line: reference numbers
					     make a "biggest hits" list unreadable. The full description
					     stays one hover away, and in the transactions table. -->
					<span class="name" title={transaction.description}>{transaction.merchant}</span>
					<span class="amount">{formatCurrency(Math.abs(transaction.amount))}</span>
				</div>
				<p class="meta">{formatDate(transaction.date)} · {transaction.category}</p>
			</li>
		{/each}
	</ol>
{/if}

<style>
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		counter-reset: rank;
	}

	li {
		padding: 10px 0;
		border-top: 1px solid var(--border);
		min-width: 0;
	}

	li:first-child {
		border-top: 0;
		padding-top: 0;
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

	.empty {
		margin: 0;
		padding: 24px 0;
		text-align: center;
		color: var(--text-muted);
		font-size: 13px;
	}
</style>
