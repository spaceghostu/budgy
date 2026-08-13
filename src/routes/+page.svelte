<script lang="ts">
	import { onMount } from 'svelte';
	import AiInsightsCard from '$lib/components/AiInsightsCard.svelte';
	import BalanceChart from '$lib/components/BalanceChart.svelte';
	import BalanceHero from '$lib/components/BalanceHero.svelte';
	import BarList from '$lib/components/BarList.svelte';
	import BucketTable from '$lib/components/BucketTable.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import DailyFlowChart from '$lib/components/DailyFlowChart.svelte';
	import DailyFlowTable from '$lib/components/DailyFlowTable.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import MonthlyTotalsCard from '$lib/components/MonthlyTotalsCard.svelte';
	import SourcePicker from '$lib/components/SourcePicker.svelte';
	import Highlights from '$lib/components/Highlights.svelte';
	import RecurringList from '$lib/components/RecurringList.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import TransactionList from '$lib/components/TransactionList.svelte';
	import TransactionTable from '$lib/components/TransactionTable.svelte';
	import { formatCount, formatCurrency, formatSigned } from '$lib/format.js';
	import { StatementState } from '$lib/state/statement.svelte.js';
	import { buildHighlights } from '$lib/stats/highlights.js';

	const state = new StatementState();

	const insights = $derived(state.insights);
	const summary = $derived(insights.summary);
	const highlights = $derived(state.hasStatement ? buildHighlights(insights) : []);

	/** Read picked files one after another, so two drops cannot race. */
	async function accept(files: readonly File[]): Promise<void> {
		for (const file of files) await state.loadFile(file);
	}

	onMount(() => void state.restore());
</script>

