<script lang="ts">
	import { formatCount, formatCurrency, formatPercent } from '../format.ts';
	import type { CategoryOutlook } from '../stats/runway.ts';

	interface Props {
		rows: readonly CategoryOutlook[];
		/** False when the reader has narrowed the page to the named charges. */
		everydayOn: boolean;
		/** How many rows to show before folding the rest into "Other". */
		limit?: number;
	}

	const { rows, everydayOn, limit = 8 }: Props = $props();

	/** True while the long tail is being shown row by row. */
	let expanded = $state(false);

	const tail = $derived(Math.max(rows.length - limit, 0));

	/**
	 * A long tail folds into one "Other" row by default, the way every other
	 * breakdown in this app opens: a reader reads a list like this for the few
	 * lines carrying the money, and thirty of them buries those.
	 */
	const shown = $derived.by(() => {
		if (expanded || rows.length <= limit) return rows;

		const head = rows.slice(0, limit);
		const rest = rows.slice(limit);

		return [
			...head,
			{
				category: `Other (${rest.length})`,
				named: rest.reduce((sum, row) => sum + row.named, 0),
				everyday: rest.reduce((sum, row) => sum + row.everyday, 0),
				total: rest.reduce((sum, row) => sum + row.total, 0),
				count: rest.reduce((sum, row) => sum + row.count, 0),
				share: rest.reduce((sum, row) => sum + row.share, 0)
			}
		];
	});

	const max = $derived(Math.max(...shown.map((row) => row.total), 0));

	/**
	 * What a row is made of, said in words.
	 *
	 * The split is the point of this list. A reader deciding whether to spend on
	 * groceries this week needs to know which part of the figure is a debit order
	 * with a date on it and which part is what they usually spend — the first is
	 * already committed, the second is the part they can still choose about.
	 */
	function hintFor(row: (typeof shown)[number]): string {
		if (row.named === 0) return `${formatCurrency(row.everyday)} of usual spending`;
		if (row.everyday === 0) return formatCount(row.count, 'charge');

		return `${formatCount(row.count, 'charge')} · plus ${formatCurrency(row.everyday)} usual`;
	}
</script>

{#if shown.length === 0}
	<p class="py-8 text-center text-faint">
		{everydayOn ? 'Nothing left to spend before payday.' : 'No named charges left before payday.'}
	</p>
{:else}
	<ul class="flex list-none flex-col gap-3.5 p-0">
		{#each shown as row (row.category)}
			<li class="-mx-1.5 -my-1 min-w-0 rounded-md px-1.5 py-1">
				<div class="flex items-baseline justify-between gap-3">
					<span class="min-w-0 truncate text-[13px]" title={row.category}>{row.category}</span>
					<span class="flex-none text-[13px] font-semibold tabular-nums">
						{formatCurrency(row.total)}
					</span>
				</div>

				<!-- One bar, two parts. The committed half is drawn solid and the
				     everyday half lighter, because they are known to different
				     standards and a single flat bar would claim the whole figure is
				     as settled as the debit order in it. The hint line below says the
				     same thing in words, since a shade is not something to make a
				     reader decode on its own. -->
				<div class="mt-1.5 flex h-2.5 overflow-hidden rounded-sm bg-muted">
					<div
						class="h-full bg-series"
						style:width="{max > 0 ? (row.named / max) * 100 : 0}%"
					></div>
					<div
						class="h-full bg-series/40"
						style:width="{max > 0 ? (row.everyday / max) * 100 : 0}%"
					></div>
				</div>

				<p class="mt-1.25 text-xs text-faint">
					{hintFor(row)} · {formatPercent(row.share)} of what is left
				</p>
			</li>
		{/each}
	</ul>

	{#if tail > 0}
		<button
			type="button"
			class="mt-3.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Show fewer' : `Show all ${rows.length}`}
		</button>
	{/if}
{/if}
