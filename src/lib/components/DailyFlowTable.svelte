<script lang="ts">
	import { formatCurrency, formatDate, formatMonth } from '../format.ts';
	import type { DailyFlow } from '../types.ts';

	interface Props {
		days: readonly DailyFlow[];
		/** True when each row is a month rather than a day. */
		monthly?: boolean;
	}

	const { days, monthly = false }: Props = $props();

	function label(date: string): string {
		return monthly ? formatMonth(date.slice(0, 7)) : formatDate(date);
	}
</script>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th scope="col">{monthly ? 'Month' : 'Day'}</th>
				<th scope="col" class="numeric">In</th>
				<th scope="col" class="numeric">Out</th>
				<th scope="col" class="numeric">Net</th>
				<th scope="col" class="numeric">Closing balance</th>
			</tr>
		</thead>
		<tbody>
			{#each [...days].reverse() as day (day.date)}
				<tr>
					<td>{label(day.date)}</td>
					<td class="numeric">{day.income === 0 ? '—' : formatCurrency(day.income)}</td>
					<td class="numeric">{day.expense === 0 ? '—' : formatCurrency(day.expense)}</td>
					<td class="numeric" class:credit={day.net > 0}>{formatCurrency(day.net)}</td>
					<td class="numeric muted">{formatCurrency(day.closingBalance)}</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="empty">No transactions in this range.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
		max-height: 420px;
		overflow-y: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	th {
		position: sticky;
		top: 0;
		background: var(--surface-1);
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-secondary);
		padding: 0 10px 8px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	td {
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.credit {
		color: var(--status-good-text);
	}

	.muted {
		color: var(--text-secondary);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 28px 0;
	}
</style>
