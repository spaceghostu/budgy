<script lang="ts">
	import {
		linearScale,
		nearestIndex,
		niceDomain,
		niceTicks,
		stepAfterPath,
		type Point
	} from '../charts/scale.ts';
	import { formatCurrency, formatCurrencyShort, formatMonth, useThousands } from '../format.ts';
	import type { MonthMetric, MonthPoint, MonthSeries } from '../types.ts';

	interface Props {
		months: readonly MonthSeries[];
		/** The month drawn in full strength — the one the reader is looking at. */
		focusMonth: string;
		/** Which side of the money the totals add up. Wording follows it. */
		metric?: MonthMetric;
		/** The middle month day by day, drawn as a reference. `null` hides it. */
		typical?: readonly MonthPoint[] | null;
	}

	const { months, focusMonth, metric = 'net', typical = null }: Props = $props();

	const CAPTIONS: Record<MonthMetric, string> = {
		net: 'Money in less money out, counted from the first of each month and reset at the next.',
		out: 'Everything that left the account, counted from the first of each month and reset at the next.',
		in: 'Everything that came in, counted from the first of each month and reset at the next.'
	};

	const MARGIN = { top: 16, right: 56, bottom: 30, left: 68 };
	const PLOT_HEIGHT = 300;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

	/** How many months the readout names before folding the rest into a count. */
	const READOUT_LIMIT = 12;

	let width = $state(720);
	let hoveredDay = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const lastDay = $derived(Math.max(...months.map((month) => month.points.length), 1));
	const totals = $derived([
		...months.flatMap((month) => month.points.map((point) => point.total)),
		...(typical ?? []).map((point) => point.total)
	]);

	const yDomain = $derived(niceDomain(Math.min(...totals, 0), Math.max(...totals, 0)));
	const x = $derived(linearScale([1, Math.max(lastDay, 2)], [0, plotWidth]));
	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
	const inThousands = $derived(useThousands(yTicks));
	/** Fixed day marks rather than nice ticks — a reader knows where the 15th is. */
	const xTicks = $derived([1, 5, 10, 15, 20, 25, lastDay].filter(unique).filter(fits));

	/** Newest first everywhere the reader reads a list of months. */
	const newestFirst = $derived([...months].reverse());

	const lines = $derived(
		months.map((month) => {
			const end = month.points.at(-1);

			return {
				month: month.month,
				label: formatMonth(month.month),
				isFocus: month.month === focusMonth,
				total: month.total,
				path: stepAfterPath(month.points.map(toPixels)),
				end: end === undefined ? null : toPixels(end)
			};
		})
	);

	/** The focused month is drawn last, so it sits above the context lines. */
	const ordered = $derived([...lines].sort((a, b) => Number(a.isFocus) - Number(b.isFocus)));
	const focus = $derived(lines.find((line) => line.isFocus) ?? null);
	const focusSeries = $derived(months.find((month) => month.month === focusMonth) ?? null);
	/**
	 * A short line means one of two different things, and they read differently:
	 * the newest month has not finished, while the oldest may have started before
	 * the statement did.
	 */
	const focusIsNewest = $derived(focusMonth === months.at(-1)?.month);
	const contextCount = $derived(lines.filter((line) => !line.isFocus).length);
	/** Flip the end label inwards when the line finishes against the right edge. */
	const labelBeforeEnd = $derived((focus?.end?.x ?? 0) > plotWidth - MARGIN.right);

	const typicalPath = $derived(typical === null ? '' : stepAfterPath(typical.map(toPixels)));

	const readout = $derived(hoveredDay === null ? [] : rowsOn(hoveredDay));
	const hiddenRows = $derived(Math.max(readout.length - READOUT_LIMIT, 0));
	const typicalOn = $derived(
		hoveredDay === null || typical === null ? undefined : typical[hoveredDay - 1]
	);

	function toPixels(point: { day: number; total: number }): Point {
		return { x: x(point.day), y: y(point.total) };
	}

	function unique(value: number, index: number, all: readonly number[]): boolean {
		return all.indexOf(value) === index;
	}

	function fits(day: number): boolean {
		return day <= lastDay;
	}

	/** Every month that had reached `day`, with the total it stood at. */
	function rowsOn(day: number) {
		return newestFirst.flatMap((month) => {
			const point = month.points[day - 1];
			if (point === undefined || point.day !== day) return [];

			return [
				{
					month: month.month,
					label: formatMonth(month.month),
					isFocus: month.month === focusMonth,
					point
				}
			];
		});
	}

	function trackPointer(event: PointerEvent): void {
		const plot = event.currentTarget as SVGRectElement;
		const box = plot.getBoundingClientRect();
		const days = Array.from({ length: lastDay }, (_, index) => ({ x: x(index + 1), y: 0 }));

		hoveredDay = nearestIndex(days, event.clientX - box.left) + 1;
	}

	function moveCursor(event: KeyboardEvent): void {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		const jump = { Home: 1, End: lastDay }[event.key];

		if (step !== undefined) {
			event.preventDefault();
			hoveredDay = Math.max(1, Math.min(lastDay, (hoveredDay ?? lastDay) + step));
		} else if (jump !== undefined) {
			event.preventDefault();
			hoveredDay = jump;
		} else if (event.key === 'Escape') {
			hoveredDay = null;
		}
	}

	function describeDay(day: number): string {
		const named = rowsOn(day)
			.slice(0, READOUT_LIMIT)
			.map((row) => `${row.label} ${formatCurrency(row.point.total)}`);

		return `Day ${day}. ${named.join('. ')}`;
	}

	/**
	 * Park the readout on the far side of the crosshair from the pointer.
	 *
	 * A readout naming a dozen months is tall enough to sit over the very dots it
	 * is describing if it is centred on the crosshair the way a three-line one can
	 * be. Putting it on the emptier side keeps the marks in view.
	 */
	function tooltipStyle(pointX: number): string {
		const offset = MARGIN.left + pointX;
		const gap = 16;

		return pointX > plotWidth / 2 ? `right:${width - offset + gap}px` : `left:${offset + gap}px`;
	}
