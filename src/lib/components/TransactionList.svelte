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
	<p class="py-6 text-center text-[13px] text-faint">{emptyMessage}</p>
{:else}
	<ol class="list-none p-0">
		{#each transactions as transaction (transaction.id)}
			<li class="min-w-0 border-t py-2.5 first:border-t-0 first:pt-0">
				<div class="flex items-baseline justify-between gap-3">
					<!-- The merchant, not the raw statement line: reference numbers
					     make a "biggest hits" list unreadable. The full description
					     stays one hover away, and in the transactions table. -->
					<span class="min-w-0 truncate text-[13px]" title={transaction.description}>
						{transaction.merchant}
					</span>
					<span class="flex-none text-[13px] font-semibold tabular-nums">
						{formatCurrency(Math.abs(transaction.amount))}
					</span>
				</div>
				<p class="mt-1 text-xs text-faint">
					{formatDate(transaction.date)} · {transaction.category}
				</p>
			</li>
		{/each}
	</ol>
{/if}