<div class="shell">
	<header class="masthead">
		<div class="brand">
			<h1>Budgy</h1>
			<p>Bank statement insights, computed in your browser.</p>
		</div>

		<div class="masthead-actions">
			<ThemeToggle />
		</div>
	</header>

	<SourcePicker
		sources={state.sources}
		busy={state.busy}
		compact={state.hasStatement}
		onfiles={(files) => void accept(files)}
		onremove={(kind) => state.remove(kind)}
		onerror={(message) => (state.error = message)}
	/>

	{#if state.error}
		<p class="banner" role="alert">{state.error}</p>
	{/if}

	{#if !state.hasStatement}
		<section class="pitch">
			<h2>What you get</h2>
			<ul>
				<li>
					<strong>A balance line over time</strong> — see the month drain, transaction by transaction.
					The certified PDF prints a running balance beside every row, so this is real money rather than
					a shape.
				</li>
				<li><strong>Money in against money out</strong>, day by day.</li>
				<li><strong>Where it went</strong> — by category and by merchant.</li>
				<li>
					<strong>The charges that repeat</strong> — debit orders and subscriptions, totalled.
				</li>
				<li><strong>What the fees cost you</strong>, including fees for declined transactions.</li>
				<li>
					<strong>A written read from Claude</strong>, if you want one — the only part that sends
					anything anywhere, under your own API key, and only when you press the button.
				</li>
			</ul>
			<p class="privacy">
				Your files are read by this page and analysed in memory. There is no server, no upload and
				no account. Closing the tab forgets everything unless you ask it not to. The one exception
				is Ask Claude, which sends totals — never descriptions or account numbers — to Anthropic
				when you ask it to, and shows you exactly what it would send first.
			</p>
		</section>
	{:else}
		<div class="filters-row">
			<FilterBar {state} />
			<p class="source">
				{formatCount(summary.transactionCount, 'transaction')}
				{#if state.hasPdf && state.hasCsv}
					· {formatCount(state.matched, 'row')} matched across both files
				{:else if state.hasPdf}
					· balances from the certified statement
				{/if}
			</p>
		</div>

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

		<!-- The written read sits beside the computed one. Unlike everything above
		     it, this card can send figures off the device — so it asks first, and
		     shows what it would send. -->
		<AiInsightsCard {insights} />

		<div class="tiles">
			<StatTile label="Money in" value={formatCurrency(summary.income)} hint="Excludes transfers" />
			<StatTile
				label="Money out"
				value={formatCurrency(summary.expense)}
				hint="Excludes transfers"
			/>
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
				<DailyFlowChart days={insights.flow} monthly={insights.flowIsMonthly} />
			{/snippet}
			{#snippet table()}
				<DailyFlowTable days={insights.flow} monthly={insights.flowIsMonthly} />
			{/snippet}
		</ChartCard>

		<!-- Fed the account's transactions rather than the period-filtered slice:
		     a chart that compares months cannot be filtered down to one of them.
		     Its own controls, in the card, scope only itself. -->
		<MonthlyTotalsCard transactions={state.accountTransactions} focusMonth={state.focusMonth} />

		<div class="two-up">
			<ChartCard title="Where the money went" subtitle="Spending by category">
				{#snippet chart()}
					<BarList buckets={insights.categories} emptyMessage="No spending in this range." />
				{/snippet}
				{#snippet table()}
					<BucketTable buckets={insights.categories} heading="Category" />
				{/snippet}
			</ChartCard>

			<ChartCard title="Who you paid" subtitle="Spending by merchant">
				{#snippet chart()}
					<BarList buckets={insights.merchants} emptyMessage="No spending in this range." />
				{/snippet}
				{#snippet table()}
					<BucketTable buckets={insights.merchants} heading="Merchant" />
				{/snippet}
			</ChartCard>
		</div>

		<div class="two-up">
			<ChartCard
				title="Charges that repeat"
				subtitle="Debit orders, plus anything billing across two or more months"
			>
				{#snippet chart()}
					<RecurringList charges={insights.recurring} />
				{/snippet}
			</ChartCard>

			<ChartCard title="Biggest single hits" subtitle="The largest amounts to leave the account">
				{#snippet chart()}
					<TransactionList
						transactions={insights.largestExpenses}
						emptyMessage="No spending in this range."
					/>
				{/snippet}
			</ChartCard>
		</div>

		<ChartCard title="All transactions" subtitle="Search, sort and check the working">
			{#snippet chart()}
				<TransactionTable series={insights.balanceSeries} />
			{/snippet}
		</ChartCard>

		{#if state.issues.length > 0}
			<section class="issues">
				<h2>{formatCount(state.issues.length, 'note')} about reading these files</h2>
				<ul>
					{#each state.issues.slice(0, 10) as issue, index (index)}
						<li>{issue.reason}</li>
					{/each}
				</ul>
				{#if state.issues.length > 10}
					<p>…and {state.issues.length - 10} more.</p>
				{/if}
			</section>
		{/if}

		<footer>
			<label class="remember">
				<input
					type="checkbox"
					checked={state.remember}
					onchange={(event) => state.setRemember(event.currentTarget.checked)}
				/>
				<span>
					Keep these files in this browser
					<span class="hint">so a reload does not lose them. Off by default.</span>
				</span>
			</label>

			<button type="button" onclick={() => state.clear()}>Clear everything</button>
		</footer>
	{/if}
</div>

<style>
	.shell {
		max-width: 1120px;
		margin: 0 auto;
		padding: 28px 20px 64px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.masthead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	.brand p {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.masthead-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.banner {
		margin: 0;
		padding: 11px 14px;
		border: 1px solid var(--status-critical);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		color: var(--text-primary);
		font-size: 13px;
	}

	.pitch {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 22px 24px;
	}

	.pitch h2 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 600;
	}

	.pitch ul {
		margin: 0;
		padding-left: 20px;
		display: grid;
		gap: 7px;
		font-size: 14px;
		color: var(--text-secondary);
	}

	.pitch strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	.privacy {
		margin: 16px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-muted);
	}

	.filters-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.source {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
	}

	.two-up {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: 20px;
	}

	.issues {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 18px 20px;
	}

	.issues h2 {
		margin: 0 0 8px;
		font-size: 14px;
		font-weight: 600;
	}

	.issues ul {
		margin: 0;
		padding-left: 20px;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.issues p {
		margin: 8px 0 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}

	.remember {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.remember .hint {
		display: block;
		font-size: 12px;
		color: var(--text-muted);
	}

	footer button {
		padding: 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
		cursor: pointer;
	}

	footer button:hover {
		border-color: var(--status-critical);
	}
</style>
