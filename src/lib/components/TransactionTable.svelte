<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatDate } from '../format.ts';
	import type { BalancePoint } from '../types.ts';

	interface Props {
		/** The balance series, so each row can carry the balance it left behind. */
		series: readonly BalancePoint[];
		/** Rows shown before the "show all" control appears. */
		pageSize?: number;
		searchable?: boolean;
	}

	const { series, pageSize = 25, searchable = true }: Props = $props();

	type Column = 'date' | 'amount' | 'balance';

	let query = $state('');
	let sortBy = $state<Column>('date');
	let ascending = $state(false);
	let expanded = $state(false);

	const rows = $derived(
		series.filter(
			(point): point is BalancePoint & { transaction: NonNullable<BalancePoint['transaction']> } =>
				point.transaction !== null
		)
	);

	const matching = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (needle === '') return rows;

		return rows.filter((row) =>
			[
				row.transaction.description,
				row.transaction.merchant,
				row.transaction.category,
				row.transaction.bankCategory,
				row.transaction.counterparty,
				row.transaction.type
			].some((field) => field.toLowerCase().includes(needle))
		);
	});

	const sorted = $derived.by(() => {
		const direction = ascending ? 1 : -1;
		const value = {
			date: (row: (typeof rows)[number]) => row.transaction.timestamp,
			amount: (row: (typeof rows)[number]) => row.transaction.amount,
			balance: (row: (typeof rows)[number]) => row.balance
		}[sortBy];

		return [...matching].sort((a, b) => (value(a) - value(b)) * direction);
	});

	const visible = $derived(expanded ? sorted : sorted.slice(0, pageSize));

	function sort(column: Column): void {
		if (sortBy === column) {
			ascending = !ascending;
			return;
		}
		sortBy = column;
		ascending = column === 'date' ? false : true;
	}

	function ariaSort(column: Column): 'ascending' | 'descending' | 'none' {
		if (sortBy !== column) return 'none';
		return ascending ? 'ascending' : 'descending';
	}

	const head = 'h-auto px-2.5 pb-2 text-xs text-muted-foreground';
	const numeric = 'text-right tabular-nums';
	/** The category column is the first to go when the card gets narrow. */
	const hideNarrow = 'max-sm:hidden';
</script>

{#if searchable}
	<div class="mb-3 flex items-center gap-3">
		<Input
			type="search"
			placeholder="Search description, category, merchant…"
			class="min-w-0 flex-1 text-[13px]"
			bind:value={query}
			aria-label="Search transactions"
		/>
		<p class="flex-none text-xs text-faint tabular-nums">{sorted.length} of {rows.length}</p>
	</div>
{/if}

<Table.Root class="text-[13px]">
	<Table.Header>
		<Table.Row class="hover:bg-transparent">
			<Table.Head class={head} aria-sort={ariaSort('date')}>
				<button
					type="button"
					class="cursor-pointer hover:text-foreground"
					onclick={() => sort('date')}
				>
					Date
				</button>
			</Table.Head>
			<Table.Head class={head}>Description</Table.Head>
			<Table.Head class={cn(head, hideNarrow)}>Category</Table.Head>
			<Table.Head class={cn(head, numeric)} aria-sort={ariaSort('amount')}>
				<button
					type="button"
					class="cursor-pointer hover:text-foreground"
					onclick={() => sort('amount')}
				>
					Amount
				</button>
			</Table.Head>
			<Table.Head class={cn(head, numeric)} aria-sort={ariaSort('balance')}>
				<button
					type="button"
					class="cursor-pointer hover:text-foreground"
					onclick={() => sort('balance')}
				>
					Balance
				</button>
			</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each visible as row (row.transaction.id)}
			<Table.Row>
				<Table.Cell class="px-2.5 py-2.5 align-top whitespace-nowrap text-muted-foreground">
					{formatDate(row.transaction.date)}
					{#if row.transaction.time}
						<span class="ml-1.5 text-faint tabular-nums">{row.transaction.time.slice(0, 5)}</span>
					{/if}
				</Table.Cell>
				<Table.Cell class="px-2.5 py-2.5 align-top">
					<span class="block max-w-[42ch] truncate">
						{row.transaction.description || row.transaction.merchant}
					</span>
					{#if row.transaction.counterparty}
						<span class="text-xs text-faint">{row.transaction.counterparty}</span>
					{/if}
				</Table.Cell>
				<Table.Cell class={cn('px-2.5 py-2.5 align-top text-xs text-faint', hideNarrow)}>
					{row.transaction.category}
				</Table.Cell>
				<Table.Cell
					class={cn(
						'px-2.5 py-2.5 align-top',
						numeric,
						row.transaction.amount > 0 && 'text-positive'
					)}
				>
					{formatCurrency(row.transaction.amount)}
				</Table.Cell>
				<Table.Cell class={cn('px-2.5 py-2.5 align-top text-muted-foreground', numeric)}>
					{formatCurrency(row.balance)}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row class="hover:bg-transparent">
				<Table.Cell colspan={5} class="py-7 text-center text-faint"
					>No transactions match.</Table.Cell
				>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>

{#if sorted.length > pageSize}
	<Button
		variant="outline"
		size="xs"
		class="mt-3 border-input hover:border-series"
		onclick={() => (expanded = !expanded)}
	>
		{expanded ? 'Show fewer' : `Show all ${sorted.length}`}
	</Button>
{/if}
