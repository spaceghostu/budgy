<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatCount, formatCurrency, formatPercent } from '../format.ts';
	import type { Bucket } from '../types.ts';

	interface Props {
		buckets: readonly Bucket[];
		/** How many rows to show before folding the rest into "Other". */
		limit?: number;
		/** Noun for the hover/meta line, e.g. "transaction". */
		unit?: string;
		emptyMessage?: string;
		/**
		 * Opens the rows behind a bar. Left out, the list is a picture rather than
		 * a way in, and nothing about a row invites a click it cannot answer.
		 */
		onselect?: (label: string) => void;
	}

	const {
		buckets,
		limit = 8,
		unit = 'transaction',
		emptyMessage = 'Nothing to show.',
		onselect
	}: Props = $props();

	/** True while the long tail is being shown row by row. */
	let expanded = $state(false);

	const tail = $derived(Math.max(buckets.length - limit, 0));

	/**
	 * A long tail folds into one "Other" row by default — a breakdown is read for
	 * the few lines that carry the money, and forty of them buries those.
	 *
	 * A default, though, and not a ceiling: the fold is a way of opening quietly,
	 * so the row says how many it stands for and opens to show them. Nothing about
	 * the palette stops it, either — every bar here is the one series blue, so the
	 * tail adds rows rather than colours.
	 */
	const rows = $derived.by(() => {
		if (expanded || buckets.length <= limit) return buckets;

		const head = buckets.slice(0, limit);
		const tail = buckets.slice(limit);

		return [
			...head,
			{
				// Not a label anything is filed under, so this row is never a way in:
				// there is no list of transactions it could open.
				folded: true,
				label: `Other (${tail.length})`,
				total: tail.reduce((sum, bucket) => sum + bucket.total, 0),
				count: tail.reduce((sum, bucket) => sum + bucket.count, 0),
				share: tail.reduce((sum, bucket) => sum + bucket.share, 0)
			}
		];
	});

	const max = $derived(Math.max(...rows.map((row) => row.total), 0));

	function opens(row: (typeof rows)[number]): boolean {
		return onselect !== undefined && !('folded' in row && row.folded);
	}
</script>

{#snippet body(row: (typeof rows)[number], interactive: boolean, disclosure: boolean)}
	<div class="flex items-baseline justify-between gap-3">
		<span class="flex min-w-0 items-baseline gap-1 text-[13px]" title={row.label}>
			<span class="min-w-0 truncate">{row.label}</span>
			{#if disclosure}
				<ChevronDownIcon class="size-3.5 shrink-0 self-center text-faint" aria-hidden="true" />
			{/if}
		</span>
		<span class="flex-none text-[13px] font-semibold tabular-nums">
			{formatCurrency(row.total)}
		</span>
	</div>
	<div class="mt-1.5 h-2.5 overflow-hidden rounded-sm bg-muted">
		<!-- Square at the baseline, rounded at the data end. -->
		<div
			class="h-full min-w-0.5 rounded-r-sm bg-series"
			style:width="{max > 0 ? (row.total / max) * 100 : 0}%"
		></div>
	</div>
	<p class="mt-1.25 text-xs text-faint">
		{formatCount(row.count, unit)} · {formatPercent(row.share)} of the total
		{#if disclosure}
			· show them
		{:else if interactive}<span class="sr-only">. Opens the transactions behind it.</span>{/if}
	</p>
{/snippet}

{#if rows.length === 0}
	<p class="py-8 text-center text-faint">{emptyMessage}</p>
{:else}
	<ul class="flex list-none flex-col gap-3.5 p-0">
		{#each rows as row (row.label)}
			{@const folded = 'folded' in row && row.folded}
			<li class="-mx-1.5 -my-1 min-w-0 rounded-md transition-colors hover:bg-muted">
				{#if folded}
					<!-- The fold is its own way in, and a different one: this opens the
					     rows it stands for rather than the transactions behind a label,
					     so it wears a chevron and says what it does.

					     No `aria-expanded`: the control is consumed by its own action —
					     opening replaces it with the rows themselves — so it could only
					     ever report false, which says less than its name already does. -->
					<button
						type="button"
						class="block w-full min-w-0 cursor-pointer px-1.5 py-1 text-left"
						aria-label="{row.label} — show them"
						onclick={() => (expanded = true)}
					>
						{@render body(row, false, true)}
					</button>
				{:else if opens(row)}
					<!-- The whole row is the target, not the bar: a 10px stripe is not
					     something a reader can be asked to hit. -->
					<button
						type="button"
						class="block w-full min-w-0 cursor-pointer px-1.5 py-1 text-left"
						onclick={() => onselect?.(row.label)}
					>
						{@render body(row, true, false)}
					</button>
				{:else}
					<div class="px-1.5 py-1">{@render body(row, false, false)}</div>
				{/if}
			</li>
		{/each}
	</ul>

	{#if expanded && tail > 0}
		<Button
			variant="outline"
			size="xs"
			class="mt-3.5 border-input text-muted-foreground hover:border-series hover:text-foreground"
			onclick={() => (expanded = false)}
		>
			Show fewer
		</Button>
	{/if}
{/if}
