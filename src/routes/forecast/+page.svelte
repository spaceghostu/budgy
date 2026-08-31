<script lang="ts">
	import AddCharge from '$lib/components/AddCharge.svelte';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import ExpectedPayments from '$lib/components/ExpectedPayments.svelte';
	import MonthStartPicker from '$lib/components/MonthStartPicker.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import RunwayChart from '$lib/components/RunwayChart.svelte';
	import RunwayTable from '$lib/components/RunwayTable.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import { formatCount, formatCurrency, formatDate, formatOrdinal } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';
	import { isCalendarStart } from '$lib/stats/cycle.js';
	import {
		buildForecast,
		listPayees,
		DEFAULT_WINDOW,
		FORECAST_WINDOWS,
		type ForecastWindow
	} from '$lib/stats/forecast.js';
	import { buildRunway } from '$lib/stats/runway.js';

	const statement = useStatement();

	let learnFrom = $state<ForecastWindow>(DEFAULT_WINDOW);
	/** Which past month the offers are read from. Blank means the last one. */
	let offerFrom = $state('');

	/**
	 * Built from the account's whole history rather than the period-filtered
	 * slice: a forecast is learned from the months either side of the one it is
	 * about, so it cannot be scoped to that one month. The period row is hidden
	 * on this page for the same reason.
	 *
	 * Always net. This page draws a balance, and there is no money-out-only
	 * reading of what is left in an account.
	 */
	const forecast = $derived(
		buildForecast(statement.accountTransactions, {
			metric: 'net',
			window: learnFrom,
			excluded: statement.droppedCharges,
			added: statement.addedCharges,
			candidateMonth: offerFrom,
			monthStart: statement.monthStart
		})
	);

	/**
	 * The line, the tiles and the list all read from this one call, so they
	 * cannot come to different conclusions about the same month.
	 */
	const runway = $derived(
		buildRunway(forecast, {
			balance: statement.balanceNow,
			monthStart: statement.monthStart
		})
	);

	/**
	 * Offered only where the two windows would read different months. With three
	 * whole months behind it, "last 3" and "last 6" are the same three.
	 */
	const canChooseWindow = $derived(forecast.monthsAvailable > Math.min(...FORECAST_WINDOWS));

	/**
	 * The payees the "add a payment" form offers, read the way the forecast will
	 * read them — so a figure beside a name is the figure it is added for.
	 */
	const payees = $derived(
		listPayees(statement.accountTransactions, {
			window: learnFrom,
			monthStart: statement.monthStart
		})
	);

	const relative = $derived(statement.balanceNowIsRelative);

	/** What the balance tile can honestly be called. */
	const balanceLabel = $derived(relative ? 'Starting from' : 'In the account now');

	/**
	 * Running out is a claim about money, and without a balance behind it there
	 * is no money to run out of.
	 *
	 * A line anchored at zero goes under on the first day anything is spent, and
	 * an alarm raised on that would be raised for every reader who has not
	 * entered a balance — which is the surest way to teach them to ignore the one
	 * that matters. The chart makes the same distinction with its waterline.
	 */
	const shortfall = $derived(relative ? null : runway.shortfall);

	/** The one sentence the page exists to say. */
	const headline = $derived.by(() => {
		if (runway.isComplete) {
			return `${formatDate(runway.payday)} is payday — this month is banked, and the next one has not opened yet.`;
		}
		// Asked before the shortfall, not after: with no balance the line starts at
		// zero and every reader is "short", which would make the warning worthless.
		if (relative) {
			return `${formatCount(runway.daysLeft, 'day')} to payday on ${formatDate(runway.payday)}. Set your current balance on the overview to read this line as money rather than as change.`;
		}
		if (shortfall !== null) {
			return `On this month's figures the money runs out on ${formatDate(shortfall.date)}, ${formatCount(daysUntil(shortfall.date), 'day')} before payday.`;
		}

		return `${formatCount(runway.daysLeft, 'day')} to payday on ${formatDate(runway.payday)}, with ${formatCurrency(runway.lowest?.balance ?? 0)} expected at the thinnest.`;
	});

	const subtitle = $derived(
		runway.isComplete
			? 'The month is over — every figure below is banked'
			: `From ${formatDate(runway.from)}, where the statement stops, to ${formatDate(runway.to)} — the last day before payday`
	);

	/** Says which months named these charges, since the reader can change it. */
	const dueSubtitle = $derived(
		forecast.monthsOfHistory === 0
			? 'Charges the history names, on the days they usually land — add anything it missed'
			: `Charges the last ${formatCount(forecast.monthsOfHistory, 'complete month')} name, on the days they usually land — add anything the test missed`
	);

	/** Whole days from the statement's last day to a date on the line. */
	function daysUntil(date: string): number {
		const from = Date.parse(`${date}T00:00:00Z`);
		const to = Date.parse(`${runway.payday}T00:00:00Z`);

		return Math.max(Math.round((to - from) / 86_400_000), 0);
	}
</script>

