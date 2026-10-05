<script lang="ts">
	import StatTile from '$lib/components/StatTile.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import { formatCount, formatCurrency, formatMonth } from '../format.ts';
	import {
		comparePayoffs,
		type DebtPayoff,
		type PayoffDebt,
		type PayoffPlan
	} from '../stats/payoff.ts';

	interface Props {
		debts: readonly PayoffDebt[];
		/** Rand a month over the instalments. */
		extra: number;
		/** `YYYY-MM-DD` the balances describe — where the months are counted from. */
		from: string;
		onextra: (extra: number) => void;
	}

	const { debts, extra, from, onextra }: Props = $props();

	let strategy = $state<'avalanche' | 'snowball'>('avalanche');

	const plans = $derived(comparePayoffs(debts, extra));
	const plan = $derived(plans[strategy]);
	const names = $derived(new Map(debts.map((debt) => [debt.id, debt.name])));

	/** The calendar month a number of months from the report lands in. */
	function monthAfter(months: number): string {
		const [year, month] = from.split('-').map(Number);
		if (!Number.isFinite(year) || !Number.isFinite(month)) return '';

		const index = year * 12 + (month - 1) + months;
		return formatMonth(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
	}

	function when(months: number | null): string {
		if (months === null) return 'Not within 50 years';
		if (months === 0) return 'Nothing owed';

		const label = monthAfter(months);
		return label === '' ? formatCount(months, 'month') : label;
	}

	const interestSaved = $derived(plans.minimums.totalInterest - plan.totalInterest);

	const monthsSaved = $derived(
		plans.minimums.months === null || plan.months === null
			? null
			: plans.minimums.months - plan.months
	);

	function clears(entry: DebtPayoff): string {
		return entry.clearsIn === null
			? 'does not clear'
			: `clear in ${formatCount(entry.clearsIn, 'month')}`;
	}

	/** What is worth saying about one debt beyond when it goes. */
	function caveat(entry: DebtPayoff, minimums: PayoffPlan): string {
		const alone = minimums.debts.find((other) => other.id === entry.id);

		if (entry.shortOfInterest) {
			return alone?.clearsIn === null
				? 'its instalment does not cover the interest — left alone it only grows'
				: 'its instalment barely covers the interest';
		}
		if (!entry.rateKnown) return 'no rate entered, so no interest counted';

		return entry.minimumEstimated ? 'minimum payment estimated' : '';
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-end gap-x-[18px] gap-y-2.5">
		<div class="flex flex-col gap-1.5">
			<Label for="debt-extra" class="text-xs font-normal text-muted-foreground">
				Extra each month, over the instalments
			</Label>
			<Input
				id="debt-extra"
				type="number"
				inputmode="decimal"
				min="0"
				step="50"
				class="h-8 w-36 text-[13px]"
				placeholder="0"
				value={extra === 0 ? '' : extra}
				onchange={(event) => {
					// Nothing below zero is kept, so the field is not left saying so.
					const kept = Math.max(Number(event.currentTarget.value) || 0, 0);
					event.currentTarget.value = kept === 0 ? '' : `${kept}`;
					onextra(kept);
				}}
			/>
		</div>

		<div class="flex min-w-0 flex-col gap-1.5">
			<span id="payoff-order" class="text-xs text-muted-foreground">Pay off first</span>
			<ToggleGroup
				type="single"
				variant="outline"
				size="sm"
				aria-labelledby="payoff-order"
				value={strategy}
				onValueChange={(next) => {
					// One ordering is always in force, so the group cannot be emptied.
					if (next) strategy = next as 'avalanche' | 'snowball';
				}}
			>
				<ToggleGroupItem value="avalanche" class="text-[13px]">Highest rate</ToggleGroupItem>
				<ToggleGroupItem value="snowball" class="text-[13px]">Smallest balance</ToggleGroupItem>
			</ToggleGroup>
		</div>
	</div>

	{#if plan.ratesMissing > 0}
		<Alert.Root class="text-[13px]">
			<Alert.Title class="font-semibold">
				{formatCount(plan.ratesMissing, 'debt has', 'debts have')} no interest rate
			</Alert.Title>
			<Alert.Description>
				A credit report does not carry rates, so
				{plan.ratesMissing === 1 ? 'it is' : 'they are'} counted at no interest and ranked by balance.
				{#if strategy === 'avalanche' && plan.effective === 'snowball'}
					With none entered, "highest rate" has nothing to rank by and this is smallest balance
					first.
				{/if}
				Enter them above — they are on each lender's statement — and the order and the interest below
				become real.
			</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
		<StatTile
			label="Debt-free"
			value={when(plan.months)}
			hint={plan.months === null || plan.months === 0
				? undefined
				: formatCount(plan.months, 'month')}
			tone={plan.months === null ? 'critical' : 'neutral'}
		/>
		<StatTile
			label="Interest still to pay"
			value={formatCurrency(plan.totalInterest)}
			hint="Before fees and credit-life cover"
		/>
		<StatTile
			label="Against instalments alone"
			value={formatCurrency(Math.max(interestSaved, 0))}
			tone={interestSaved > 0 ? 'good' : 'neutral'}
			hint={monthsSaved === null
				? 'Less interest — instalments alone never clear it'
				: monthsSaved > 0
					? `Less interest, and ${formatCount(monthsSaved, 'month')} sooner`
					: 'Less interest'}
		/>
	</div>

	<ol class="list-none">
		{#each plan.debts as entry (entry.id)}
			{@const note = caveat(entry, plans.minimums)}
			<li class="flex items-baseline gap-3 border-t py-2.5">
				<span class="w-5 flex-none text-xs text-faint tabular-nums">{entry.order}</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[13px]">{names.get(entry.id) ?? entry.name}</p>
					<p class="mt-0.5 text-xs text-faint">
						{[clears(entry), note].filter((part) => part !== '').join(' · ')}
					</p>
				</div>
				<span class="flex-none text-[13px] tabular-nums">
					{formatCurrency(entry.interest)} interest
				</span>
			</li>
		{/each}
	</ol>
</div>
