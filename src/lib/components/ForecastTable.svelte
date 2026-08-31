<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatDate, formatOrdinal } from '../format.ts';
	import { CALENDAR_START, cycleDate, isCalendarStart } from '../stats/cycle.ts';
	import { counted, type Forecast } from '../stats/forecast.ts';

	interface Props {
		forecast: Forecast;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { forecast, monthStart = CALENDAR_START }: Props = $props();

	const dayNote = $derived(
		isCalendarStart(monthStart) ? '' : ` Day 1 is the ${formatOrdinal(monthStart)}.`
	);

	/** Only worth a column when the months behind disagree about the rest. */
	const hasRange = $derived(
		forecast.points.some((point) => point.isProjected && point.high !== point.low)
	);

	const rows = $derived(
		forecast.points.map((point) => ({
			...point,
			date: formatDate(cycleDate(forecast.month, monthStart, point.day)),
			// The chart's twin, so it shows what the chart shows: charges the
			// reader has ticked off are neither drawn nor listed here.
			due: counted(forecast.expected).filter((payment) => payment.day === point.day)
		}))
	);

	const numeric = 'text-right tabular-nums';
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">
			This month's running total by day, projected past the day the statement stops.{dayNote}
		</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={columnHead}>Day</Table.Head>
				<Table.Head class={columnHead}>Date</Table.Head>
				<Table.Head class={cn(columnHead, numeric)}>Running total</Table.Head>
				{#if hasRange}
					<Table.Head class={cn(columnHead, numeric)}>Lean – heavy</Table.Head>
				{/if}
				<Table.Head class={columnHead}>Expected</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.day)}
				<Table.Row>
					<th scope="row" class="px-2.5 py-2 text-left text-xs font-medium text-muted-foreground">
						{row.day}{#if row.isProjected}<span class="text-faint" title="Projected, not banked"
								>*</span
							>{/if}
					</th>
					<Table.Cell class="px-2.5 whitespace-nowrap text-muted-foreground">{row.date}</Table.Cell>
					<Table.Cell class={cn('px-2.5', numeric, row.isProjected && 'text-muted-foreground')}>
						{formatCurrency(row.total)}
					</Table.Cell>
					{#if hasRange}
						<Table.Cell class={cn('px-2.5 whitespace-nowrap text-faint', numeric)}>
							{#if row.isProjected && row.high !== row.low}
								{formatCurrency(row.low)} – {formatCurrency(row.high)}
							{:else}
								—
							{/if}
						</Table.Cell>
					{/if}
					<Table.Cell class="px-2.5 text-xs text-muted-foreground">
						{#each row.due as payment (payment.merchant)}
							<span class="mr-2 whitespace-nowrap">
								{payment.merchant}
								{payment.flow === 'income' ? '+' : ''}{formatCurrency(payment.amount)}
							</span>
						{:else}
							<span class="text-faint">—</span>
						{/each}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={hasRange ? 5 : 4} class="py-7 text-center text-faint">
						No transactions to forecast.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>

{#if rows.some((row) => row.isProjected)}
	<p class="mt-2.5 text-xs text-faint">
		* Projected from past months rather than banked — see the note under the chart.
	</p>
{/if}
