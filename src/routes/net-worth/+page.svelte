<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import NetWorthCard from '$lib/components/NetWorthCard.svelte';
	import NetWorthTrendCard from '$lib/components/NetWorthTrendCard.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import StatTile from '$lib/components/StatTile.svelte';
	import { formatCount, formatCurrency, formatSigned } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';

	const state = useStatement();
	const worth = $derived(state.netWorth);

	/** What the whole history added up to on its first day, and its last. */
	const change = $derived(worth.total - worth.opening);
</script>

{#if !state.hasStatement}
	<NoStatement what="What you are worth across every account" savedCount={state.library.count} />
{:else}
	{#if worth.unanchored.length > 0}
		<!-- Named rather than hinted at: a total that silently treats an unknown
		     account as empty is exactly the number a reader would trust and should
		     not. The fix is one field away, so it is spelled out. -->
		<Alert.Root class="text-[13px]">
			<Alert.Description class="text-muted-foreground">
				{formatCount(worth.unanchored.length, 'account')} here — {worth.unanchored.join(', ')} — printed
				no balance and none has been entered, so this line is a shape rather than money. To fix it, pick
				the account on the
				<a href={resolve('/')} class="underline underline-offset-2 hover:text-foreground">
					Overview
				</a>
				page and enter its current balance; the figure is remembered for this statement.
			</Alert.Description>
		</Alert.Root>
	{/if}

	<div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
		<!-- Left out entirely while an account is unanchored, rather than shown as
		     a figure with a caveat beside it: a number this size is read before the
		     hint under it, and the change below is true either way. -->
		{#if !worth.isRelative}
			<StatTile
				label="Net worth"
				value={formatCurrency(worth.total)}
				hint="Across {formatCount(worth.accounts.length, 'account')}"
			/>
		{/if}
		<StatTile
			label="Change over the history"
			value={formatSigned(change)}
			tone={change >= 0 ? 'good' : 'critical'}
			hint="Since the first transaction"
		/>
		{#each worth.accounts as account (account.account)}
			<StatTile
				label={account.account}
				value={formatCurrency(account.closing)}
				hint={account.isCertified
					? 'Printed by the bank'
					: account.isAnchored
						? 'From the balance you entered'
						: 'Net change only — no balance set'}
			/>
		{/each}
	</div>

	<!-- Fed the whole statement rather than the filtered slice, which is why the
	     period and account row is not on this page: net worth is a level, and a
	     level cut down to one account or one month is a different question. -->
	<NetWorthCard {worth} focusMonth={state.focusMonth} monthStart={state.monthStart} />

	<!-- The same money read the other way. The card above folds the history onto
	     one month so the months can be compared; this one leaves it laid out end
	     to end, which is the shape a reader means by "over time". -->
	<NetWorthTrendCard {worth} monthStart={state.monthStart} />
{/if}
