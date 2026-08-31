<script lang="ts">
	import {
		linearScale,
		nearestIndex,
		niceDomain,
		niceTicks,
		stepAfterPath,
		type Point
	} from '../charts/scale.ts';
	import {
		formatCurrency,
		formatCurrencyShort,
		formatMonth,
		formatOrdinal,
		useThousands
	} from '../format.ts';
	import { CALENDAR_START, isCalendarStart } from '../stats/cycle.ts';
	import type { MonthMetric, MonthPoint, MonthSeries } from '../types.ts';

	interface Props {
		months: readonly MonthSeries[];
		/** The month drawn in full strength — the one the reader is looking at. */
		focusMonth: string;
		/** Which side of the money the totals add up. Wording follows it. */
		metric?: MonthMetric;
		/** The middle month day by day, drawn as a reference. `null` hides it. */
		typical?: readonly MonthPoint[] | null;
		/** Says what the lines are, in place of the metric's own wording. */
		caption?: string;
		/** What the plot is called, for a reader who cannot see it. */
		label?: string;
		/**
		 * Where the value axis starts.
		 *
		 * A flow total begins at zero and has to show it, or a month that spent
		 * nothing would not read as flat. An absolute level sits wherever the money
		 * is — dragging zero into view alongside a balance in the tens of thousands
		 * flattens the whole plot into a line at the top.
		 */
		baseline?: 'zero' | 'data';
		/**
		 * How the lines are coloured.
		 *
		 * `focus` puts one month forward and lets the rest fall back to a single
		 * pale step — right when the months are interchangeable and only the one
		 * being read matters. `recency` walks an ordinal ramp from oldest to
		 * newest, so a fan of lines reads as a drift over time rather than as a
		 * dozen unrelated subjects.
		 */
		shade?: 'focus' | 'recency';
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const {
		months,
		focusMonth,
		metric = 'net',
		typical = null,
		caption,
		label = 'Running total through the month, one line per month. Switch to the table view for the underlying figures.',
		baseline = 'zero',
		shade = 'focus',
		monthStart = CALENDAR_START
	}: Props = $props();

	/**
	 * Said once, under the plot, when the months do not open on the 1st.
	 *
	 * The axis counts days from wherever a month opens, and every month opens on
	 * the same day — so one sentence fixes the whole axis, where labelling each
	 * tick with a real date could not: day 8 is a different date in every month
	 * laid over the others.
	 */
	const dayNote = $derived(
		isCalendarStart(monthStart) ? '' : `Day 1 is the ${formatOrdinal(monthStart)}.`
	);

	const CAPTIONS: Record<MonthMetric, string> = {
		net: 'Money in less money out, counted from the start of each month and reset at the next.',
		out: 'Everything that left the account, counted from the start of each month and reset at the next.',
		in: 'Everything that came in, counted from the start of each month and reset at the next.'
	};

	const MARGIN = { top: 16, right: 56, bottom: 30, left: 68 };
	const PLOT_HEIGHT = 300;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

	/** How many months the readout names before folding the rest into a count. */
	const READOUT_LIMIT = 12;

	/** Steps in the recency ramp, oldest to newest. */
	const TONES = 5;

	let width = $state(720);
	let hoveredDay = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const lastDay = $derived(Math.max(...months.map((month) => month.points.length), 1));
	const totals = $derived([
		...months.flatMap((month) => month.points.map((point) => point.total)),
		...(typical ?? []).map((point) => point.total)
	]);

	const yDomain = $derived(valueDomain(totals));
	const x = $derived(linearScale([1, Math.max(lastDay, 2)], [0, plotWidth]));
	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
	const inThousands = $derived(useThousands(yTicks));
	/** Fixed day marks rather than nice ticks — a reader knows where the 15th is. */
	const xTicks = $derived([1, 5, 10, 15, 20, 25, lastDay].filter(unique).filter(fits));

	/** Newest first everywhere the reader reads a list of months. */
	const newestFirst = $derived([...months].reverse());

	const lines = $derived(
		months.map((month, index) => {
			const end = month.points.at(-1);
			const isFocus = month.month === focusMonth;

			return {
				month: month.month,
				label: formatMonth(month.month),
				isFocus,
				total: month.total,
				stroke:
					shade === 'recency'
						? toneOf(index)
						: isFocus
							? 'var(--series-1)'
							: 'var(--series-context)',
				path: stepAfterPath(month.points.map(toPixels)),
				end: end === undefined ? null : toPixels(end)
			};
		})
	);

	/** Every line's colour, by month, for the marks and rows that echo it. */
	const strokes = $derived(new Map(lines.map((line) => [line.month, line.stroke])));

	/** The ramp itself, palest first — the legend draws it as a scale. */
	const ramp = $derived(Array.from({ length: TONES }, (_, step) => `var(--recency-${step + 1})`));

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

	function valueDomain(values: readonly number[]): readonly [number, number] {
		if (values.length === 0) return [0, 1];

		const low = Math.min(...values);
		const high = Math.max(...values);

		return baseline === 'zero'
			? niceDomain(Math.min(low, 0), Math.max(high, 0))
			: niceDomain(low, high);
	}

	/**
	 * Spread the ramp across however many months are on screen.
	 *
	 * Past five months some neighbours share a step. That is the honest reading:
	 * the ramp says roughly how old a line is, and two months running are close
	 * to the same age.
	 */
	function toneOf(index: number): string {
		if (months.length <= 1) return `var(--recency-${TONES})`;

		const step = Math.round((index / (months.length - 1)) * (TONES - 1));

		return `var(--recency-${step + 1})`;
	}

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
			<svg {width} height={HEIGHT} role="img" aria-label={label}>
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
						<path
							class="line"
							class:focus={line.isFocus}
							style="--line:{line.stroke}"
							d={line.path}
						/>
					{/each}

					{#if typicalPath !== ''}
						<path class="typical" d={typicalPath} />
					{/if}

					{#each readout as row (row.month)}
						<circle
							class="cursor-dot"
							style="--line:{strokes.get(row.month)}"
							cx={x(row.point.day)}
							cy={y(row.point.total)}
							r={row.isFocus ? 4.5 : 3}
						/>
					{/each}

					{#if focus?.end}
						<circle
							class="end-dot"
							style="--line:{focus.stroke}"
							cx={focus.end.x}
							cy={focus.end.y}
							r="4.5"
						/>
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
							<span
								class="key"
								class:focus={row.isFocus}
								style="--line:{strokes.get(row.month)}"
								aria-hidden="true"
							></span>
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
				{#if shade === 'recency'}
					<!-- The months are the scale, so the ends are named rather than
					     labelled "oldest" and "newest" in the abstract. -->
					<li>
						<span>{lines[0]?.label}</span>
						<span class="ramp" aria-hidden="true">
							{#each ramp as tone (tone)}
								<span class="tone" style="background:{tone}"></span>
							{/each}
						</span>
						<span>{lines.at(-1)?.label}</span>
					</li>
					<li>
						<span class="key focus" style="--line:{focus?.stroke}" aria-hidden="true"
						></span>{focus?.label ?? 'Selected month'}, in front
					</li>
				{:else}
					<li>
						<span class="key focus" style="--line:{focus?.stroke}" aria-hidden="true"
						></span>{focus?.label ?? 'Selected month'}
					</li>
					<li>
						<span class="key" aria-hidden="true"></span>{contextCount}
						other {contextCount === 1 ? 'month' : 'months'}
					</li>
				{/if}
				{#if typical !== null}
					<li><span class="key typical" aria-hidden="true"></span>Typical month</li>
				{/if}
			</ul>
		{/if}

		<figcaption>
			{caption ?? CAPTIONS[metric]}
			{dayNote}
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

	/* Each line carries its own colour in --line: either the pale context step,
	   so the fan reads as context rather than as nine subjects, or a step of the
	   recency ramp. Weight, not hue, still marks the month being read. */
	.line {
		fill: none;
		stroke: var(--line, var(--series-context));
		stroke-width: 1.5;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.line.focus {
		stroke-width: 2.5;
	}

	/* Neutral ink, not a series blue: this line is derived from the others rather
	   than being a month of its own. Dashed for the same reason — it is the one
	   mark on the plot that never happened. */
	.typical {
		fill: none;
		stroke: var(--faint);
		stroke-width: 1.5;
		stroke-dasharray: 5 4;
		stroke-linecap: round;
	}

	.end-dot {
		fill: var(--line, var(--series-1));
		stroke: var(--card);
		stroke-width: 2;
	}

	.cursor-dot {
		fill: var(--line, var(--series-context));
		stroke: var(--card);
		stroke-width: 2;
	}

	.end-label {
		fill: var(--foreground);
		font-size: 12px;
		font-weight: 600;
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
		cursor: crosshair;
	}

	.tooltip {
		position: absolute;
		top: 8px;
		min-width: 180px;
		max-width: 240px;
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
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px !important;
		font-size: 12px;
		color: var(--muted-foreground);
	}

	.tooltip-row.strong {
		color: var(--foreground);
		font-weight: 600;
	}

	.key {
		flex: none;
		width: 10px;
		height: 2px;
		border-radius: 1px;
		background: var(--line, var(--series-context));
	}

	.key.focus {
		height: 3px;
	}

	.key.typical {
		background: repeating-linear-gradient(to right, var(--faint) 0 4px, transparent 4px 7px);
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
		color: var(--foreground);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: var(--muted-foreground);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	/* The ramp is drawn in its steps rather than as a gradient: the lines only
	   ever take one of those five colours, and a smooth bar would promise a
	   precision the marks do not have. */
	.ramp {
		display: flex;
		border-radius: 2px;
		overflow: hidden;
	}

	.tone {
		width: 14px;
		height: 6px;
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
