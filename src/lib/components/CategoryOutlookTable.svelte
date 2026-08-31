<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatPercent } from '../format.ts';
	import type { CategoryOutlook } from '../stats/runway.ts';

	interface Props {
		rows: readonly CategoryOutlook[];
		/** False when the reader has narrowed the page to the named charges. */
		everydayOn: boolean;
	}

	const { rows, everydayOn }: Props = $props();

	const numeric = 'text-right tabular-nums';
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
	/** Every column the table shows, so an empty row can span them. */
	const columns = $derived(everydayOn ? 5 : 4);
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">
			What each category still has to take between now and payday, heaviest first.
		</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={columnHead}>Category</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>Named</Table.Head>
				{#if everydayOn}
					<Table.Head class={cn(columnHead, numeric)}>Everyday</Table.Head>
				{/if}
				<Table.Head class={cn(columnHead, numeric)}>Still to spend</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>Share</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.category)}
				<Table.Row>
					<th scope="row" class="px-2.5 py-2 text-left font-normal">{row.category}</th>
					<Table.Cell class={cn('px-2.5 text-muted-foreground', numeric)}>
						{row.named === 0 ? '—' : formatCurrency(row.named)}
					</Table.Cell>
					{#if everydayOn}
						<Table.Cell class={cn('px-2.5 text-muted-foreground', numeric)}>
							{row.everyday === 0 ? '—' : formatCurrency(row.everyday)}
						</Table.Cell>
					{/if}
					<Table.Cell class={cn('px-2.5 font-medium', numeric)}>
						{formatCurrency(row.total)}
					</Table.Cell>
					<Table.Cell class={cn('px-2.5 text-faint', numeric)}>
						{formatPercent(row.share)}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={columns} class="py-7 text-center text-faint">
						{everydayOn
							? 'Nothing left to spend before payday.'
							: 'No named charges left before payday.'}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
