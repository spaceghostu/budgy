<script lang="ts">
	import {
		linearScale,
		nearestIndex,
		niceDomain,
		niceTicks,
		stepAfterAreaPath,
		stepAfterPath,
		type Point
	} from '../charts/scale.ts';
	import {
		formatCurrency,
		formatCurrencyShort,
		formatDate,
		formatDateAndTime,
		formatDateShort,
		spansYears,
		useThousands
	} from '../format.ts';
	import type { BalancePoint } from '../types.ts';

	interface Props {
		series: readonly BalancePoint[];
		/** True while the balance is unanchored, so the axis reads as net change. */
		isRelative: boolean;
	}

	const { series, isRelative }: Props = $props();

	const MARGIN = { top: 16, right: 20, bottom: 30, left: 68 };
	const PLOT_HEIGHT = 300;
	const HEIGHT = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

	let width = $state(720);
	let hovered = $state<number | null>(null);

	const plotWidth = $derived(Math.max(width - MARGIN.left - MARGIN.right, 10));

	const balances = $derived(series.map((point) => point.balance));
	const yDomain = $derived(niceDomain(Math.min(...balances, 0), Math.max(...balances, 0)));
	const xDomain = $derived<[number, number]>([
		series.at(0)?.timestamp ?? 0,
		series.at(-1)?.timestamp ?? 1
	]);

	const x = $derived(linearScale(xDomain, [0, plotWidth]));
	const y = $derived(linearScale(yDomain, [PLOT_HEIGHT, 0]));

	const points = $derived<Point[]>(
		series.map((point) => ({ x: x(point.timestamp), y: y(point.balance) }))
	);

	const linePath = $derived(stepAfterPath(points));
	/** Anchor the wash at zero when zero is on screen, otherwise at the axis. */
	const washBaseline = $derived(yDomain[0] <= 0 && yDomain[1] >= 0 ? y(0) : PLOT_HEIGHT);
	const areaPath = $derived(stepAfterAreaPath(points, washBaseline));

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], 5));
	/** A statement can run across a new year, where a bare day and month is ambiguous. */
	const inThousands = $derived(useThousands(yTicks));
	const datedYear = $derived(spansYears(xDomain[0], xDomain[1]));
	const xTicks = $derived(buildDateTicks(xDomain, plotWidth));

	const last = $derived(series.at(-1) ?? null);
	const active = $derived(hovered === null ? null : (series[hovered] ?? null));
	const activePoint = $derived(hovered === null ? null : (points[hovered] ?? null));

	function buildDateTicks(domain: [number, number], available: number): readonly number[] {
		const [start, end] = domain;
		if (end <= start) return [start];

		const count = Math.max(2, Math.min(7, Math.floor(available / 110)));
		return Array.from(
			{ length: count },
			(_, index) => start + ((end - start) * index) / (count - 1)
		);
	}

	function trackPointer(event: PointerEvent): void {
		const plot = event.currentTarget as SVGRectElement;
		const box = plot.getBoundingClientRect();
		hovered = nearestIndex(points, event.clientX - box.left);
	}

	function moveCursor(event: KeyboardEvent): void {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
		const jump = { Home: 0, End: series.length - 1 }[event.key];

		if (step !== undefined) {
			event.preventDefault();
			hovered = clamp((hovered ?? series.length - 1) + step);
		} else if (jump !== undefined) {
			event.preventDefault();
			hovered = jump;
		} else if (event.key === 'Escape') {
			hovered = null;
		}
	}

	function clamp(index: number): number {
		return Math.max(0, Math.min(series.length - 1, index));
	}

	/**
	 * A point's own date and clock time, rather than its timestamp — which
	 * encodes the row's place in a statement that printed no time.
	 */
	function stamp(point: BalancePoint): string {
		const transaction = point.transaction;
		return transaction === null
			? formatDate(series[1]?.transaction?.date ?? '')
			: formatDateAndTime(transaction.date, transaction.time);
	}

	/** Keep the tooltip inside the card as the crosshair approaches an edge. */
	function tooltipLeft(pointX: number): string {
		const offset = MARGIN.left + pointX;
		const half = 110;
		return `${Math.max(half, Math.min(width - half, offset))}px`;
	}
