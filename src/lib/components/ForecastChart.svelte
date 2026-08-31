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
		formatCount,
		formatCurrency,
		formatCurrencyShort,
		formatDate,
		formatMonth,
		formatOrdinal,
		useThousands
	} from '../format.ts';
	import { CALENDAR_START, cycleDate, isCalendarStart } from '../stats/cycle.ts';
	import { counted, type ExpectedPayment, type Forecast } from '../stats/forecast.ts';
	import type { MonthMetric, MonthSeries } from '../types.ts';

	interface Props {
		forecast: Forecast;
		/**
		 * The months behind this one, drawn pale for scale. Past months only —
		 * the month being forecast is drawn from {@link forecast} itself, so the
		 * solid line and the figures beside it cannot come apart.
		 */
		months?: readonly MonthSeries[];
		/**
		 * Whether the months behind are drawn at full strength.
		 *
		 * Turned off they fade rather than leave: a dozen of them can crowd the one
		 * line a reader came to read, but taking them away would move the axis
		 * under it and change what the plot says. At a tenth they are still shape
		 * and still scale, just quiet.
		 */
		showMonths?: boolean;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { forecast, months = [], showMonths = true, monthStart = CALENDAR_START }: Props = $props();

	const CAPTIONS: Record<MonthMetric, string> = {
		net: 'Money in less money out, counted from the start of the month.',
		out: 'Everything leaving the account, counted from the start of the month.',
		in: 'Everything coming in, counted from the start of the month.'
	};

	const MARGIN = { top: 16, right: 62, bottom: 34, left: 68 };
	const PLOT_HEIGHT = 300;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

	/** How many past months the readout names before folding the rest into a count. */
	const CONTEXT_LIMIT = 6;

	let width = $state(720);
	let hoveredDay = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const length = $derived(Math.max(forecast.length, 1));
	const values = $derived([
		...forecast.points.flatMap((point) => [point.total, point.low, point.high]),
		...months.flatMap((month) => month.points.map((point) => point.total))
	]);

	const yDomain = $derived(
		values.length === 0
			? ([0, 1] as const)
			: niceDomain(Math.min(...values, 0), Math.max(...values, 0))
	);
	const x = $derived(linearScale([1, Math.max(length, 2)], [0, plotWidth]));
	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
	const inThousands = $derived(useThousands(yTicks));
	const xTicks = $derived(
		[1, 5, 10, 15, 20, 25, length].filter(
			(day, index, all) => all.indexOf(day) === index && day <= length
		)
	);

	/** The days already banked, and the days still to come. */
	const banked = $derived(forecast.points.filter((point) => !point.isProjected));
	/**
	 * The projection, starting at the last banked day so the two halves of the
	 * line meet rather than leaving a gap where the certainty runs out.
	 */
	const ahead = $derived(forecast.points.slice(Math.max(forecast.elapsedDays - 1, 0)));

	const bankedPath = $derived(stepAfterPath(banked.map(toPixels)));
	const aheadPath = $derived(ahead.length > 1 ? stepAfterPath(ahead.map(toPixels)) : '');
	const bandPath = $derived(toBandPath(ahead));

	const end = $derived(forecast.points.at(-1));
	const today = $derived(banked.at(-1));

	/** The pale lines behind, newest first wherever they are read as a list. */
	const contextLines = $derived(
		months.map((month) => ({
			month: month.month,
			label: formatMonth(month.month),
			path: stepAfterPath(month.points.map(toPixels)),
			points: month.points
		}))
	);
	const newestFirst = $derived([...contextLines].reverse());

	const dayNote = $derived(
		isCalendarStart(monthStart) ? '' : ` Day 1 is the ${formatOrdinal(monthStart)}.`
	);

	/** The legend's own line about the months behind, faded or not. */
	const monthsNote = $derived(
		`${formatCount(months.length, 'past month')}${showMonths ? '' : ', faded'}`
	);

	/** What the dashed half of the line is, said in one sentence under it. */
	const note = $derived.by(() => {
		if (forecast.isComplete) return 'The month is over, so nothing is projected.';
		if (forecast.monthsOfHistory === 0) {
			return 'There is no complete month behind this one yet, so the line simply holds where the statement stops.';
		}

		return `The dashed line is arithmetic, not a promise: named payments on the days they usually land, and the rest of the month’s usual cost spread evenly over the days left, learned from ${formatCount(forecast.monthsOfHistory, 'complete month')}.`;
	});

	const cursor = $derived(hoveredDay === null ? null : forecast.points[hoveredDay - 1]);
	/**
	 * Only the charges the projection counts are drawn. One the reader has ticked
	 * off is still on the list beside the plot, saying what the history says
	 * about it — but a mark on a line that does not include it would be a
	 * contradiction rather than a reminder.
	 */
	const due = $derived(counted(forecast.expected));
	const dueOnCursor = $derived(
		hoveredDay === null ? [] : due.filter((payment) => payment.day === hoveredDay)
	);
	const contextOnCursor = $derived.by(() => {
		const day = hoveredDay;
		if (day === null) return [];

		return newestFirst.flatMap((line) => {
			const point = line.points[day - 1];
			return point === undefined ? [] : [{ ...line, total: point.total }];
		});
	});
	const hiddenContext = $derived(Math.max(contextOnCursor.length - CONTEXT_LIMIT, 0));

	/** Where the day's marker sits, for the ticks under the axis. */
	const dueDays = $derived([...new Set(due.map((payment) => payment.day))]);

	function toPixels(point: { day: number; total: number }): Point {
		return { x: x(point.day), y: y(point.total) };
	}

	/**
	 * The band as one closed shape: out along the heavy line, back along the lean
	 * one. Straight segments rather than steps — this is a region the month may
	 * land in, not a total that moved on a particular day.
	 */
	function toBandPath(points: readonly { day: number; low: number; high: number }[]): string {
		if (points.length < 2) return '';
		if (points.every((point) => point.high === point.low)) return '';

		const out = points.map((point) => `${x(point.day)},${y(point.high)}`);
		const back = [...points].reverse().map((point) => `${x(point.day)},${y(point.low)}`);

		return `M${[...out, ...back].join('L')}Z`;
	}

	function dateOf(day: number): string {
		return forecast.month === '' ? '' : formatDate(cycleDate(forecast.month, monthStart, day));
	}

	function paymentLabel(payment: ExpectedPayment): string {
		return payment.flow === 'income'
			? `${payment.merchant} +${formatCurrency(payment.amount)}`
			: `${payment.merchant} ${formatCurrency(payment.amount)}`;
	}

	function trackPointer(event: PointerEvent): void {
		const plot = event.currentTarget as SVGRectElement;
		const box = plot.getBoundingClientRect();
		const days = Array.from({ length }, (_, index) => ({ x: x(index + 1), y: 0 }));

		hoveredDay = nearestIndex(days, event.clientX - box.left) + 1;
	}

	function moveCursor(event: KeyboardEvent): void {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		const jump = { Home: 1, End: length }[event.key];

		if (step !== undefined) {
			event.preventDefault();
			hoveredDay = Math.max(1, Math.min(length, (hoveredDay ?? length) + step));
		} else if (jump !== undefined) {
			event.preventDefault();
			hoveredDay = jump;
		} else if (event.key === 'Escape') {
			hoveredDay = null;
		}
	}

	function describeDay(day: number): string {
		const point = forecast.points[day - 1];
		if (point === undefined) return `Day ${day}`;

		const heading = point.isProjected ? 'Projected' : 'Banked';
		const expected = due
			.filter((payment) => payment.day === day)
			.map((payment) => `${paymentLabel(payment)} expected`);

		return [
			`Day ${day}, ${dateOf(day)}`,
			`${heading} ${formatCurrency(point.total)}`,
			...expected
		].join('. ');
	}

	/** Park the readout on the emptier side of the crosshair. */
	function tooltipStyle(pointX: number): string {
		const offset = MARGIN.left + pointX;
		const gap = 16;

		return pointX > plotWidth / 2 ? `right:${width - offset + gap}px` : `left:${offset + gap}px`;
	}
</script>

<figure bind:clientWidth={width}>
	{#if forecast.points.length === 0}
		<p class="empty">No transactions to forecast.</p>
	{:else}
		<div class="plot-wrap">
			<svg
				{width}
				height={HEIGHT}
				role="img"
				aria-label="This month's running total, with the rest of the month projected from past months. Switch to the table view for the underlying figures."
			>
				<g transform="translate({MARGIN.left},{MARGIN.top})">
					{#each yTicks as tick (tick)}
						<line class="grid" x1="0" x2={plotWidth} y1={y(tick)} y2={y(tick)} />
						<text class="tick y" x="-10" y={y(tick)} dy="0.32em">
							{formatCurrencyShort(tick, inThousands)}
						</text>
					{/each}

					{#if yDomain[0] < 0 && yDomain[1] > 0}
						<line class="zero" x1="0" x2={plotWidth} y1={y(0)} y2={y(0)} />
					{/if}

					{#if bandPath !== ''}
						<path class="band" d={bandPath} />
					{/if}

					{#each contextLines as line (line.month)}
						<path class="context" class:faded={!showMonths} d={line.path} />
					{/each}

					{#if hoveredDay !== null}
						<line class="crosshair" x1={x(hoveredDay)} x2={x(hoveredDay)} y1="0" y2={PLOT_HEIGHT} />
					{/if}

					<!-- Where the statement stops and the arithmetic starts. -->
					{#if today && !forecast.isComplete}
						<line class="border" x1={x(today.day)} x2={x(today.day)} y1="0" y2={PLOT_HEIGHT} />
					{/if}

					{#if aheadPath !== ''}
						<path class="ahead" d={aheadPath} />
					{/if}
					{#if bankedPath !== ''}
						<path class="banked" d={bankedPath} />
					{/if}

					{#each due as payment (payment.key)}
						{@const point = forecast.points[payment.day - 1]}
						{#if point}
							<circle class="due-dot" cx={x(payment.day)} cy={y(point.total)} r="3.5" />
						{/if}
					{/each}

					{#if today}
						<circle class="today-dot" cx={x(today.day)} cy={y(today.total)} r="4.5" />
					{/if}

					{#if end}
						<text
							class="end-label"
							x={Math.min(x(end.day) + 8, plotWidth + MARGIN.right - 8)}
							y={y(end.total)}
							dy="0.32em"
						>
							{formatCurrencyShort(end.total, inThousands)}
						</text>
					{/if}

					<line class="axis" x1="0" x2={plotWidth} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT} />

					<!-- A mark under the axis on each day a payment is expected, so the
					     days that are already spoken for read off the chart itself. -->
					{#each dueDays as day (day)}
						<path
							class="due-tick"
							d="M{x(day) - 4},{PLOT_HEIGHT + 5}L{x(day) + 4},{PLOT_HEIGHT + 5}L{x(
								day
							)},{PLOT_HEIGHT}Z"
						/>
					{/each}

					{#each xTicks as tick, index (tick)}
						<text
							class="tick x"
							x={x(tick)}
							y={PLOT_HEIGHT + 22}
							text-anchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
						>
							{tick}
						</text>
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
						aria-valuemax={length}
						aria-valuenow={hoveredDay ?? forecast.elapsedDays}
						aria-valuetext={hoveredDay === null
							? 'Use the arrow keys to step through the days of the month'
							: describeDay(hoveredDay)}
						onpointermove={trackPointer}
						onpointerleave={() => (hoveredDay = null)}
						onkeydown={moveCursor}
						onfocus={() => (hoveredDay ??= Math.max(forecast.elapsedDays, 1))}
						onblur={() => (hoveredDay = null)}
					/>
				</g>
			</svg>

			{#if hoveredDay !== null && cursor}
				<div class="tooltip" style={tooltipStyle(x(hoveredDay))}>
					<p class="tooltip-meta">Day {hoveredDay} · {dateOf(hoveredDay)}</p>
					<p class="tooltip-row strong">
						<span class="key" class:dashed={cursor.isProjected} aria-hidden="true"></span>
						<span class="desc">{cursor.isProjected ? 'Projected' : 'This month'}</span>
						<span class="amount">{formatCurrency(cursor.total)}</span>
					</p>
					{#if cursor.isProjected && cursor.high !== cursor.low}
						<p class="tooltip-meta">
							{formatCurrency(cursor.low)} – {formatCurrency(cursor.high)} on the leanest and heaviest
							months
						</p>
					{/if}
					{#each dueOnCursor as payment (payment.merchant)}
						<p class="tooltip-row due">
							<span class="key due" aria-hidden="true"></span>
							<span class="desc">{payment.merchant}</span>
							<span class="amount">
								{payment.flow === 'income' ? '+' : ''}{formatCurrency(payment.amount)}
							</span>
						</p>
					{/each}
					{#each contextOnCursor.slice(0, CONTEXT_LIMIT) as line (line.month)}
						<p class="tooltip-row">
							<span class="key context" aria-hidden="true"></span>
							<span class="desc">{line.label}</span>
							<span class="amount">{formatCurrency(line.total)}</span>
						</p>
					{/each}
					{#if hiddenContext > 0}
						<p class="tooltip-meta">
							…and {hiddenContext} earlier {hiddenContext === 1 ? 'month' : 'months'}
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<ul class="legend">
			<li><span class="key" aria-hidden="true"></span>{formatMonth(forecast.month)} so far</li>
			{#if !forecast.isComplete}
				<li><span class="key dashed" aria-hidden="true"></span>Projected</li>
			{/if}
			{#if due.length > 0}
				<li><span class="key due" aria-hidden="true"></span>Expected payment</li>
			{/if}
			{#if months.length > 0}
				<li class:faded={!showMonths}>
					<span class="key context" aria-hidden="true"></span>{monthsNote}
				</li>
			{/if}
		</ul>

		<figcaption>{CAPTIONS[forecast.metric]}{dayNote} {note}</figcaption>
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

	/* The edge of what is known, drawn quietly: it is a fact about the statement
	   rather than a value on the plot. */
	.border {
		stroke: var(--axis);
		stroke-width: 1;
		stroke-dasharray: 2 3;
	}

	/* The months behind, in one pale step: they are scale for the line in front,
	   not subjects of their own. */
	.context {
		fill: none;
		stroke: var(--series-context);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}

	/* Faded, not removed: the axis is still drawn to hold them, and a reader who
	   turns them down has not asked the plot to mean something else. */
	.faded {
		opacity: 0.1;
	}

	.legend li.faded {
		opacity: 0.55;
	}

	.banked {
		fill: none;
		stroke: var(--series-1);
		stroke-width: 2.5;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	/* Dashed for the same reason the typical month is: this half of the line
	   never happened. */
	.ahead {
		fill: none;
		stroke: var(--series-1);
		stroke-width: 2;
		stroke-dasharray: 5 4;
		stroke-linecap: round;
	}

	/* How far off the projection could be if the rest of the month runs like the
	   leanest or the heaviest month behind it. */
	.band {
		fill: var(--series-1);
		opacity: 0.1;
	}

	.today-dot {
		fill: var(--series-1);
		stroke: var(--card);
		stroke-width: 2;
	}

	.due-dot {
		fill: var(--card);
		stroke: var(--series-1);
		stroke-width: 2;
	}

	.due-tick {
		fill: var(--series-1);
		opacity: 0.55;
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
		min-width: 190px;
		max-width: 250px;
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

	.tooltip-row.due {
		color: var(--foreground);
	}

	.key {
		flex: none;
		width: 10px;
		height: 3px;
		border-radius: 1px;
		background: var(--series-1);
	}

	.key.context {
		height: 2px;
		background: var(--series-context);
	}

	.key.dashed {
		background: repeating-linear-gradient(to right, var(--series-1) 0 4px, transparent 4px 7px);
	}

	.key.due {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--card);
		border: 2px solid var(--series-1);
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
