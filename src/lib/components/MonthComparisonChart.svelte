<script lang="ts">
	import {
		formatCurrency,
		formatMonth,
		formatOrdinal,
		formatPercent,
		formatSigned
	} from '../format.ts';
	import { CALENDAR_START, isCalendarStart } from '../stats/cycle.ts';
	import { foldTail, peakMonth } from '../stats/compare.ts';
	import type { MonthComparison } from '../types.ts';

	interface Props {
		comparison: MonthComparison;
		/** How many labels to draw before folding the rest into "Other". */
		limit?: number;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
		/**
		 * Opens the rows behind a label, either across every month compared
		 * (`month` left out) or in the one month whose bar was clicked.
		 */
		onselect?: (label: string, month?: string) => void;
	}

	const { comparison, limit = 8, monthStart = CALENDAR_START, onselect }: Props = $props();

	/** Steps in the recency ramp, oldest to newest. */
	const TONES = 5;

	/** True while the long tail is being shown label by label. */
	let expanded = $state(false);

	const tail = $derived(Math.max(comparison.rows.length - limit, 0));

	/**
	 * A long tail folds into one "Other" row by default — a comparison is read for
	 * the few labels that moved, and forty of them buries those.
	 *
	 * A default, not a ceiling: the fold says how many it stands for and opens to
	 * show them. Colour is no reason to keep it shut, either — the bars here are
	 * coloured by month, so a longer tail adds rows rather than hues.
	 */
	const rows = $derived(expanded ? comparison.rows : foldTail(comparison.rows, limit));
	/**
	 * Every bar is measured against the heaviest single month on the card, not
	 * against its own row's biggest. A row scaled to itself would draw a month of
	 * coffee the same length as a month of rent, and the only reason to put the
	 * months in one picture is that the lengths mean the same thing.
	 *
	 * It follows that opening the tail can rescale every bar, since a folded row
	 * heavy enough to be the tallest thing on the card was compressing the real
	 * ones against it. That is the fold being undone rather than the chart moving
	 * about: expanded, each bar is measured against a month something was actually
	 * spent on.
	 */
	const max = $derived(peakMonth(rows));

	const months = $derived(
		comparison.months.map((month, index) => ({
			...month,
			label: formatMonth(month.month),
			tone: toneOf(index)
		}))
	);

	/** The ramp itself, palest first — the legend draws it as a scale. */
	const ramp = $derived(Array.from({ length: TONES }, (_, step) => `var(--recency-${step + 1})`));

	const noun = $derived(comparison.dimension === 'merchant' ? 'merchant' : 'category');

	/**
	 * A folded row stands for several labels at once, so there is no list of
	 * transactions behind it to open. It opens the labels instead — see the
	 * heading in the template.
	 */
	function isFolded(label: string): boolean {
		return label.startsWith('Other (');
	}

	function opens(label: string): boolean {
		return onselect !== undefined && !isFolded(label);
	}
	const hasPartial = $derived(comparison.months.some((month) => month.isPartial));
	const dayNote = $derived(
		isCalendarStart(monthStart) ? '' : ` A month here opens on the ${formatOrdinal(monthStart)}.`
	);

	/**
	 * Spread the ramp across however many months are on screen.
	 *
	 * Past five months some neighbours share a step — the same reading the
	 * month-against-month lines take: the ramp says roughly how old a column is,
	 * and two months running are close to the same age. The month names beside
	 * every bar carry the identity, so nothing depends on telling two steps apart.
	 */
	function toneOf(index: number): string {
		if (comparison.months.length <= 1) return `var(--recency-${TONES})`;

		const step = Math.round((index / (comparison.months.length - 1)) * (TONES - 1));

		return `var(--recency-${step + 1})`;
	}

	/**
	 * What moved, in words.
	 *
	 * Neutral throughout, and deliberately: on a spending total every figure is
	 * positive by construction, and a fall in what a category took is not
	 * automatically good news — it can as easily be the month the medical aid
	 * failed to collect.
	 */
	function movement(change: number, share: number | null): string {
		if (comparison.months.length < 2) return '';
		if (change === 0) return 'No change on the month before';

		const percent = share === null ? '' : ` (${formatPercent(Math.abs(share))})`;

		return `${formatSigned(change)}${percent} on ${months.at(-2)?.label}`;
	}
</script>

