<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import MonthStartPicker from '$lib/components/MonthStartPicker.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { formatCount } from '$lib/format.js';
	import { provideStatement } from '$lib/state/context.js';

	let { children } = $props();

	/**
	 * Made here, once, and taken from context by every page.
	 *
	 * The statement outlives the route: moving from Spending to Transactions is
	 * a different question about the same money, not a reason to re-read a
	 * 90-page PDF.
	 */
	const state = provideStatement();

	onMount(() => void state.restore());

	/**
	 * The filter row sits above the pages it scopes, not inside them — the
	 * period and account are one choice, and every page answers to it.
	 *
	 * Three pages are exceptions. History lists statements, and a date range
	 * within one of them says nothing about the others. Net worth is a level
	 * across every account, which needs the whole chain behind it — scoping it
	 * to one account or one month asks a different question. Forecast keeps the
	 * account and drops the period: it is learned from the months either side of
	 * the one it is about, so a period would scope away its own evidence.
	 */
	const filterScope = $derived.by((): 'full' | 'account' | 'none' => {
		const path = page.url.pathname;
		if (path.startsWith('/history') || path.startsWith('/net-worth')) return 'none';

		return path.startsWith('/forecast') ? 'account' : 'full';
	});

	/** An account picker with one account in it is not worth a row of its own. */
	const showFilters = $derived(
		state.hasStatement &&
			(filterScope === 'full' || (filterScope === 'account' && state.accounts.length > 1))
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Budgy — bank statement insights</title>

	<meta
		name="description"
		content="Turn a bank statement CSV into a balance chart and spending insights, entirely in your browser."
	/>
</svelte:head>

<div class="mx-auto flex max-w-280 flex-col gap-5 px-5 pt-7 pb-16">
	<header class="flex flex-col gap-3">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-[22px] font-bold tracking-[-0.03em]">
					<a href={resolve('/')} class="hover:text-series">Budgy</a>
				</h1>
				<p class="mt-0.5 text-[13px] text-muted-foreground">
					Bank statement insights, computed in your browser.
				</p>
			</div>

			<div class="flex items-center gap-2.5">
				<!-- Beside the theme, not in the filter row: what a month is answers for
				     every page, including the two the filters do not scope. -->
				{#if state.hasStatement}
					<MonthStartPicker {state} />
				{/if}
				<ThemeToggle />
			</div>
		</div>

		<div class="border-b pb-1">
			<SiteNav savedCount={state.library.count} />
		</div>
	</header>

	{#if state.error}
		<Alert.Root variant="destructive" class="border-destructive text-[13px]">
			<Alert.Description class="text-destructive">{state.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if state.library.error}
		<Alert.Root class="text-[13px]">
			<Alert.Description class="text-muted-foreground">{state.library.error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if showFilters}
		<div class="flex flex-wrap items-end justify-between gap-4">
			<FilterBar {state} scope={filterScope === 'account' ? 'account' : 'full'} />
			<!-- Counted over the selected period, so it is only said where a period
			     is in force — beside a page that ignores one it would contradict
			     every figure under it. -->
			{#if filterScope === 'full'}
				<p class="text-xs text-faint">
					{formatCount(state.insights.summary.transactionCount, 'transaction')}
					{#if state.hasPdf && state.hasCsv}
						· {formatCount(state.matched, 'row')} matched across both files
					{:else if state.hasPdf}
						· balances from the certified statement
					{/if}
				</p>
			{/if}
		</div>
	{/if}

	{@render children()}
</div>
