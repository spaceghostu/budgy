<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import TransactionTable from '$lib/components/TransactionTable.svelte';
	import { formatCount } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';

	const state = useStatement();
</script>

{#if !state.hasStatement}
	<NoStatement what="Every transaction, searchable" savedCount={state.library.count} />
{:else}
	<ChartCard title="All transactions" subtitle="Search, sort and check the working">
		{#snippet chart()}
			<TransactionTable series={state.insights.balanceSeries} />
		{/snippet}
	</ChartCard>

	<!-- Kept beside the rows rather than on the overview: what could not be read
	     is a question about this table, and it is answered where it is asked. -->
	{#if state.issues.length > 0}
		<Card.Root class="[--card-spacing:--spacing(5)]">
			<Card.Content>
				<h2 class="mb-2 text-sm font-semibold">
					{formatCount(state.issues.length, 'note')} about reading these files
				</h2>
				<ul class="list-disc pl-5 text-[13px] text-muted-foreground">
					{#each state.issues.slice(0, 10) as issue, index (index)}
						<li>{issue.reason}</li>
					{/each}
				</ul>
				{#if state.issues.length > 10}
					<p class="mt-2 text-xs text-faint">…and {state.issues.length - 10} more.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
{/if}