{#if !statement.hasStatement}
	<NoStatement what="How far the money goes" savedCount={statement.library.count} />
{:else}
	<div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
		<div class="min-w-0">
			<h2 class="text-[15px] font-semibold">Between now and payday</h2>
			<p class="mt-0.5 text-[13px] text-muted-foreground">{headline}</p>
		</div>

		<!-- Payday is the day a month opens on, and it is the one setting this
		     whole page hangs off — so it is settable here rather than only where
		     the months are drawn. -->
		<div class="flex flex-none flex-col gap-1.5">
			<span class="text-xs text-muted-foreground">Payday</span>
			<MonthStartPicker state={statement} />
		</div>
	</div>

	{#if shortfall !== null}
		<Alert.Root variant="destructive" class="border-destructive text-[13px]">
			<Alert.Title class="font-semibold">
				Short by {formatCurrency(Math.abs(runway.lowest?.balance ?? 0))} before payday
			</Alert.Title>
			<Alert.Description class="text-destructive/90">
				The balance is expected to go under on {formatDate(shortfall.date)} and to be at its lowest on
				{formatDate(runway.lowest?.date ?? shortfall.date)}. Tick off anything below that is not
				really coming, or add what the history missed.
			</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
		<StatTile
			label={balanceLabel}
			value={formatCurrency(runway.opening)}
			hint={runway.isComplete
				? formatDate(runway.from)
				: `${formatCount(runway.daysLeft, 'day')} to payday`}
		/>
		<StatTile
			label="Still to leave"
			value={formatCurrency(runway.committedOut + runway.everyday)}
			hint={runway.payments.length === 0
				? `${formatCurrency(runway.everyday)} of everyday spending`
				: `${formatCount(runway.payments.filter((payment) => payment.flow === 'expense').length, 'named charge')}, plus ${formatCurrency(runway.everyday)} everyday`}
		/>
		<StatTile
			label="Lowest before payday"
			value={formatCurrency(runway.lowest?.balance ?? runway.opening)}
			tone={!relative && (runway.lowest?.balance ?? 0) < 0 ? 'critical' : 'neutral'}
			hint={runway.lowest === null ? 'Nothing left to project' : formatDate(runway.lowest.date)}
		/>
		<StatTile
			label="At payday"
			value={formatCurrency(runway.closing)}
			tone={relative
				? 'neutral'
				: runway.closing < 0
					? 'critical'
					: runway.closing > runway.opening
						? 'good'
						: 'neutral'}
			hint={runway.committedIn > 0
				? `${formatCurrency(runway.committedIn)} still expected in`
				: 'Before the next month opens'}
		/>
	</div>

	<ChartCard title="How far the money goes" {subtitle}>
		{#snippet toolbar()}
			{#if canChooseWindow}
				<!-- Both the line and the list answer to this, so it sits on the
				     toolbar row rather than beside one of them. -->
				<div class="flex min-w-0 flex-col gap-1.5">
					<span id="forecast-window" class="text-xs text-muted-foreground">Learn from</span>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						aria-labelledby="forecast-window"
						value={`${learnFrom}`}
						onValueChange={(next) => {
							// Some history is always read, so the group cannot be emptied.
							if (next) learnFrom = Number(next) as ForecastWindow;
						}}
					>
						{#each FORECAST_WINDOWS as option (option)}
							<ToggleGroupItem value={`${option}`} class="text-[13px]">
								Last {option} months
							</ToggleGroupItem>
						{/each}
					</ToggleGroup>
				</div>
			{/if}

			{#if isCalendarStart(statement.monthStart)}
				<p class="max-w-100 pb-1 text-xs text-faint">
					Payday is taken as the 1st. If you are paid on another day, set it above and the whole
					line moves with it.
				</p>
			{:else}
				<p class="pb-1 text-xs text-faint">
					Paid on the {formatOrdinal(statement.monthStart)}.
				</p>
			{/if}
		{/snippet}

		{#snippet chart()}
			<RunwayChart {runway} isRelative={relative} monthStart={statement.monthStart} />
		{/snippet}
		{#snippet table()}
			<RunwayTable {runway} />
		{/snippet}
	</ChartCard>

	<ChartCard title="What the line is spending" subtitle={dueSubtitle}>
		{#snippet actions()}
			<AddCharge
				{payees}
				monthStart={statement.monthStart}
				month={forecast.month}
				onadd={(charge) => statement.addCharge(charge)}
			/>
		{/snippet}
		{#snippet chart()}
			<ExpectedPayments
				{forecast}
				remembered={statement.droppedCharges.length}
				ontoggle={(key, include) =>
					include ? statement.setChargeCounted(key, true) : statement.stopCounting(key)}
				onvouch={(payment) =>
					statement.addCharge({
						kind: 'merchant',
						merchant: payment.merchant,
						flow: payment.flow
					})}
				onclear={() => statement.clearDroppedCharges()}
				onremove={(key) => statement.removeCharge(key)}
				onmonth={(month) => (offerFrom = month)}
			/>
		{/snippet}
	</ChartCard>
{/if}
