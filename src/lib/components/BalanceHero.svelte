<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';
	import { CURRENCY_SYMBOL, formatCurrency, formatDate, formatSigned } from '../format.ts';
	import { parseAmount } from '../parse/statement.ts';
	import type { PeriodSummary } from '../types.ts';

	interface Props {
		summary: PeriodSummary;
		/** True while no real balance has been supplied — the figure is net change. */
		isRelative: boolean;
		anchor: number;
		/** True when the bank printed the balances, so nothing needs anchoring. */
		isCertified?: boolean;
		/** True when a stored anchor no longer matches this statement's last date. */
		isStale?: boolean;
		account?: string;
		onanchor: (balance: number | null) => void;
	}

	const {
		summary,
		isRelative,
		anchor,
		isCertified = false,
		isStale = false,
		account = '',
		onanchor
	}: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let invalid = $state(false);

	function open(): void {
		draft = isRelative ? '' : `${anchor}`;
		invalid = false;
		editing = true;
	}

	function commit(event: SubmitEvent): void {
		event.preventDefault();

		const trimmed = draft.trim();
		if (trimmed === '') {
			onanchor(null);
			editing = false;
			return;
		}

		// The statement parser already reads every separator convention a South
		// African keyboard produces — "4820,55" and "4 820.55" both mean the same
		// balance, and getting this wrong would silently skew every figure.
		const parsed = parseAmount(trimmed);
		if (parsed === null) {
			invalid = true;
			return;
		}

		invalid = false;
		onanchor(parsed);
		editing = false;
	}
</script>

<Card.Root class="[--card-spacing:--spacing(6)]">
	<Card.Content class="flex flex-wrap items-start justify-between gap-6">
		<div>
			<p class="text-[13px] text-muted-foreground">
				{isRelative ? 'Net change over this period' : 'Balance at the end of this period'}
			</p>
			<!-- Proportional figures — tabular digits look loose at display size. -->
			<p class="mt-1 text-[40px]/[1.05] font-semibold tracking-[-0.03em] min-[620px]:text-[52px]">
				{formatCurrency(isRelative ? summary.balanceChange : summary.closingBalance)}
			</p>
			<p class="mt-2 text-[13px] text-muted-foreground">
				{formatDate(summary.from)} – {formatDate(summary.to)} ·
				{formatSigned(summary.balanceChange)} over {summary.days}
				{summary.days === 1 ? 'day' : 'days'}
			</p>
		</div>

		<div class="max-w-[34ch]">
			{#if isCertified}
				<!-- The certified statement prints a balance on every row, so there is
				     nothing to anchor and nothing for the reader to do here. -->
				<p class="flex items-start gap-2 text-[12.5px] text-muted-foreground">
					<span
						class="grid size-4.5 flex-none place-items-center rounded-full bg-good text-card"
						aria-hidden="true"
					>
						<CheckIcon class="size-2.5" />
					</span>
					<span>
						Balances come from the certified statement{account === '' ? '' : ` for ${account}`}, and
						every one was checked against the row before it.
					</span>
				</p>
			{:else if editing}
				<form onsubmit={commit}>
					<Label for="anchor-input" class="text-xs text-muted-foreground">
						Your current balance
					</Label>
					<div class="mt-1.5 flex items-center gap-1.5">
						<span class="text-faint">{CURRENCY_SYMBOL}</span>
						<Input
							id="anchor-input"
							type="text"
							inputmode="decimal"
							placeholder="12500.00"
							class="w-32 text-[13px] tabular-nums aria-invalid:border-destructive"
							aria-invalid={invalid}
							aria-describedby="anchor-help"
							bind:value={draft}
							autofocus
						/>
						<Button type="submit" variant="secondary" class="border-input font-semibold">
							Save
						</Button>
						<Button variant="outline" class="border-input" onclick={() => (editing = false)}>
							Cancel
						</Button>
					</div>
					<p
						id="anchor-help"
						class={cn('mt-2 text-xs', invalid ? 'text-destructive' : 'text-faint')}
					>
						{#if invalid}
							That is not a number this can read. Try something like 4820.55 or 4820,55.
						{:else}
							The figure from your banking app, as of the most recent transaction in this statement.
							Leave it empty to go back to showing net change. Stored only in this browser.
						{/if}
					</p>
				</form>
			{:else}
				<Button variant="secondary" class="border-input font-semibold" onclick={open}>
					{isRelative ? 'Set your current balance' : 'Change balance'}
				</Button>
				<p class="mt-2 text-xs text-faint">
					{#if isStale}
						This statement runs to {formatDate(summary.to)}, later than the balance you last entered
						— re-enter it to make these figures real again.
					{:else if isRelative}
						A CSV export lists amounts but no balances. Add yours and every figure becomes real.
					{:else}
						Anchored to {formatCurrency(anchor)} after the most recent transaction.
					{/if}
				</p>
			{/if}
		</div>
	</Card.Content>
</Card.Root>