</script>

<figure bind:clientWidth={width}>
	{#if months.length === 0}
		<p class="empty">No transactions to compare.</p>
	{:else}
		<div class="plot-wrap">
			<svg
				{width}
				height={HEIGHT}
				role="img"
				aria-label="Running total through the month, one line per month. Switch to the table view for the underlying figures."
			>
				<g transform="translate({MARGIN.left},{MARGIN.top})">
					{#each yTicks as tick (tick)}
						<line class="grid" x1="0" x2={plotWidth} y1={y(tick)} y2={y(tick)} />
						<text class="tick y" x="-10" y={y(tick)} dy="0.32em"
							>{formatCurrencyShort(tick, inThousands)}</text
						>
					{/each}

					{#if yDomain[0] < 0 && yDomain[1] > 0}
						<line class="zero" x1="0" x2={plotWidth} y1={y(0)} y2={y(0)} />
					{/if}

					{#if hoveredDay !== null}
						<line class="crosshair" x1={x(hoveredDay)} x2={x(hoveredDay)} y1="0" y2={PLOT_HEIGHT} />
					{/if}

					{#each ordered as line (line.month)}
						<path class="line" class:focus={line.isFocus} d={line.path} />
					{/each}

					{#if typicalPath !== ''}
						<path class="typical" d={typicalPath} />
					{/if}

					{#each readout as row (row.month)}
						<circle
							class="cursor-dot"
							class:focus={row.isFocus}
							cx={x(row.point.day)}
							cy={y(row.point.total)}
							r={row.isFocus ? 4.5 : 3}
						/>
					{/each}

					{#if focus?.end}
						<circle class="end-dot" cx={focus.end.x} cy={focus.end.y} r="4.5" />
						<!-- Beside the line's end rather than pinned right: a month the
						     statement stops part-way into ends mid-plot. -->
						<text
							class="end-label"
							x={focus.end.x + (labelBeforeEnd ? -8 : 8)}
							y={focus.end.y}
							dy="0.32em"
							text-anchor={labelBeforeEnd ? 'end' : 'start'}
							>{formatCurrencyShort(focus.total, inThousands)}</text
						>
					{/if}

					<line class="axis" x1="0" x2={plotWidth} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT} />

					{#each xTicks as tick, index (tick)}
						<text
							class="tick x"
							x={x(tick)}
							y={PLOT_HEIGHT + 18}
							text-anchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
							>{tick}</text
						>
					{/each}

					<rect
						class="hit"
						x="0"
						y="0"
						width={plotWidth}
						height={PLOT_HEIGHT}
						tabindex="0"
						role="slider"
						aria-label="Day of the month"
						aria-valuemin={1}
						aria-valuemax={lastDay}
						aria-valuenow={hoveredDay ?? lastDay}
						aria-valuetext={hoveredDay === null
							? 'Use the arrow keys to step through the days of the month'
							: describeDay(hoveredDay)}
						onpointermove={trackPointer}
						onpointerleave={() => (hoveredDay = null)}
						onkeydown={moveCursor}
						onfocus={() => (hoveredDay ??= lastDay)}
						onblur={() => (hoveredDay = null)}
					/>
				</g>
			</svg>

			{#if hoveredDay !== null && readout.length > 0}
				<div class="tooltip" style={tooltipStyle(x(hoveredDay))}>
					<p class="tooltip-meta">Day {hoveredDay}</p>
					{#each readout.slice(0, READOUT_LIMIT) as row (row.month)}
						<p class="tooltip-row" class:strong={row.isFocus}>
							<span class="key" class:focus={row.isFocus} aria-hidden="true"></span>
							<span class="desc">{row.label}</span>
							<span class="amount">{formatCurrency(row.point.total)}</span>
						</p>
					{/each}
					{#if hiddenRows > 0}
						<p class="tooltip-meta">
							…and {hiddenRows} earlier {hiddenRows === 1 ? 'month' : 'months'}
						</p>
					{/if}
					{#if typicalOn}
						<p class="tooltip-row typical-row">
							<span class="key typical" aria-hidden="true"></span>
							<span class="desc">Typical</span>
							<span class="amount">{formatCurrency(typicalOn.total)}</span>
						</p>
					{/if}
				</div>
			{/if}
		</div>

		{#if months.length > 1}
			<ul class="legend">
				<li>
					<span class="key focus" aria-hidden="true"></span>{focus?.label ?? 'Selected month'}
				</li>
				<li>
					<span class="key" aria-hidden="true"></span>{contextCount}
					other {contextCount === 1 ? 'month' : 'months'}
				</li>
				{#if typical !== null}
					<li><span class="key typical" aria-hidden="true"></span>Typical month</li>
				{/if}
			</ul>
		{/if}

		<figcaption>
			{CAPTIONS[metric]}
			{#if months.length === 1}
				Only one month so far — there is nothing to compare it against yet.
			{:else if focusSeries?.isPartial && focusIsNewest}
				{focus?.label} stops where the statement does.
			{:else if focusSeries?.isPartial}
				{focus?.label} is where the statement starts, so its first days may be missing.
			{/if}
		</figcaption>
	{/if}
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
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

	.zero,
	.axis,
	.crosshair {
		stroke: var(--axis);
		stroke-width: 1;
	}

	/* Every month that is not the one being read recedes to the pale step of the
	   same blue ramp, so the fan reads as context rather than as nine subjects. */
	.line {
		fill: none;
		stroke: var(--series-context);
		stroke-width: 1.5;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.line.focus {
		stroke: var(--series-1);
		stroke-width: 2.5;
	}

	/* Neutral ink, not a series blue: this line is derived from the others rather
	   than being a month of its own. Dashed for the same reason — it is the one
	   mark on the plot that never happened. */
	.typical {
		fill: none;
		stroke: var(--text-muted);
		stroke-width: 1.5;
		stroke-dasharray: 5 4;
		stroke-linecap: round;
	}

	.end-dot {
		fill: var(--series-1);
		stroke: var(--surface-1);
		stroke-width: 2;
	}

	.cursor-dot {
		fill: var(--series-context);
		stroke: var(--surface-1);
		stroke-width: 2;
	}

	.cursor-dot.focus {
		fill: var(--series-1);
	}

	.end-label {
		fill: var(--text-primary);
		font-size: 12px;
		font-weight: 600;
	}

	.tick {
		fill: var(--text-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.tick.y {
		text-anchor: end;
	}

	.hit {
		fill: transparent;
		cursor: crosshair;
	}

	.tooltip {
		position: absolute;
		top: 8px;
		min-width: 180px;
		max-width: 240px;
		background: var(--surface-1);
		border: 1px solid var(--border-strong);
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
		color: var(--text-secondary);
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px !important;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.tooltip-row.strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	.key {
		flex: none;
		width: 10px;
		height: 2px;
		border-radius: 1px;
		background: var(--series-context);
	}

	.key.focus {
		height: 3px;
		background: var(--series-1);
	}

	.key.typical {
		background: repeating-linear-gradient(to right, var(--text-muted) 0 4px, transparent 4px 7px);
	}

	.typical-row {
		border-top: 1px solid var(--border);
		margin-top: 6px !important;
		padding-top: 6px;
	}

	.desc {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.amount {
		flex: none;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: var(--text-secondary);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	figcaption {
		margin-top: 10px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.empty {
		margin: 0;
		padding: 48px 0;
		text-align: center;
		color: var(--text-muted);
	}
</style>
