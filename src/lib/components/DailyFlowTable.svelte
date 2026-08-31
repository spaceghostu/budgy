<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatCurrency, formatDate, formatMonth } from '../format.ts';
	import { CALENDAR_START, cycleOf } from '../stats/cycle.ts';
	import type { DailyFlow } from '../types.ts';

	interface Props {
		days: readonly DailyFlow[];
		/** True when each row is a month rather than a day. */
		monthly?: boolean;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { days, monthly = false, monthStart = CALENDAR_START }: Props = $props();

	function label(date: string): string {
		return monthly ? formatMonth(cycleOf(date, monthStart)) : formatDate(date);
	}

	/** Sticky so the headings stay readable while a long list scrolls under them. */
	const head = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
	const numeric = 'px-2.5 text-right tabular-nums';
</script>

<div class="max-h-105 overflow-y-auto">
	<Table.Root class="text-[13px]">
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={head}>{monthly ? 'Month' : 'Day'}</Table.Head>
				<Table.Head class="{head} text-right">In</Table.Head>
				<Table.Head class="{head} text-right">Out</Table.Head>
				<Table.Head class="{head} text-right">Net</Table.Head>
				<Table.Head class="{head} text-right">Closing balance</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each [...days].reverse() as day (day.date)}
				<Table.Row>
					<Table.Cell class="px-2.5">{label(day.date)}</Table.Cell>
					<Table.Cell class={numeric}>
						{day.income === 0 ? '—' : formatCurrency(day.income)}
					</Table.Cell>
					<Table.Cell class={numeric}>
						{day.expense === 0 ? '—' : formatCurrency(day.expense)}
					</Table.Cell>
					<Table.Cell class="{numeric} {day.net > 0 ? 'text-positive' : ''}">
						{formatCurrency(day.net)}
					</Table.Cell>
					<Table.Cell class="{numeric} text-muted-foreground">
						{formatCurrency(day.closingBalance)}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={5} class="py-7 text-center text-faint">
						No transactions in this range.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
