<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils.js';
	import {
		formatCurrency,
		formatMonth,
		formatOrdinal,
		formatPercent,
		formatSigned
	} from '../format.ts';
	import { CALENDAR_START, isCalendarStart } from '../stats/cycle.ts';
	import { allSpending } from '../stats/compare.ts';
	import type { MonthComparison } from '../types.ts';

	interface Props {
		comparison: MonthComparison;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
		/**
		 * Opens the rows behind a label, either across every month compared
		 * (`month` left out) or in the one month whose figure was clicked.
		 */
		onselect?: (label: string, month?: string) => void;
	}

	const { comparison, monthStart = CALENDAR_START, onselect }: Props = $props();

	const heading = $derived(comparison.dimension === 'merchant' ? 'Merchant' : 'Category');

	/** Newest first, so the month the reader came for is the first column. */
	const columns = $derived([...comparison.months].reverse());
	const previous = $derived(comparison.months.at(-2));
	/** Nothing moved across a single column, so the change column is not drawn. */
	const showsChange = $derived(comparison.months.length > 1);
	/** The bottom line: every month's whole spending, counted the same way a row is. */
	const footer = $derived(allSpending(comparison));

	const caption = $derived(
		`Spending by ${heading.toLowerCase()}, one column per month.${
			showsChange
				? ` Change is ${formatMonth(comparison.months.at(-1)?.month ?? '')} against ${formatMonth(previous?.month ?? '')}.`
				: ''
		}${isCalendarStart(monthStart) ? '' : ` A month here opens on the ${formatOrdinal(monthStart)}.`}`
	);

	/**
	 * A folded row stands for several labels at once, so there is no list behind
	 * it to open. The table is never given one, but the guard travels with the
	 * handler rather than with the caller.
	 */
	function opens(label: string): boolean {
		return onselect !== undefined && !label.startsWith('Other (');
	}

	const numeric = 'text-right tabular-nums';
	const cellLink = 'cursor-pointer hover:text-series hover:underline';
	/* Both the month headings and the label column have to survive a scroll — a
	   figure in the middle of this table means nothing without either. */
	const columnHead = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
	/* A rule where the frozen column meets the scrolling ones, so a half-scrolled
	   figure beside it reads as scrolled rather than as broken. */
	const rowHead =
		'sticky left-0 z-10 border-r bg-card px-2.5 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground';
	const footCell = 'sticky bottom-0 z-20 border-t border-input bg-card px-2.5 font-semibold';

	/**
	 * What moved, in one cell.
	 *
	 * Neutral ink throughout: on a spending total every figure is positive by
	 * construction, and less spent on a category is not automatically good news —
	 * it can as easily be the month a debit order failed to collect.
	 */
	function change(amount: number, share: number | null): string {
		if (amount === 0) return '—';

		return share === null
			? formatSigned(amount)
			: `${formatSigned(amount)} (${formatPercent(Math.abs(share))})`;
	}
</script>

<div class="max-h-105 overflow-auto">
	<Table.Root class="text-[13px]">
		<Table.Caption class="sr-only">{caption}</Table.Caption>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head scope="col" class={cn(columnHead, 'left-0 z-30 border-r')}>{heading}</Table.Head
				>
				{#each columns as month (month.month)}
					<Table.Head scope="col" class={cn(columnHead, numeric)}>
						{formatMonth(month.month)}{#if month.isPartial}<span
								class="text-faint"
								title="The statement may not cover the whole of this month">*</span
							>{/if}
					</Table.Head>
				{/each}
				{#if showsChange}
					<Table.Head scope="col" class={cn(columnHead, numeric)}>Change</Table.Head>
				{/if}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each comparison.rows as row (row.label)}
				<Table.Row>
					<th scope="row" class={rowHead}>
						{#if opens(row.label)}
							<button
								type="button"
								class={cellLink}
								aria-label="{row.label}, every month compared"
								onclick={() => onselect?.(row.label)}
							>
								{row.label}
							</button>
						{:else}
							{row.label}
						{/if}
					</th>
					{#each columns as month, index (month.month)}
						{@const total = row.totals[comparison.months.length - 1 - index] ?? 0}
						<!-- A zero is written out rather than dashed: the label was spent on
						     in another month, and nothing this month is the comparison. -->
						<Table.Cell class={cn('px-2.5', numeric, total === 0 && 'text-faint')}>
							<!-- A month that took nothing opens nothing: an empty list is not
							     an answer the reader came for. -->
							{#if opens(row.label) && total > 0}
								<button
									type="button"
									class={cellLink}
									onclick={() => onselect?.(row.label, month.month)}
								>
									{formatCurrency(total)}<span class="sr-only">
										— {row.label} in {formatMonth(month.month)}, open the transactions behind it</span
									>
								</button>
							{:else}
								{formatCurrency(total)}
							{/if}
						</Table.Cell>
					{/each}
					{#if showsChange}
						<Table.Cell class={cn('px-2.5', numeric, 'text-muted-foreground')}>
							{change(row.change, row.changeShare)}
						</Table.Cell>
					{/if}
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell
						colspan={columns.length + (showsChange ? 2 : 1)}
						class="py-7 text-center text-faint"
					>
						No spending in the months compared.
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
		{#if comparison.rows.length > 0}
			<Table.Footer class="bg-transparent">
				<Table.Row class="hover:bg-transparent">
					<th
						scope="row"
						class={cn(
							rowHead,
							'bottom-0 left-0 z-30 border-t border-input font-semibold text-foreground'
						)}
					>
						{footer.label}
					</th>
					{#each columns as month (month.month)}
						<Table.Cell class={cn(footCell, numeric)}>{formatCurrency(month.total)}</Table.Cell>
					{/each}
					{#if showsChange}
						<Table.Cell class={cn(footCell, numeric, 'text-muted-foreground')}>
							{change(footer.change, footer.changeShare)}
						</Table.Cell>
					{/if}
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
