<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import BalanceChart from '$lib/components/BalanceChart.svelte';
	import BalanceHero from '$lib/components/BalanceHero.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import DailyFlowChart from '$lib/components/DailyFlowChart.svelte';
	import DailyFlowTable from '$lib/components/DailyFlowTable.svelte';
	import FetchStatement from '$lib/components/FetchStatement.svelte';
	import Highlights from '$lib/components/Highlights.svelte';
	import SourcePicker from '$lib/components/SourcePicker.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import TransactionTable from '$lib/components/TransactionTable.svelte';
	import { formatCount, formatCurrency, formatSigned } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';
	import { buildHighlights } from '$lib/stats/highlights.js';

	const state = useStatement();

	const insights = $derived(state.insights);
	const summary = $derived(insights.summary);
	const highlights = $derived(state.hasStatement ? buildHighlights(insights) : []);

	/** Read picked files one after another, so two drops cannot race. */
	async function accept(files: readonly File[]): Promise<void> {
		for (const file of files) await state.loadFile(file);
	}
</script>

<SourcePicker
	sources={state.sources}
	busy={state.busy}
	compact={state.hasStatement}
	onfiles={(files) => void accept(files)}
	onremove={(kind) => void state.remove(kind)}
	onerror={(message) => (state.error = message)}
/>

<FetchStatement statement={state} />

{#if state.hasStatement}
	<!-- The next upload has to be told whether it completes this statement or
	     starts the next one. Adding a file above does the first; this does the
	     second, and what is on screen is already filed either way. -->
	<div class="-mt-2 flex flex-wrap items-center justify-between gap-3">
		<p class="text-xs text-faint">
			Saved to this browser
			{#if state.library.count > 1}
				· <a href={resolve('/history')} class="underline underline-offset-2 hover:text-foreground">
					{formatCount(state.library.count, 'statement')} kept
				</a>
			{/if}
		</p>
		<Button variant="outline" size="xs" class="border-input" onclick={() => state.startNew()}>
			Start a new statement
		</Button>
	</div>
{/if}

{#if !state.hasStatement}
	<Card.Root class="[--card-spacing:--spacing(6)]">
		<Card.Content>
			<h2 class="mb-3 text-[15px] font-semibold">What you get</h2>
			<ul class="grid list-disc gap-1.75 pl-5 text-sm text-muted-foreground">
				<li>
					<strong class="font-semibold text-foreground">A balance line over time</strong> — see the month
					drain, transaction by transaction. The certified PDF prints a running balance beside every row,
					so this is real money rather than a shape.
				</li>
				<li>
					<strong class="font-semibold text-foreground">Money in against money out</strong>, day by
					day.
				</li>
				<li>
					<strong class="font-semibold text-foreground">Where it went</strong> — by category and by merchant.
				</li>
				<li>
					<strong class="font-semibold text-foreground">The charges that repeat</strong> — debit orders
					and subscriptions, totalled.
				</li>
				<li>
					<strong class="font-semibold text-foreground">What the fees cost you</strong>, including
					fees for declined transactions.
				</li>
				<li>
					<strong class="font-semibold text-foreground">A written read from Claude</strong>, if you
					want one — the only part that sends anything anywhere, under your own API key, and only
					when you press the button.
				</li>
			</ul>
			<p class="mt-4 border-t pt-3.5 text-[12.5px] text-faint">
				Your files are read by this page and analysed in memory. There is no server, no upload and
				no account. Each statement you open is kept in this browser so the next visit still has it,
				and so a year of exports builds into a history — on this device only, and clearable from the
				History page. The one exception is Ask Claude, which sends totals — never descriptions or
				account numbers — to Anthropic when you ask it to, and shows you exactly what it would send
				first.
			</p>
		</Card.Content>
	</Card.Root>

	{#if state.library.count > 0}
		<p class="text-center text-[13px] text-muted-foreground">
			…or <a
				href={resolve('/history')}
				class="font-medium underline underline-offset-2 hover:text-foreground"
			>
				open one of the {formatCount(state.library.count, 'statement')}
			</a> already kept here.
		</p>
	{/if}
{:else}
	<BalanceHero
		{summary}
		isRelative={state.isRelative}
		isStale={state.isAnchorStale}
		isCertified={state.balancesAreCertified}
		account={state.account}
		anchor={state.anchor}
		onanchor={(balance) => state.setAnchor(balance)}
	/>

	<Highlights {highlights} />

	<div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
		<StatTile label="Money in" value={formatCurrency(summary.income)} hint="Excludes transfers" />
		<StatTile label="Money out" value={formatCurrency(summary.expense)} hint="Excludes transfers" />
		<StatTile
			label="Net"
			value={formatSigned(summary.net)}
			tone={summary.net >= 0 ? 'good' : 'critical'}
			hint="In minus out"
		/>
		<StatTile
			label="Mean daily spend"
			value={formatCurrency(summary.meanDailySpend)}
			hint="Across {summary.days} days"
		/>
		<StatTile
			label="Median daily spend"
			value={formatCurrency(summary.medianDailySpend)}
			hint="What the middle day cost"
		/>
		<StatTile
			label="Fees and interest"
			value={formatCurrency(summary.fees)}
			hint={summary.declinedFees > 0
				? `${formatCurrency(summary.declinedFees)} from declines`
				: 'Bank charges'}
		/>
		<StatTile
			label="Runway"
			value={summary.runwayDays === null ? '—' : formatCount(summary.runwayDays, 'day')}
			tone={summary.runwayDays !== null && summary.runwayDays < 30 ? 'critical' : 'neutral'}
			hint={summary.runwayDays === null ? 'Income covers spending' : 'At the current burn rate'}
		/>
	</div>

	<ChartCard
		title="Balance over time"
		subtitle={state.spansAccounts
			? `Combined net change across ${formatCount(state.accounts.length, 'account')} — pick one above for its real balance`
			: state.balancesAreCertified
				? 'The balance the bank printed beside every row'
				: 'Every transaction, in the order it hit the account'}
	>
		{#snippet chart()}
			<BalanceChart series={insights.balanceSeries} isRelative={state.isRelative} />
		{/snippet}
		{#snippet table()}
			<TransactionTable series={insights.balanceSeries} searchable={false} pageSize={15} />
		{/snippet}
	</ChartCard>

	<ChartCard
		title="Money in and out"
		subtitle={insights.flowIsMonthly
			? 'Month by month across the period'
			: 'Day by day across the period'}
	>
		{#snippet chart()}
			<DailyFlowChart
				days={insights.flow}
				monthly={insights.flowIsMonthly}
				monthStart={state.monthStart}
			/>
		{/snippet}
		{#snippet table()}
			<DailyFlowTable
				days={insights.flow}
				monthly={insights.flowIsMonthly}
				monthStart={state.monthStart}
			/>
		{/snippet}
	</ChartCard>
{/if}
