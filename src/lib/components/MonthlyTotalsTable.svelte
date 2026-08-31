<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import { formatCurrency, formatMonth, formatOrdinal } from '../format.ts';
	import { CALENDAR_START, isCalendarStart } from '../stats/cycle.ts';
	import type { MonthMetric, MonthPoint, MonthSeries } from '../types.ts';

	interface Props {
		months: readonly MonthSeries[];
		/** The middle month day by day. `null` when the chart is not showing it. */
		typical?: readonly MonthPoint[] | null;
		/** Which side of the money the totals add up. */
		metric?: MonthMetric;
		/** Says what the figures are, in place of the default wording. */
		caption?: string;
		/** Overrides whether a positive month total reads as good news. */
		signed?: boolean;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const {
		months,
		typical = null,
		metric = 'net',
		caption = 'Running total through each month, by day of the month.',
		signed: signedOverride,
		monthStart = CALENDAR_START
	}: Props = $props();

	/** The day column counts from the day a month opens, which may not be the 1st. */
	const dayNote = $derived(
		isCalendarStart(monthStart) ? '' : ` Day 1 is the ${formatOrdinal(monthStart)}.`
	);

	/**
	 * Only a net total can be good news. On a money-out total every figure is
	 * positive by construction, and painting them green would say a heavy month
	 * of spending went well.
	 */
	const signed = $derived(signedOverride ?? metric === 'net');

	/** Newest first, so the month the reader came for is the first column. */
	const columns = $derived([...months].reverse());
	const days = $derived(
		Array.from(
			{ length: Math.max(...months.map((month) => month.points.length), 0) },
			(_, i) => i + 1
		)
	);

	/** Blank rather than zero where a month has no such day — February has 28. */
	function totalOn(points: readonly MonthPoint[], day: number): string {
		const point = points[day - 1];
		return point === undefined || point.day !== day ? '—' : formatCurrency(point.total);
	}

	const numeric = 'text-right tabular-nums';
	/* The month headings and the day column both have to survive a scroll — a
	   figure in the middle of this table means nothing without either. */
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
	/* A rule where the frozen column meets the scrolling ones, so a half-scrolled
	   figure beside it reads as scrolled rather than as broken. */
	const rowHead =
		'sticky left-0 z-10 border-r bg-card px-2.5 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground';
	const footCell = 'sticky bottom-0 z-20 border-t border-input bg-card px-2.5 font-semibold';
	/* A derived reference rather than a month, so it sits in muted ink behind a
	   rule, the way the frozen day column does. */
	const typicalInk = 'border-r text-muted-foreground';
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">{caption}{dayNote}</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={cn(columnHead, 'left-0 z-30 border-r')}>Day</Table.Head>
				{#if typical}
					<Table.Head class={cn(columnHead, numeric, typicalInk)}>Typical</Table.Head>
				{/if}
				{#each columns as month (month.month)}
					<Table.Head class={cn(columnHead, numeric)}>
						{formatMonth(month.month)}{#if month.isPartial}<span
								class="text-faint"
								title="The statement may not cover the whole of this month">*</span
							>{/if}
					</Table.Head>
				{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each days as day (day)}
				<Table.Row>
					<th scope="row" class={rowHead}>{day}</th>
					{#if typical}
						<Table.Cell class={cn('px-2.5', numeric, typicalInk)}>
							{totalOn(typical, day)}
						</Table.Cell>
					{/if}
					{#each columns as month (month.month)}
						<Table.Cell class={cn('px-2.5', numeric)}>{totalOn(month.points, day)}</Table.Cell>
					{/each}
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell
						colspan={columns.length + (typical ? 2 : 1)}
						class="py-7 text-center text-faint"
					>
						No transactions to compare.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
		{#if columns.length > 0}
			<Table.Footer class="bg-transparent">
				<Table.Row class="hover:bg-transparent">
					<th
						scope="row"
						class={cn(
							rowHead,
							'bottom-0 left-0 z-30 border-t border-input font-semibold text-foreground'
						)}
					>
						Month
					</th>
					{#if typical}
						<Table.Cell class={cn(footCell, numeric, typicalInk)}>
							{formatCurrency(typical.at(-1)?.total ?? 0)}
						</Table.Cell>
					{/if}
					{#each columns as month (month.month)}
						<Table.Cell class={cn(footCell, numeric, signed && month.total > 0 && 'text-positive')}>
							{formatCurrency(month.total)}
						</Table.Cell>
					{/each}
				</Table.Row>
			</Table.Footer>
		{/if}
	</Table.Root>
</div>

{#if columns.some((month) => month.isPartial)}
	<!-- "May", deliberately: a first month with nothing on the 1st is
	     indistinguishable from a statement that opened on the 2nd. -->
	<p class="mt-2.5 text-xs text-faint">* The statement may not cover the whole of this month.</p>
{/if}
