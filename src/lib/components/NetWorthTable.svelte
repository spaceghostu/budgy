<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatDate, formatSigned } from '../format.ts';
	import type { NetWorthDay } from '../stats/networth.ts';

	interface Props {
		/** One entry per day something moved, oldest first. */
		days: readonly NetWorthDay[];
		/** The total before the first transaction, which the first day moved. */
		opening: number;
	}

	const { days, opening }: Props = $props();

	/** Newest first: the figure the reader came for is the first row. */
	const rows = $derived(
		days
			.map((day, index) => ({
				...day,
				change: day.total - (index === 0 ? opening : days[index - 1].total)
			}))
			.reverse()
	);

	const numeric = 'text-right tabular-nums';
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">
			Net worth across every account on each day it moved, newest first.
		</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={columnHead}>Date</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>Net worth</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>That day</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.date)}
				<Table.Row>
					<th scope="row" class="px-2.5 py-2 text-left font-normal whitespace-nowrap">
						{formatDate(row.date)}
					</th>
					<Table.Cell class={cn('px-2.5 font-medium', numeric)}>
						{formatCurrency(row.total)}
					</Table.Cell>
					<Table.Cell class={cn('px-2.5', numeric, row.change > 0 && 'text-positive')}>
						{formatSigned(row.change)}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={3} class="py-7 text-center text-faint">
						No transactions yet.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
