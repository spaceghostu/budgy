<script lang="ts">
	import { barPath, linearScale, niceDomain, niceTicks } from '../charts/scale.ts';
	import {
		formatCurrency,
		formatCurrencyShort,
		formatDate,
		formatDateShort,
		formatMonth,
		spansYears,
		useThousands
	} from '../format.ts';
	import { CALENDAR_START, cycleOf } from '../stats/cycle.ts';
	import type { DailyFlow } from '../types.ts';

	interface Props {
		days: readonly DailyFlow[];
		/** True when each bar is a month rather than a day. */
		monthly?: boolean;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { days, monthly = false, monthStart = CALENDAR_START }: Props = $props();

	const MARGIN = { top: 16, right: 20, bottom: 30, left: 68 };
	const PLOT_HEIGHT = 220;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;
	const MAX_BAR = 24;
	/** The surface gap that separates touching bars. */
	const GAP = 2;

	let width = $state(720);
	let hovered = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const yDomain = $derived(
		niceDomain(
			Math.min(...days.map((day) => -day.expense), 0),
			Math.max(...days.map((day) => day.income), 0),
			4
		)
	);

	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));
	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 4));
	const zero = $derived(y(0));

	const band = $derived(days.length > 0 ? plotWidth / days.length : plotWidth);
	const barWidth = $derived(Math.max(2, Math.min(MAX_BAR, band - GAP)));

	const bars = $derived(
		days.map((day, index) => {
			const centre = band * (index + 0.5);
			const x = centre - barWidth / 2;

			return {
				day,
				index,
				centre,
				x,
				income: { y: y(day.income), height: Math.max(zero - y(day.income), 0) },
				expense: { y: zero, height: Math.max(y(-day.expense) - zero, 0) }
			};
		})
	);

	const active = $derived(hovered === null ? null : (bars[hovered] ?? null));

	/** A statement can run across a new year, where a bare day and month is ambiguous. */
	const inThousands = $derived(useThousands(yTicks));
	const datedYear = $derived(
		days.length > 0 && spansYears(days[0].timestamp, days[days.length - 1].timestamp)
	);

	/** Show every nth date so ticks never collide. */
	const tickEvery = $derived(
		Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotWidth / 90))))
	);

	/** A bar is a day or a whole month; say which. */
	function label(date: string): string {
		return monthly ? formatMonth(cycleOf(date, monthStart)) : formatDate(date);
	}

	function tooltipLeft(centre: number): string {
		const offset = MARGIN.left + centre;
		return `${Math.max(110, Math.min(width - 110, offset))}px`;
	}
</script>

