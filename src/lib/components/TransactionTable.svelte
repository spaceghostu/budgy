<script lang="ts">
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
</script>

{#if searchable}
	<div class="toolbar">
		<input
			type="search"
			placeholder="Search description, category, merchant…"
			bind:value={query}
			aria-label="Search transactions"
		/>
		<p class="count">{sorted.length} of {rows.length}</p>
	</div>
{/if}

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th scope="col" aria-sort={ariaSort('date')}>
					<button type="button" onclick={() => sort('date')}>Date</button>
				</th>
				<th scope="col">Description</th>
				<th scope="col" class="hide-narrow">Category</th>
				<th scope="col" class="numeric" aria-sort={ariaSort('amount')}>
					<button type="button" onclick={() => sort('amount')}>Amount</button>
				</th>
				<th scope="col" class="numeric" aria-sort={ariaSort('balance')}>
					<button type="button" onclick={() => sort('balance')}>Balance</button>
				</th>
			</tr>
		</thead>
		<tbody>
			{#each visible as row (row.transaction.id)}
				<tr>
					<td class="date">
						{formatDate(row.transaction.date)}
						{#if row.transaction.time}<span class="time">{row.transaction.time.slice(0, 5)}</span
							>{/if}
					</td>
					<td>
						<span class="description"
							>{row.transaction.description || row.transaction.merchant}</span
						>
						{#if row.transaction.counterparty}
							<span class="counterparty">{row.transaction.counterparty}</span>
						{/if}
					</td>
					<td class="hide-narrow category">{row.transaction.category}</td>
					<td class="numeric" class:credit={row.transaction.amount > 0}>
						{formatCurrency(row.transaction.amount)}
					</td>
					<td class="numeric balance">{formatCurrency(row.balance)}</td>
				</tr>
			{:else}
				<tr>
					<td colspan="5" class="empty">No transactions match.</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if sorted.length > pageSize}
	<button class="more" type="button" onclick={() => (expanded = !expanded)}>
		{expanded ? 'Show fewer' : `Show all ${sorted.length}`}
	</button>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	input[type='search'] {
		flex: 1;
		min-width: 0;
		padding: 7px 11px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
	}

	.count {
		margin: 0;
		flex: none;
		font-size: 12px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th {
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-secondary);
		padding: 0 10px 8px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	th button {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	th button:hover {
		color: var(--text-primary);
	}

	th.numeric,
	td.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	td {
		padding: 9px 10px;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}

	tbody tr:hover {
		background: var(--surface-2);
	}

	.date {
		white-space: nowrap;
		color: var(--text-secondary);
	}

	.time {
		margin-left: 6px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.description {
		display: block;
		max-width: 42ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.counterparty,
	.category {
		color: var(--text-muted);
		font-size: 12px;
	}

	.credit {
		color: var(--status-good-text);
	}

	.balance {
		color: var(--text-secondary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 28px 0;
	}

	.more {
		margin-top: 12px;
		padding: 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 12px;
		cursor: pointer;
	}

	.more:hover {
		border-color: var(--series-1);
	}

	@media (max-width: 640px) {
		.hide-narrow {
			display: none;
		}
	}
</style>