<figure>
	{#if rows.length === 0}
		<p class="empty">No spending in the months compared.</p>
	{:else}
		<ul class="rows">
			{#each rows as row (row.label)}
				<li>
					<div class="head">
						{#if isFolded(row.label)}
							<!-- The fold is its own way in, and a different one: it opens the
							     labels it stands for rather than the transactions behind one,
							     so it wears a chevron and says what it does. No `aria-expanded`:
							     opening replaces the control with the rows, so it could only ever
							     report false. -->
							<button
								type="button"
								class="label link folded"
								aria-label="{row.label} — show them"
								onclick={() => (expanded = true)}
							>
								{row.label}
								<span class="chevron" aria-hidden="true">▾</span>
							</button>
						{:else if opens(row.label)}
							<!-- Named in full for a reader who cannot see which of the two
							     targets this is: the heading opens every month, the bars
							     below open one each. -->
							<button
								type="button"
								class="label link"
								aria-label="{row.label}, every month compared"
								onclick={() => onselect?.(row.label)}
							>
								{row.label}
							</button>
						{:else}
							<span class="label" title={row.label}>{row.label}</span>
						{/if}
						<span class="total">{formatCurrency(row.total)}</span>
					</div>

					<ul class="bars">
						{#each months as month, index (month.month)}
							{@const total = row.totals[index] ?? 0}
							<!-- The whole row is the target rather than the bar itself: a
							     9px stripe, and a short one at that, is not something a
							     reader can be asked to hit. -->
							<li class="bar-row">
								{#if opens(row.label)}
									<button
										type="button"
										class="bar-hit"
										onclick={() => onselect?.(row.label, month.month)}
									>
										<span class="month">{month.label}</span>
										<span class="track">
											<!-- Square at the baseline, rounded at the data end. -->
											<span
												class="bar"
												style:width="{max > 0 ? (total / max) * 100 : 0}%"
												style:background={month.tone}
											></span>
										</span>
										<span class="amount">{formatCurrency(total)}</span>
										<span class="sr-only">
											{row.label} in {month.label}. Opens the transactions behind it.
										</span>
									</button>
								{:else}
									<span class="bar-hit">
										<span class="month">{month.label}</span>
										<span class="track">
											<span
												class="bar"
												style:width="{max > 0 ? (total / max) * 100 : 0}%"
												style:background={month.tone}
											></span>
										</span>
										<span class="amount">{formatCurrency(total)}</span>
									</span>
								{/if}
							</li>
						{/each}
					</ul>

					{#if comparison.months.length > 1}
						<p class="movement">{movement(row.change, row.changeShare)}</p>
					{/if}
				</li>
			{/each}
		</ul>

		{#if expanded && tail > 0}
			<button type="button" class="show-fewer" onclick={() => (expanded = false)}>
				Show fewer
			</button>
		{/if}

		{#if months.length > 1}
			<ul class="legend">
				<!-- The months are the scale, so the ends are named rather than
				     labelled "oldest" and "newest" in the abstract. -->
				<li>
					<span>{months[0].label}</span>
					<span class="ramp" aria-hidden="true">
						{#each ramp as tone (tone)}
							<span class="tone" style:background={tone}></span>
						{/each}
					</span>
					<span>{months.at(-1)?.label}</span>
				</li>
			</ul>
		{/if}
	{/if}

	<figcaption>
		Spending by {noun}, one bar per month, all measured against the same scale.{dayNote}
		{#if comparison.months.length === 1}
			Only one month is selected — pick another to compare it against.
		{/if}
		{#if hasPartial}
			<!-- "May", deliberately: a first month with nothing on the 1st is
			     indistinguishable from a statement that opened on the 2nd. -->
			{months
				.filter((month) => month.isPartial)
				.map((month) => month.label)
				.join(' and ')} may not be covered in full by the statement, so
			{comparison.months.filter((month) => month.isPartial).length === 1 ? 'its' : 'their'} bars read
			short.
		{/if}
	</figcaption>
</figure>

<style>
	figure {
		margin: 0;
		min-width: 0;
	}

	.rows,
	.bars,
	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.rows > li {
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
	}

	.total {
		flex: none;
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.bars {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 7px;
	}

	.bar-row {
		min-width: 0;
	}

	.bar-hit {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: 2px 3px;
		border: 0;
		border-radius: 4px;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	button.bar-hit {
		cursor: pointer;
	}

	button.bar-hit:hover {
		background: var(--muted);
	}

	.folded {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.chevron {
		font-size: 10px;
		color: var(--faint);
	}

	.show-fewer {
		margin-top: 14px;
		padding: 3px 8px;
		border: 1px solid var(--input);
		border-radius: var(--radius-sm);
		background: none;
		color: var(--muted-foreground);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.show-fewer:hover {
		border-color: var(--series-1);
		color: var(--foreground);
	}

	/* A quiet affordance: the row is already dense, and an underline on every
	   label would read as a page of links rather than as a breakdown. */
	.link {
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.link:hover {
		color: var(--series-1);
		text-decoration: underline;
	}

	.month {
		flex: none;
		width: 62px;
		font-size: 11px;
		color: var(--faint);
		white-space: nowrap;
	}

	.track {
		flex: 1;
		min-width: 0;
		height: 9px;
		border-radius: 2px;
		background: var(--muted);
		overflow: hidden;
	}

	.bar {
		display: block;
		height: 100%;
		min-width: 2px;
		/* Square where it meets the baseline, rounded at the data end, so a short
		   bar reads as a magnitude measured from zero rather than as a pill. */
		border-radius: 0 2px 2px 0;
	}

	.amount {
		flex: none;
		width: 88px;
		text-align: right;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.movement {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--faint);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 16px;
		font-size: 12px;
		color: var(--muted-foreground);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	/* Drawn in its steps rather than as a gradient: the bars only ever take one
	   of those five colours, and a smooth bar would promise a precision the marks
	   do not have. */
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
		margin-top: 12px;
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
