<script lang="ts">
	import ChartCard from '$lib/components/ChartCard.svelte';
	import DebtTable from '$lib/components/DebtTable.svelte';
	import FetchCreditReport from '$lib/components/FetchCreditReport.svelte';
	import PayoffPlan from '$lib/components/PayoffPlan.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatCount, formatCurrency, formatDate } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';
	import { listPayees } from '$lib/stats/forecast.js';
	import type { PayoffDebt } from '$lib/stats/payoff.js';

	const statement = useStatement();
	const credit = statement.credit;

	const report = $derived(credit.latest);
	const open = $derived(credit.open);

	const owed = $derived(open.reduce((total, account) => total + account.balance, 0));
	const monthly = $derived(open.reduce((total, account) => total + account.instalment, 0));
	const arrears = $derived(open.reduce((total, account) => total + account.arrears, 0));

	/**
	 * Every payee money goes out to, across every account — a debt can be paid
	 * from any of them, and the picker should not depend on which one is selected.
	 */
	const payees = $derived(
		listPayees(statement.transactions, { monthStart: statement.monthStart })
			.filter((payee) => payee.flow === 'expense')
			.map((payee) => payee.merchant)
			.sort((a, b) => a.localeCompare(b))
	);

	const debts = $derived<readonly PayoffDebt[]>(
		open.map((account) => ({
			id: account.id,
			name: account.creditor,
			balance: account.balance,
			instalment: account.instalment,
			annualRate: credit.settings[account.id]?.rate ?? null
		}))
	);

	const linkSubtitle = $derived(
		statement.hasStatement
			? 'Enter each rate, and check which payment on your statement pays each one — a linked debt is counted once in the forecast, not twice'
			: 'Enter each rate. Open a statement and each debt is matched to the debit order that pays it, so the forecast counts it once'
	);
</script>

{#if report === null}
	<Card.Root class="[--card-spacing:--spacing(8)]">
		<Card.Content class="text-center">
			<h2 class="text-[15px] font-semibold">No credit report yet</h2>
			<p class="mx-auto mt-1.5 max-w-[52ch] text-sm text-muted-foreground">
				What you owe, what it takes each month and which debt to pay first appear here once your
				Finance365 credit report has been read.
			</p>
		</Card.Content>
	</Card.Root>

	<FetchCreditReport onreport={(next) => credit.accept(next)} />
{:else}
	<div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
		<div class="min-w-0">
			<h2 class="text-[15px] font-semibold">What you owe</h2>
			<p class="mt-0.5 text-[13px] text-muted-foreground">
				{formatCount(open.length, 'open debt')} on the report dated {formatDate(report.reportDate)}.
				A bureau runs a month or two behind, so a balance may already be lower.
			</p>
		</div>
		<Button variant="outline" size="sm" class="text-[13px]" onclick={() => credit.clear()}>
			Forget my credit report
		</Button>
	</div>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
		<StatTile label="Owed in all" value={formatCurrency(owed)} />
		<StatTile label="Instalments each month" value={formatCurrency(monthly)} />
		<StatTile
			label="In arrears"
			value={formatCurrency(arrears)}
			tone={arrears > 0 ? 'critical' : 'neutral'}
			hint={arrears > 0
				? 'Costing fees and your record now — clear these first'
				: 'Nothing overdue'}
		/>
	</div>

	<ChartCard title="Your debts" subtitle={linkSubtitle}>
		{#snippet chart()}
			<DebtTable
				accounts={open}
				matches={statement.debtMatches}
				settings={credit.settings}
				{payees}
				onrate={(id, rate) => credit.setRate(id, rate)}
				onday={(id, day) => credit.setPaymentDay(id, day)}
				onlink={(id, merchant) => credit.link(id, merchant)}
				onunlink={(id) => credit.unlink(id)}
				onignore={(id) => credit.setIgnored(id, true)}
			/>
			{#if credit.ignored.length > 0}
				<p class="mt-3 flex flex-wrap items-center gap-x-2 border-t pt-3 text-xs text-faint">
					<span>Left out:</span>
					{#each credit.ignored as account (account.id)}
						<Button
							variant="ghost"
							size="sm"
							class="h-6 px-1.5 text-xs"
							onclick={() => credit.setIgnored(account.id, false)}
						>
							{account.creditor} — count again
						</Button>
					{/each}
				</p>
			{/if}
		{/snippet}
	</ChartCard>

	{#if debts.length > 0}
		<ChartCard
			title="Which to pay first"
			subtitle="The same instalments, plus whatever you can spare — each cleared debt's instalment rolls on to the next"
		>
			{#snippet chart()}
				<PayoffPlan
					{debts}
					extra={credit.extra}
					from={report.reportDate}
					onextra={(extra) => credit.setExtra(extra)}
				/>
			{/snippet}
		</ChartCard>
	{/if}

	<!-- Last, once there is a report: bringing in a newer one is occasional, and
	     the debts are what the page is for. -->
	<FetchCreditReport onreport={(next) => credit.accept(next)} />
{/if}
