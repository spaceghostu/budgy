<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatCount, formatCurrency, formatDate, formatMonth } from '../format.ts';
	import type { RecurringCharge } from '../types.ts';

	interface Props {
		charges: readonly RecurringCharge[];
		/** Rows shown before the "show all" control appears. */
		limit?: number;
	}

	const { charges, limit = 12 }: Props = $props();

	let expanded = $state(false);

	const total = $derived(charges.reduce((sum, charge) => sum + charge.latestAmount, 0));
	// A two-year statement can turn up dozens of repeating charges; the biggest
	// are the ones worth acting on, and the rest are a click away.
	const visible = $derived(expanded ? charges : charges.slice(0, limit));

	/** Naming twenty months would swamp the line; a span says the same thing. */
	function monthsLabel(months: readonly string[]): string {
		if (months.length <= 3) return `seen in ${months.map(formatMonth).join(', ')}`;

		return `seen in ${months.length} months, ${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])}`;
	}
</script>

{#if charges.length === 0}
	<p class="py-6 text-center text-[13px] text-faint">
		No repeating charges found in this period. A longer statement gives this more to work with.
	</p>
{:else}
	<p class="mb-3.5 text-[13px] text-muted-foreground">
		<strong class="text-[15px] text-foreground">{formatCurrency(total)}</strong> a month across
		{formatCount(charges.length, 'repeating charge')}
	</p>

	<ul class="flex list-none flex-col p-0">
		{#each visible as charge (charge.merchant)}
			<li class="min-w-0 border-t py-2.5">
				<div class="flex items-baseline justify-between gap-3">
					<span class="min-w-0 truncate text-[13px]" title={charge.merchant}>{charge.merchant}</span
					>
					<span class="flex-none text-[13px] font-semibold tabular-nums">
						{formatCurrency(charge.latestAmount)}
					</span>
				</div>
				<p class="mt-1 text-xs text-faint">
					{#if charge.isDebitOrder}
						<Badge
							variant="outline"
							class="mr-1.5 rounded-full border-input px-1.5 py-px text-[11px] font-normal text-muted-foreground"
						>
							Debit order
						</Badge>
					{/if}
					{charge.category} · last on {formatDate(charge.lastSeen)}
					{#if charge.count > 1}
						· {formatCount(charge.count, 'charge')}
					{/if}
					{#if charge.months.length > 1}
						· {monthsLabel(charge.months)}
						{#if charge.meanAmount !== charge.latestAmount || charge.medianAmount !== charge.latestAmount}
							· mean {formatCurrency(charge.meanAmount)}, median
							{formatCurrency(charge.medianAmount)} a month
						{/if}
					{/if}
				</p>
			</li>
		{/each}
	</ul>

	{#if charges.length > limit}
		<Button
			variant="outline"
			size="xs"
			class="mt-3 border-input hover:border-series"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Show fewer' : `Show all ${charges.length}`}
		</Button>
	{/if}
{/if}