</script>

<figure bind:clientWidth={width}>
	{#if series.length === 0}
		<p class="empty">No transactions in this range.</p>
	{:else}
		<div class="plot-wrap">
			<svg
				{width}
				height={HEIGHT}
				role="img"
				aria-label="Account balance over time. Switch to the table view for the underlying figures."
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

					<path class="area" d={areaPath} />
					<path class="line" d={linePath} />

					{#if last}
						<circle class="end-dot" cx={x(last.timestamp)} cy={y(last.balance)} r="4.5" />
						<text
							class="end-label"
							x={x(last.timestamp) - 8}
							y={y(last.balance) - 12}
							text-anchor="end">{formatCurrency(last.balance)}</text
						>
					{/if}

					{#if activePoint && active}
						<line class="crosshair" x1={activePoint.x} x2={activePoint.x} y1="0" y2={PLOT_HEIGHT} />
						<circle class="cursor-dot" cx={activePoint.x} cy={activePoint.y} r="4.5" />
					{/if}

					<line class="axis" x1="0" x2={plotWidth} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT} />

					{#each xTicks as tick, index (index)}
						<text
							class="tick x"
							x={x(tick)}
							y={PLOT_HEIGHT + 18}
							text-anchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
							>{formatDateShort(tick, datedYear)}</text
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
						aria-label="Balance history cursor"
						aria-valuemin={0}
						aria-valuemax={series.length - 1}
						aria-valuenow={hovered ?? series.length - 1}
						aria-valuetext={active
							? `${stamp(active)}, balance ${formatCurrency(active.balance)}`
							: 'Use the arrow keys to step through the balance history'}
						onpointermove={trackPointer}
						onpointerleave={() => (hovered = null)}
						onkeydown={moveCursor}
						onfocus={() => (hovered ??= series.length - 1)}
						onblur={() => (hovered = null)}
					/>
				</g>
			</svg>

			{#if active && activePoint}
				<div class="tooltip" style:left={tooltipLeft(activePoint.x)}>
					<p class="tooltip-value">{formatCurrency(active.balance)}</p>
					<p class="tooltip-meta">{stamp(active)}</p>
					{#if active.transaction}
						<p class="tooltip-row">
							<span class="key" aria-hidden="true"></span>
							<span class="desc">{active.transaction.merchant}</span>
							<span class="amount">{formatCurrency(active.transaction.amount)}</span>
						</p>
					{:else}
						<p class="tooltip-meta">Opening balance</p>
					{/if}
				</div>
			{/if}
		</div>

		<figcaption>
			{#if isRelative}
				Relative to a zero closing balance — enter your current balance above to see real figures.
			{:else}
				Balance after each transaction, held until the next one moves it.
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

	.zero {
		stroke: var(--axis);
		stroke-width: 1;
	}

	.axis {
		stroke: var(--axis);
		stroke-width: 1;
	}

	.area {
		fill: var(--series-1);
		fill-opacity: 0.1;
	}

	.line {
		fill: none;
		stroke: var(--series-1);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}

	.end-dot,
	.cursor-dot {
		fill: var(--series-1);
		stroke: var(--surface-1);
		stroke-width: 2;
	}

	.end-label {
		fill: var(--text-primary);
		font-size: 12px;
		font-weight: 600;
	}

	.crosshair {
		stroke: var(--axis);
		stroke-width: 1;
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
		transform: translateX(-50%);
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

	.tooltip-value {
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.tooltip-meta {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px !important;
		padding-top: 6px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-secondary);
	}

	.key {
		flex: none;
		width: 10px;
		height: 2px;
		border-radius: 1px;
		background: var(--series-1);
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
