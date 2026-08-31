<script lang="ts">
	import ChartCard from '$lib/components/ChartCard.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import RecurringList from '$lib/components/RecurringList.svelte';
	import TransactionList from '$lib/components/TransactionList.svelte';
	import { useStatement } from '$lib/state/context.js';

	const state = useStatement();
	const insights = $derived(state.insights);

	const twoUp = 'grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-5';
</script>

{#if !state.hasStatement}
	<NoStatement
		what="Repeating charges and your biggest expenses"
		savedCount={state.library.count}
	/>
{:else}
	<div class={twoUp}>
		<ChartCard
			title="Charges that repeat"
			subtitle="Debit orders, plus anything billing across two or more months"
		>
			{#snippet chart()}
				<RecurringList charges={insights.recurring} />
			{/snippet}
		</ChartCard>

		<ChartCard title="Biggest single hits" subtitle="The largest amounts to leave the account">
			{#snippet chart()}
				<TransactionList
					transactions={insights.largestExpenses}
					emptyMessage="No spending in this range."
				/>
			{/snippet}
		</ChartCard>
	</div>
{/if}
