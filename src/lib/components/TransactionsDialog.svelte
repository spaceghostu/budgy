<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import CategoryPicker from './CategoryPicker.svelte';
	import TransactionList from './TransactionList.svelte';
	import { formatCount, formatCurrency, formatDate, formatMonth } from '../format.ts';
	import type { Drilldown } from '../stats/compare.ts';

	interface Props {
		/** What was clicked, or `null` while nothing is open. */
		drilldown: Drilldown | null;
		/**
		 * What the rows were already scoped to before the click — the period row's
		 * doing, which the drill-down inherits rather than overrides. Named here so
		 * a total that looks low reads as "this period" rather than as a bug.
		 */
		periodLabel?: string;
		onclose: () => void;
		/**
		 * Categories on offer. Given together with {@link Props.onassign}, each
		 * merchant in the list gets a picker; left out, the dialog only reads.
		 */
		options?: readonly string[];
		/** The categories last chosen, most recent first — the picker's shortlist. */
		recent?: readonly string[];
		/** A blank takes the merchant's choice back off again. */
		onassign?: (merchant: string, category: string) => void;
	}

	const { drilldown, periodLabel, onclose, options, recent = [], onassign }: Props = $props();

	const editable = $derived(options !== undefined && onassign !== undefined);

	/**
	 * The control the reader opened this from, so closing puts them back on it.
	 *
	 * A dialog opened from a `Dialog.Trigger` gets this from the primitive, but
	 * these open from a bar anywhere on the page and the `open` state is driven
	 * from outside. Without it, closing drops focus onto `<body>` and a keyboard
	 * reader has to tab down the whole page again to reach the next bar.
	 *
	 * Read in `$effect.pre`, before the dialog mounts and takes focus, which is
	 * the last moment the clicked control still has it. A plain `let`, since
	 * nothing renders from it.
	 */
	let opener: HTMLElement | null = null;

	$effect.pre(() => {
		if (drilldown === null) {
			opener = null;
			return;
		}

		opener ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
	});

	/**
	 * Plain functions rather than deriveds: the header is rendered into a portal
	 * that outlives the value it describes by an animation frame, and a derived
	 * read after its own block has gone is a stale value waiting to be drawn.
	 */
	function noun(open: Drilldown): string {
		return open.dimension === 'merchant' ? 'merchant' : 'category';
	}

	/**
	 * What the list covers, said in the header.
	 *
	 * A drill-down opened from a month's bar covers that month; one opened from a
	 * breakdown covers whatever the period row had already narrowed to. Either
	 * way the total below has to be attributable to something, or it is a number
	 * with no question attached.
	 */
	function scopeOf(open: Drilldown): string {
		if (open.months !== null) return open.months.map(formatMonth).join(', ');

		return periodLabel ?? 'the selected period';
	}
</script>

<Dialog.Root
	open={drilldown !== null}
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Dialog.Content
		class="sm:max-w-lg"
		onCloseAutoFocus={(event) => {
			// Only when the control is still on the page: re-filing a merchant can
			// take the bar away underneath the dialog, and focusing a detached node
			// puts the reader nowhere at all.
			if (opener === null || !opener.isConnected) return;

			event.preventDefault();
			opener.focus();
		}}
	>
		{#if drilldown}
			<Dialog.Header>
				<Dialog.Title class="text-[15px] font-semibold tracking-[-0.01em]">
					{drilldown.label}
				</Dialog.Title>
				<Dialog.Description class="text-[13px]">
					<strong class="text-[15px] font-semibold text-foreground tabular-nums">
						{formatCurrency(drilldown.total)}
					</strong>
					across {formatCount(drilldown.transactions.length, 'transaction')} in {scopeOf(drilldown)}
				</Dialog.Description>
			</Dialog.Header>

			<!-- Scrolls inside the dialog rather than growing it: a busy merchant can
			     run to hundreds of rows, and a dialog taller than the window puts its
			     own close button off screen. -->
			<div class="-mr-1 max-h-[55vh] min-h-0 overflow-y-auto pr-1">
				{#if !editable}
					<TransactionList
						transactions={drilldown.transactions}
						emptyMessage="Nothing was spent on this {noun(drilldown)} in this period."
					/>
				{:else if drilldown.transactions.length === 0}
					<p class="py-6 text-center text-[13px] text-faint">
						Nothing is filed under this {noun(drilldown)} any more.
					</p>
				{:else}
					<ul class="flex list-none flex-col p-0">
						{#each drilldown.merchants as group (group.merchant)}
							<li class="border-t py-3 first:border-t-0 first:pt-0">
								<div class="flex items-baseline justify-between gap-3">
									<span class="min-w-0 truncate text-[13px]" title={group.merchant}>
										{group.merchant}
									</span>
									<span class="flex-none text-[13px] font-semibold tabular-nums">
										{formatCurrency(group.total)}
									</span>
								</div>

								<ol class="mt-1 flex list-none flex-col p-0">
									{#each group.transactions as transaction (transaction.id)}
										<li class="flex items-baseline justify-between gap-3 text-xs text-faint">
											<span class="min-w-0 truncate" title={transaction.description}>
												{formatDate(transaction.date)} · {transaction.description ||
													transaction.merchant}
											</span>
											<span class="flex-none tabular-nums">
												{formatCurrency(Math.abs(transaction.amount))}
											</span>
										</li>
									{/each}
								</ol>

								<!-- Under the rows it moves, and said plainly: the choice is not
								     about the one transaction the reader happened to click. -->
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<CategoryPicker
										merchant={group.merchant}
										current={group.category}
										options={options ?? []}
										{recent}
										onassign={(merchant, category) => onassign?.(merchant, category)}
									/>
								</div>
								<p class="mt-1.5 text-xs text-faint">
									Files {formatCount(group.count, 'transaction')} from {group.merchant} — and every other,
									in this statement and the next.
								</p>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
