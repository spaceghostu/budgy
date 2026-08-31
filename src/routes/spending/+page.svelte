<script lang="ts">
	import BarList from '$lib/components/BarList.svelte';
	import BucketTable from '$lib/components/BucketTable.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import MonthComparisonCard from '$lib/components/MonthComparisonCard.svelte';
	import MonthlyTotalsCard from '$lib/components/MonthlyTotalsCard.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import TransactionsDialog from '$lib/components/TransactionsDialog.svelte';
	import UncategorisedList from '$lib/components/UncategorisedList.svelte';
	import { formatDate } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';
	import { drillInto, type Drilldown } from '$lib/stats/compare.js';
	import type { CompareDimension } from '$lib/types.js';

	const statement = useStatement();
	const insights = $derived(statement.insights);

	/**
	 * Which bar was opened, rather than what it contained at the time.
	 *
	 * The rows are re-derived from these below, because the dialog can now change
	 * a category and everything behind it moves: a snapshot taken on the click
	 * would leave the dialog showing an old list and an old total while the bar
	 * underneath it had already moved on — the one thing this app does not allow
	 * two figures on screen to do.
	 */
	interface Opened {
		/** Which slice the figure was counted from. See the two handlers below. */
		readonly source: 'period' | 'compared';
		readonly dimension: CompareDimension;
		readonly label: string;
		/** `null` when the figure stood for the whole filtered period. */
		readonly months: readonly string[] | null;
	}

	let opened = $state<Opened | null>(null);

	const drilldown = $derived.by((): Drilldown | null => {
		if (opened === null) return null;

		return opened.source === 'period'
			? drillInto(statement.visible, opened.dimension, opened.label)
			: drillInto(
					statement.accountTransactions,
					opened.dimension,
					opened.label,
					opened.months,
					statement.monthStart
				);
	});

	/**
	 * What the dialog says the figures cover, when the click did not name months.
	 *
	 * The dates the period actually spans rather than the preset's name: "All"
	 * tells a reader nothing about which months are in the total they are looking
	 * at, and the summary already knows where the slice begins and ends.
	 */
	const periodLabel = $derived(
		insights.summary.from === '' || insights.summary.to === ''
			? undefined
			: `${formatDate(insights.summary.from)} – ${formatDate(insights.summary.to)}`
	);

	/**
	 * The breakdowns are built from the period-filtered slice, so their bars open
	 * that same slice. Anything wider would total to more than the bar says, and
	 * two figures on screen would disagree.
	 */
	function openBucket(dimension: CompareDimension, label: string): void {
		opened = { source: 'period', dimension, label, months: null };
	}

	/**
	 * The comparison card reaches past the period row, so its bars open the
	 * account's whole history narrowed to the months the figure stood for.
	 */
	function openCompared(
		label: string,
		months: readonly string[],
		dimension: CompareDimension
	): void {
		opened = { source: 'compared', dimension, label, months };
	}

	/** Two cards side by side, stacking before either gets too narrow to read. */
	const twoUp = 'grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-5';
</script>

{#if !statement.hasStatement}
	<NoStatement what="Spending by category and merchant" savedCount={statement.library.count} />
{:else}
	<!-- Fed the account's transactions rather than the period-filtered slice:
	     a chart that compares months cannot be filtered down to one of them.
	     Its own controls, in the card, scope only itself. -->
	<MonthlyTotalsCard
		transactions={statement.accountTransactions}
		focusMonth={statement.focusMonth}
		monthStart={statement.monthStart}
	/>

	<!-- Under the shapes and above the single-period breakdowns: the card above
	     says whether a month went differently, this one says what went
	     differently, and the two below say where this period's money went.
	     Fed the account's transactions for the same reason as the card above. -->
	<MonthComparisonCard
		transactions={statement.accountTransactions}
		focusMonth={statement.focusMonth}
		monthStart={statement.monthStart}
		onselect={openCompared}
	/>

	<div class={twoUp}>
		<ChartCard
			title="Where the money went"
			subtitle="Spending by category — open one for its transactions"
		>
			{#snippet chart()}
				<BarList
					buckets={insights.categories}
					emptyMessage="No spending in this range."
					onselect={(label) => openBucket('category', label)}
				/>
			{/snippet}
			{#snippet table()}
				<BucketTable
					buckets={insights.categories}
					heading="Category"
					onselect={(label) => openBucket('category', label)}
				/>
			{/snippet}
		</ChartCard>

		<ChartCard title="Who you paid" subtitle="Spending by merchant — open one for its transactions">
			{#snippet chart()}
				<BarList
					buckets={insights.merchants}
					emptyMessage="No spending in this range."
					onselect={(label) => openBucket('merchant', label)}
				/>
			{/snippet}
			{#snippet table()}
				<BucketTable
					buckets={insights.merchants}
					heading="Merchant"
					onselect={(label) => openBucket('merchant', label)}
				/>
			{/snippet}
		</ChartCard>
	</div>

	<!-- Sits under the breakdowns it corrects: a category chosen here moves the
	     money out of "Uncategorised" and into a bar above. -->
	{#if statement.uncategorised.length > 0 || statement.appliedRules.length > 0}
		<ChartCard
			title="Spending with no category"
			subtitle="File what the bank left blank, a merchant at a time"
		>
			{#snippet chart()}
				<UncategorisedList
					pending={statement.uncategorised}
					applied={statement.appliedRules}
					options={statement.categoryOptions}
					recent={statement.recentOptions}
					onassign={(merchant, category) => statement.setCategory(merchant, category)}
				/>
			{/snippet}
		</ChartCard>
	{/if}

	<!-- One dialog for the page rather than one per card: what is open is a single
	     answer to a single click, and three of them could not be open at once. -->
	<TransactionsDialog
		{drilldown}
		{periodLabel}
		options={statement.categoryOptions}
		recent={statement.recentOptions}
		onassign={(merchant, category) => statement.setCategory(merchant, category)}
		onclose={() => (opened = null)}
	/>
{/if}
