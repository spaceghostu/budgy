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
		formatDateShort,
		useThousands
	} from '../format.ts';
	import { CALENDAR_START, isCalendarStart } from '../stats/cycle.ts';
	import type { ExpectedPayment } from '../stats/forecast.ts';
	import type { Runway, RunwayDay } from '../stats/runway.ts';

	interface Props {
		runway: Runway;
		/**
		 * True while the balance is a shape rather than real money — no printed
		 * balances and no anchor entered. The line is identical either way; only
		 * what it can honestly be called changes.
		 */
		isRelative?: boolean;
		/** Day of the month the reader's months open on — the day they are paid. */
		monthStart?: number;
	}

	const { runway, isRelative = false, monthStart = CALENDAR_START }: Props = $props();

	const MARGIN = { top: 20, right: 74, bottom: 46, left: 68 };
	const PLOT_HEIGHT = 300;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

	/** Charges named on the plot itself. Past a handful the labels collide. */
	const LABEL_LIMIT = 4;
	/** Pixels two labels have to be apart to both be drawn. */
	const LABEL_GAP = 54;

	let width = $state(720);
	let hovered = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const days = $derived(runway.days);
	const first = $derived(days[0]);
	const last = $derived(days.at(-1));

	/**
	 * Zero is always in the domain, whichever side the balance sits.
	 *
	 * The whole point of the line is whether it reaches the bottom, and an axis
	 * that started at the lowest balance would hide the bottom off the chart.
	 */
	const yDomain = $derived.by(() => {
		const values = days.flatMap((day) => [day.balance, day.low, day.high]);
		if (values.length === 0) return [0, 1] as const;

		return niceDomain(Math.min(...values, 0), Math.max(...values, 0));
	});

	/** A single day still needs a width to be drawn in. */
	const xDomain = $derived([first?.day ?? 1, Math.max(last?.day ?? 1, (first?.day ?? 1) + 1)] as [
		number,
		number
	]);

	const x = $derived(linearScale(xDomain, [0, plotWidth]));
	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
	const inThousands = $derived(useThousands(yTicks));

	/**
	 * Roughly one label per 90px, always including the first day and payday's
	 * eve — the two ends are the sentence the chart is making.
	 */
	const xTicks = $derived.by(() => {
		if (days.length === 0) return [];

		const wanted = Math.max(Math.min(Math.floor(plotWidth / 90), days.length), 2);
		const step = Math.max(Math.round((days.length - 1) / (wanted - 1)), 1);
		const end = days[days.length - 1].day;

		const between: number[] = [];
		for (let index = step; index < days.length - 1; index += step) between.push(days[index].day);

		// The last of those can land on top of the end tick when the step does
		// not divide evenly; the end is the one that has to survive.
		return [days[0].day, ...between.filter((day) => end - day > step / 2), end].filter(
			(day, index, all) => all.indexOf(day) === index
		);
	});

	/** December to January: a bare day and month would name two different dates. */
	const crossesYear = $derived(
		first !== undefined && last !== undefined && first.date.slice(0, 4) !== last.date.slice(0, 4)
	);

	const linePath = $derived(stepAfterPath(days.map(toPixels)));
	const bandPath = $derived(toBandPath(days));

	/** Every counted charge that has a day on the plot to sit on. */
	const marks = $derived(days.flatMap((day) => day.payments.map((payment) => ({ day, payment }))));

	/**
	 * The few charges named on the line itself.
	 *
	 * Biggest first, then anything that would overlap a label already placed is
	 * left to the tooltip: a chart with five labels stacked on the 25th says
	 * less than one with two it can actually be read.
	 */
	const labelled = $derived.by(() => {
		const placed: { day: RunwayDay; payment: ExpectedPayment; at: number }[] = [];

		for (const mark of [...marks].sort((a, b) => b.payment.amount - a.payment.amount)) {
			if (placed.length >= LABEL_LIMIT) break;

			const at = x(mark.day.day);
			if (placed.some((other) => Math.abs(other.at - at) < LABEL_GAP)) continue;

			placed.push({ ...mark, at });
		}

		return placed.sort((a, b) => a.at - b.at);
	});

	const cursor = $derived(hovered === null ? null : (days[hovered] ?? null));

	const dayNote = $derived(
		isCalendarStart(monthStart)
			? 'Payday is taken as the 1st — set the day your month opens on above to move it.'
			: ''
	);

	/** What the line is, in one sentence under it. */
	const note = $derived.by(() => {
		if (runway.isComplete) {
			return 'The month is over — payday has arrived, so there is nothing left to project.';
		}
		if (runway.monthsOfHistory === 0) {
			return 'There is no complete month behind this one yet, so only the named charges move the line.';
		}

		return `The line is arithmetic, not a promise: today’s balance, less the charges below on the days they usually land, less what the rest of a month usually costs spread over the days left — learned from ${formatCount(runway.monthsOfHistory, 'complete month')}.`;
	});

	function toPixels(day: RunwayDay): Point {
		return { x: x(day.day), y: y(day.balance) };
	}

	/** A cycle day back to the timestamp the axis formatter wants. */
	function dateAt(day: number): number {
		const found = days.find((point) => point.day === day);

		return found === undefined ? 0 : new Date(`${found.date}T00:00:00`).getTime();
	}

	/**
	 * The band as one closed shape: out along the high edge, back along the low
	 * one. Straight segments rather than steps — this is a region the balance
	 * may land in, not a figure that moved on a particular day.
	 */
	function toBandPath(points: readonly RunwayDay[]): string {
		if (points.length < 2) return '';
		if (points.every((point) => point.high === point.low)) return '';

		const out = points.map((point) => `${x(point.day)},${y(point.high)}`);
		const back = [...points].reverse().map((point) => `${x(point.day)},${y(point.low)}`);

		return `M${[...out, ...back].join('L')}Z`;
	}

	function shortLabel(payment: ExpectedPayment): string {
		const name =
			payment.merchant.length > 14 ? `${payment.merchant.slice(0, 13)}…` : payment.merchant;

		return `${name} ${payment.flow === 'income' ? '+' : '−'}${formatCurrencyShort(payment.amount, inThousands)}`;
	}

	function trackPointer(event: PointerEvent): void {
		const plot = event.currentTarget as SVGRectElement;
		const box = plot.getBoundingClientRect();

		hovered = nearestIndex(days.map(toPixels), event.clientX - box.left);
	}

	function moveCursor(event: KeyboardEvent): void {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		const jump = { Home: 0, End: days.length - 1 }[event.key];

		if (step !== undefined) {
			event.preventDefault();
			hovered = Math.max(0, Math.min(days.length - 1, (hovered ?? 0) + step));
		} else if (jump !== undefined) {
			event.preventDefault();
			hovered = jump;
		} else if (event.key === 'Escape') {
			hovered = null;
		}
	}

	function describeDay(index: number): string {
		const day = days[index];
		if (day === undefined) return '';

		const charges = day.payments.map(
			(payment) =>
				`${payment.merchant} ${payment.flow === 'income' ? 'in' : 'out'} ${formatCurrency(payment.amount)}`
		);

		return [
			formatDate(day.date),
			`${day.isProjected ? 'Projected' : 'Balance now'} ${formatCurrency(day.balance)}`,
			...charges
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
	{#if days.length === 0}
		<p class="empty">No transactions to project from.</p>
	{:else}
		<div class="plot-wrap">
			<svg
				{width}
				height={HEIGHT}
				role="img"
				aria-label="The balance projected from today to payday, stepping down on each expected payment. Switch to the table view for the underlying figures."
			>
				<g transform="translate({MARGIN.left},{MARGIN.top})">
					{#each yTicks as tick (tick)}
						<line class="grid" x1="0" x2={plotWidth} y1={y(tick)} y2={y(tick)} />
						<text class="tick y" x="-10" y={y(tick)} dy="0.32em">
							{formatCurrencyShort(tick, inThousands)}
						</text>
					{/each}

					<!-- Everything under here is money that is not there. Drawn as a
					     region rather than a line because running out is a state the
					     month is in, not a moment it passes through. -->
					{#if yDomain[0] < 0 && !isRelative}
						<rect
							class="underwater"
							x="0"
							y={y(0)}
							width={plotWidth}
							height={Math.max(y(yDomain[0]) - y(0), 0)}
						/>
						<line class="waterline" x1="0" x2={plotWidth} y1={y(0)} y2={y(0)} />
					{:else if yDomain[0] < 0 && yDomain[1] > 0}
						<line class="zero" x1="0" x2={plotWidth} y1={y(0)} y2={y(0)} />
					{/if}

					{#if bandPath !== ''}
						<path class="band" d={bandPath} />
					{/if}

					{#if cursor}
						<line class="crosshair" x1={x(cursor.day)} x2={x(cursor.day)} y1="0" y2={PLOT_HEIGHT} />
					{/if}

					{#if linePath !== ''}
						<path class="line" d={linePath} />
					{/if}

					<!-- One dot per expected charge, on the day it lands: the shape of
					     the month, in the places the reader can already name. -->
					{#each marks as mark (mark.payment.key)}
						<circle
							class="due-dot"
							class:income={mark.payment.flow === 'income'}
							cx={x(mark.day.day)}
							cy={y(mark.day.balance)}
							r="3.5"
						/>
					{/each}

					{#if runway.lowest && runway.lowest.day !== first?.day}
						<circle
							class="low-dot"
							class:under={runway.lowest.balance < 0}
							cx={x(runway.lowest.day)}
							cy={y(runway.lowest.balance)}
							r="4"
						/>
					{/if}

					{#if first}
						<circle class="today-dot" cx={x(first.day)} cy={y(first.balance)} r="4.5" />
					{/if}

					{#each labelled as mark (mark.payment.key)}
						<text
							class="mark-label"
							class:income={mark.payment.flow === 'income'}
							x={mark.at}
							y={y(mark.day.balance) - 10}
							text-anchor={mark.at > plotWidth - 60 ? 'end' : mark.at < 60 ? 'start' : 'middle'}
						>
							{shortLabel(mark.payment)}
						</text>
					{/each}

					{#if last}
						<text
							class="end-label"
							class:under={last.balance < 0}
							x={Math.min(x(last.day) + 8, plotWidth + MARGIN.right - 8)}
							y={y(last.balance)}
							dy="0.32em"
						>
							{formatCurrencyShort(last.balance, inThousands)}
						</text>
					{/if}

					<line class="axis" x1="0" x2={plotWidth} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT} />

					{#each xTicks as tick, index (tick)}
						<text
							class="tick x"
							x={x(tick)}
							y={PLOT_HEIGHT + 20}
							text-anchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
						>
							{formatDateShort(dateAt(tick), crossesYear)}
						</text>
					{/each}

					<!-- The two ends named for what they are, so the axis does not have
					     to be read as a date range to be understood. -->
					<text class="edge" x="0" y={PLOT_HEIGHT + 36} text-anchor="start">Today</text>
					<text class="edge" x={plotWidth} y={PLOT_HEIGHT + 36} text-anchor="end">
						{runway.isComplete ? 'Payday' : 'The day before payday'}
					</text>

					<rect
						class="hit"
						x="0"
						y="0"
						width={plotWidth}
						height={PLOT_HEIGHT}
						tabindex="0"
						role="slider"
						aria-label="Day between now and payday"
						aria-valuemin={0}
						aria-valuemax={days.length - 1}
						aria-valuenow={hovered ?? 0}
						aria-valuetext={hovered === null
							? 'Use the arrow keys to step through the days to payday'
							: describeDay(hovered)}
						onpointermove={trackPointer}
						onpointerleave={() => (hovered = null)}
						onkeydown={moveCursor}
						onfocus={() => (hovered ??= 0)}
						onblur={() => (hovered = null)}
					/>
				</g>
			</svg>

			{#if cursor}
				<div class="tooltip" style={tooltipStyle(x(cursor.day))}>
					<p class="tooltip-meta">{formatDate(cursor.date)}</p>
					<p class="tooltip-row strong">
						<span class="key" aria-hidden="true"></span>
						<span class="desc">{cursor.isProjected ? 'Projected' : 'In the account'}</span>
						<span class="amount">{formatCurrency(cursor.balance)}</span>
					</p>
					{#if cursor.isProjected && cursor.high !== cursor.low}
						<p class="tooltip-meta">
							{formatCurrency(cursor.low)} – {formatCurrency(cursor.high)} on the leanest and heaviest
							months
						</p>
					{/if}
					{#each cursor.payments as payment (payment.key)}
						<p class="tooltip-row due">
							<span class="key due" class:income={payment.flow === 'income'} aria-hidden="true"
							></span>
							<span class="desc">{payment.merchant}</span>
							<span class="amount">
								{payment.flow === 'income' ? '+' : '−'}{formatCurrency(payment.amount)}
							</span>
						</p>
					{/each}
				</div>
			{/if}
		</div>

		<ul class="legend">
			<li><span class="key" aria-hidden="true"></span>Projected balance</li>
			{#if marks.length > 0}
				<li><span class="key due" aria-hidden="true"></span>Expected payment</li>
			{/if}
			{#if runway.committedIn > 0}
				<li><span class="key due income" aria-hidden="true"></span>Expected income</li>
			{/if}
			{#if bandPath !== ''}
				<li><span class="key band" aria-hidden="true"></span>Leanest to heaviest month</li>
			{/if}
		</ul>

		<figcaption>
			{isRelative
				? 'Net change from today, not a balance — set your current balance on the overview to read it as money.'
				: 'What the account is expected to hold at the end of each day.'}
			{note}
			{dayNote}
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

	/* Below zero is not a value on the axis, it is the thing the reader is
	   trying to avoid — so it is coloured as a place rather than a level. */
	.underwater {
		fill: var(--destructive);
		opacity: 0.07;
	}

	.waterline {
		stroke: var(--destructive);
		stroke-width: 1;
		stroke-dasharray: 4 3;
		opacity: 0.7;
	}

	.line {
		fill: none;
		stroke: var(--series-1);
		stroke-width: 2.5;
		stroke-linejoin: round;
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

	.due-dot.income {
		stroke: var(--status-good);
	}

	.low-dot {
		fill: var(--card);
		stroke: var(--foreground);
		stroke-width: 2;
	}

	.low-dot.under {
		stroke: var(--destructive);
	}

	.mark-label {
		fill: var(--muted-foreground);
		font-size: 11px;
		font-weight: 500;
	}

	.mark-label.income {
		fill: var(--status-good-text);
	}

	.end-label {
		fill: var(--foreground);
		font-size: 12px;
		font-weight: 600;
	}

	.end-label.under {
		fill: var(--destructive);
	}

	.tick {
		fill: var(--faint);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.tick.y {
		text-anchor: end;
	}

	.edge {
		fill: var(--faint);
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
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

	.key.due {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--card);
		border: 2px solid var(--series-1);
	}

	.key.due.income {
		border-color: var(--status-good);
	}

	.key.band {
		width: 10px;
		height: 8px;
		border-radius: 2px;
		background: color-mix(in srgb, var(--series-1) 20%, transparent);
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
