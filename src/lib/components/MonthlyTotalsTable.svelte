<script lang="ts">
	import { formatCurrency, formatMonth } from '../format.ts';
	import type { MonthMetric, MonthPoint, MonthSeries } from '../types.ts';

	interface Props {
		months: readonly MonthSeries[];
		/** The middle month day by day. `null` when the chart is not showing it. */
		typical?: readonly MonthPoint[] | null;
		/** Which side of the money the totals add up. */
		metric?: MonthMetric;
	}

	const { months, typical = null, metric = 'net' }: Props = $props();

	/**
	 * Only a net total can be good news. On a money-out total every figure is
	 * positive by construction, and painting them green would say a heavy month
	 * of spending went well.
	 */
	const signed = $derived(metric === 'net');

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
</script>

<div class="scroll">
	<table>
		<caption class="sr-only"> Running total through each month, by day of the month. </caption>
		<thead>
			<tr>
				<th scope="col">Day</th>
				{#if typical}<th scope="col" class="numeric typical">Typical</th>{/if}
				{#each columns as month (month.month)}
					<th scope="col" class="numeric">
						{formatMonth(month.month)}{#if month.isPartial}<span
								class="partial"
								title="The statement may not cover the whole of this month">*</span
							>{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each days as day (day)}
				<tr>
					<th scope="row">{day}</th>
					{#if typical}
						<td class="numeric typical">{totalOn(typical, day)}</td>
					{/if}
					{#each columns as month (month.month)}
						<td class="numeric">{totalOn(month.points, day)}</td>
					{/each}
				</tr>
			{:else}
				<tr
					><td class="empty" colspan={columns.length + (typical ? 2 : 1)}
						>No transactions to compare.</td
					></tr
				>
			{/each}
		</tbody>
		{#if columns.length > 0}
			<tfoot>
				<tr>
					<th scope="row">Month</th>
					{#if typical}
						<td class="numeric typical">{formatCurrency(typical.at(-1)?.total ?? 0)}</td>
					{/if}
					{#each columns as month (month.month)}
						<td class="numeric" class:credit={signed && month.total > 0}
							>{formatCurrency(month.total)}</td
						>
					{/each}
				</tr>
			</tfoot>
		{/if}
	</table>
</div>

{#if columns.some((month) => month.isPartial)}
	<!-- "May", deliberately: a first month with nothing on the 1st is
	     indistinguishable from a statement that opened on the 2nd. -->
	<p class="note">* The statement may not cover the whole of this month.</p>
{/if}

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

	/* The month headings and the day column both have to survive a scroll — a
	   figure in the middle of this table means nothing without either. */
	thead th {
		position: sticky;
		top: 0;
		background: var(--surface-1);
		z-index: 1;
	}

	tbody th {
		position: sticky;
		left: 0;
		background: var(--surface-1);
		z-index: 1;
	}

	thead th:first-child {
		left: 0;
		z-index: 3;
	}

	/* A rule where the frozen column meets the scrolling ones, so a half-scrolled
	   figure beside it reads as scrolled rather than as broken. */
	tbody th,
	thead th:first-child,
	tfoot th {
		border-right: 1px solid var(--border);
	}

	th {
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--text-secondary);
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	thead th {
		padding: 0 10px 8px;
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

	tfoot th,
	tfoot td {
		position: sticky;
		bottom: 0;
		background: var(--surface-1);
		border-top: 1px solid var(--border-strong);
		border-bottom: 0;
		font-weight: 600;
		color: var(--text-primary);
		z-index: 2;
	}

	tfoot th {
		left: 0;
		z-index: 3;
	}

	.credit {
		color: var(--status-good-text);
	}

	.partial {
		color: var(--text-muted);
	}

	/* A derived reference rather than a month, so it sits in muted ink behind a
	   rule, the way the frozen day column does. */
	.typical {
		color: var(--text-secondary);
		border-right: 1px solid var(--border);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 28px 0;
	}

	.note {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
