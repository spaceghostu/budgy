<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatDate } from '../format.ts';
	import type { Runway } from '../stats/runway.ts';

	interface Props {
		runway: Runway;
	}

	const { runway }: Props = $props();

	/** Only worth a column when the months behind disagree about the rest. */
	const hasRange = $derived(runway.days.some((day) => day.isProjected && day.high !== day.low));

	const numeric = 'text-right tabular-nums';
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">
			The balance projected day by day from today to the day before payday.
		</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={columnHead}>Date</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>Balance</Table.Head>
				{#if hasRange}
					<Table.Head class={cn(columnHead, numeric)}>Lean – heavy</Table.Head>
				{/if}
				<Table.Head class={columnHead}>Expected</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each runway.days as day (day.day)}
				<Table.Row>
					<th scope="row" class="px-2.5 py-2 text-left text-xs font-medium whitespace-nowrap">
						<span class="text-muted-foreground">{formatDate(day.date)}</span>
						{#if day.isProjected}<span class="text-faint" title="Projected, not banked">*</span
							>{/if}
					</th>
					<Table.Cell
						class={cn(
							'px-2.5',
							numeric,
							day.balance < 0
								? 'font-medium text-destructive'
								: day.isProjected && 'text-muted-foreground'
						)}
					>
						{formatCurrency(day.balance)}
					</Table.Cell>
					{#if hasRange}
						<Table.Cell class={cn('px-2.5 whitespace-nowrap text-faint', numeric)}>
							{#if day.isProjected && day.high !== day.low}
								{formatCurrency(day.low)} – {formatCurrency(day.high)}
							{:else}
								—
							{/if}
						</Table.Cell>
					{/if}
					<Table.Cell class="px-2.5 text-xs text-muted-foreground">
						{#each day.payments as payment (payment.key)}
							<span class="mr-2 whitespace-nowrap">
								{payment.merchant}
								{payment.flow === 'income' ? '+' : '−'}{formatCurrency(payment.amount)}
							</span>
						{:else}
							<span class="text-faint">—</span>
						{/each}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={hasRange ? 4 : 3} class="py-7 text-center text-faint">
						No transactions to project from.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

{#if runway.days.some((day) => day.isProjected)}
	<p class="mt-2.5 text-xs text-faint">
		* Projected rather than banked — see the note under the chart.
	</p>
{/if}