<figure bind:clientWidth={width}>
	{#if days.length === 0}
		<p class="empty">No transactions in this range.</p>
	{:else}
		<div class="legend">
			<span class="legend-item"><span class="swatch in"></span>Money in</span>
			<span class="legend-item"><span class="swatch out"></span>Money out</span>
		</div>

		<div class="plot-wrap">
			<svg
				{width}
				height={HEIGHT}
				role="img"
				aria-label="Money in and money out per day. Switch to the table view for the underlying figures."
			>
				<g transform="translate({MARGIN.left},{MARGIN.top})">
					{#each yTicks as tick (tick)}
						<line class="grid" x1="0" x2={plotWidth} y1={y(tick)} y2={y(tick)} />
						<text class="tick y" x="-10" y={y(tick)} dy="0.32em">
							{formatCurrencyShort(Math.abs(tick), inThousands)}
						</text>
					{/each}

					{#each bars as bar (bar.day.date)}
						{#if bar.income.height > 0}
							<path
								class="in"
								class:dimmed={hovered !== null && hovered !== bar.index}
								d={barPath(bar.x, bar.income.y, barWidth, bar.income.height, 4, 'top')}
							/>
						{/if}
						{#if bar.expense.height > 0}
							<path
								class="out"
								class:dimmed={hovered !== null && hovered !== bar.index}
								d={barPath(bar.x, bar.expense.y, barWidth, bar.expense.height, 4, 'bottom')}
							/>
						{/if}
					{/each}

					<line class="axis" x1="0" x2={plotWidth} y1={zero} y2={zero} />

					{#each bars as bar (bar.day.date)}
						{#if bar.index % tickEvery === 0}
							<text class="tick x" x={bar.centre} y={PLOT_HEIGHT + 18} text-anchor="middle">
								{monthly
									? formatMonth(cycleOf(bar.day.date, monthStart))
									: formatDateShort(bar.day.timestamp, datedYear)}
							</text>
						{/if}
					{/each}

					{#each bars as bar (bar.day.date)}
						<rect
							class="hit"
							x={bar.centre - band / 2}
							y="0"
							width={band}
							height={PLOT_HEIGHT}
							tabindex="0"
							role="button"
							aria-label="{label(bar.day.date)}: {formatCurrency(
								bar.day.income
							)} in, {formatCurrency(bar.day.expense)} out"
							onpointerenter={() => (hovered = bar.index)}
							onpointerleave={() => (hovered = null)}
							onfocus={() => (hovered = bar.index)}
							onblur={() => (hovered = null)}
						/>
					{/each}
				</g>
			</svg>

			{#if active}
				<div class="tooltip" style:left={tooltipLeft(active.centre)}>
					<p class="tooltip-meta">{label(active.day.date)}</p>
					<p class="tooltip-row">
						<span class="key in" aria-hidden="true"></span>
						<span class="name">In</span>
						<span class="amount">{formatCurrency(active.day.income)}</span>
					</p>
					<p class="tooltip-row">
						<span class="key out" aria-hidden="true"></span>
						<span class="name">Out</span>
						<span class="amount">{formatCurrency(active.day.expense)}</span>
					</p>
					<p class="tooltip-row total">
						<span class="key blank" aria-hidden="true"></span>
						<span class="name">Net</span>
						<span class="amount">{formatCurrency(active.day.net)}</span>
					</p>
				</div>
			{/if}
		</div>

		<figcaption>
			{monthly ? 'One bar per month.' : 'One bar per day.'} Transfers between your own accounts are excluded.
		</figcaption>
	{/if}
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
	}

	.legend {
		display: flex;
		gap: 16px;
		margin-bottom: 12px;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted-foreground);
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}

	.swatch.in,
	.key.in {
		background: var(--diverge-in);
	}

	.swatch.out,
	.key.out {
		background: var(--diverge-out);
	}

	.plot-wrap {
		position: relative;
	}

	svg {
		display: block;
		overflow: visible;
	}

	.grid {
		stroke: var(--grid);
		stroke-width: 1;
	}

	.axis {
		stroke: var(--axis);
		stroke-width: 1;
	}

	.in {
		fill: var(--diverge-in);
	}

	.out {
		fill: var(--diverge-out);
	}

	.dimmed {
		opacity: 0.45;
	}

	.tick {
		fill: var(--faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.tick.y {
		text-anchor: end;
	}

	.hit {
		fill: transparent;
		cursor: pointer;
	}

	.tooltip {
		position: absolute;
		top: 4px;
		transform: translateX(-50%);
		min-width: 180px;
		background: var(--card);
		border: 1px solid var(--input);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(11, 11, 11, 0.12);
		padding: 10px 12px;
		pointer-events: none;
	}

	.tooltip p {
		margin: 0;
	}

	.tooltip-meta {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-bottom: 6px !important;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--muted-foreground);
		padding: 2px 0;
	}

	.tooltip-row.total {
		margin-top: 4px !important;
		padding-top: 6px;
		border-top: 1px solid var(--border);
	}

	.key {
		flex: none;
		width: 10px;
		height: 2px;
		border-radius: 1px;
	}

	.key.blank {
		background: transparent;
	}

	.name {
		flex: 1;
	}

	.amount {
		flex: none;
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}

	figcaption {
		margin-top: 10px;
		font-size: 12px;
		color: var(--faint);
	}

	.empty {
		margin: 0;
		padding: 48px 0;
		text-align: center;
		color: var(--faint);
	}
</style>
