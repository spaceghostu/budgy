<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import CategoryPicker from './CategoryPicker.svelte';
	import type { AppliedRule, MerchantGroup } from '../categorise.ts';
	import { formatCount, formatCurrency, formatDate } from '../format.ts';

	interface Props {
		/** Merchants still without a category, heaviest first. */
		pending: readonly MerchantGroup[];
		/** The choices already made, whether or not this period shows them. */
		applied: readonly AppliedRule[];
		options: readonly string[];
		/** The categories last chosen, most recent first — the picker's shortlist. */
		recent?: readonly string[];
		/** A blank takes the merchant's choice back off again. */
		onassign: (merchant: string, category: string) => void;
	}

	const { pending, applied, options, recent = [], onassign }: Props = $props();

	/**
	 * Merchants shown before the "show all" control appears.
	 *
	 * Heaviest first, so the few that carry most of the unfiled money are the
	 * ones on screen: a real export left 266 rows unfiled across 86 merchants,
	 * and the top handful of those was most of the money.
	 */
	const PAGE_SIZE = 8;

	let expanded = $state(false);

	const visible = $derived(expanded ? pending : pending.slice(0, PAGE_SIZE));
	const total = $derived(pending.reduce((sum, group) => sum + group.total, 0));

	const quietButton =
		'border-input text-muted-foreground hover:border-series hover:text-foreground';
</script>

{#if pending.length > 0}
	<p class="text-[13px] text-muted-foreground">
		{formatCurrency(total)} across {formatCount(pending.length, 'merchant')} has no category, so the breakdowns
		cannot place it. Choosing one files every transaction from that merchant — in this statement and in
		next month's.
	</p>

	<ul class="mt-3.5 flex list-none flex-col p-0">
		{#each visible as group (group.merchant)}
			<li
				class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b py-2.5 first:border-t"
			>
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="truncate text-[13px]" title={group.merchant}>{group.merchant}</span>
					<span class="text-xs text-faint">
						{formatCount(group.count, 'transaction')} · {formatCurrency(group.total)} · last
						{formatDate(group.lastSeen)}
					</span>
					<!-- The merchant name is the description with its reference numbers
					     stripped, which can leave a code. The line it came from says more. -->
					{#if group.example !== '' && group.example !== group.merchant}
						<span class="max-w-[42ch] truncate text-xs text-faint" title={group.example}>
							{group.example}
						</span>
					{/if}
				</div>

				<div class="flex flex-none items-center gap-2 max-[560px]:w-full">
					<!-- Where the same merchant is filed elsewhere in the statement — the
					     usual case for a row the two files could not match — that answer
					     is one press away rather than a hunt through the list. -->
					{#if group.suggestion !== null}
						{@const suggestion = group.suggestion}
						<Button
							variant="outline"
							size="xs"
							class={quietButton}
							onclick={() => onassign(group.merchant, suggestion)}
						>
							Use {suggestion}
						</Button>
					{/if}

					<CategoryPicker merchant={group.merchant} {options} {recent} {onassign} />
				</div>
			</li>
		{/each}
	</ul>

	{#if pending.length > PAGE_SIZE}
		<Button
			variant="outline"
			size="xs"
			class="mt-3 {quietButton}"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? 'Show fewer' : `Show all ${pending.length}`}
		</Button>
	{/if}
{:else}
	<p class="py-2 text-[13px] text-muted-foreground">
		Every transaction in this period is filed under something.
	</p>
{/if}

{#if applied.length > 0}
	<section class="mt-5 border-t pt-4">
		<h3 class="text-[13px] font-semibold">Your categories</h3>
		<p class="text-[13px] text-muted-foreground">
			Kept on this device, and applied to every statement you open here.
		</p>

		<ul class="mt-3.5 flex list-none flex-col p-0">
			{#each applied as rule (rule.merchant)}
				<li class="flex items-center gap-2.5 py-1.5">
					<span class="min-w-0 flex-1 truncate text-[13px]" title={rule.merchant}>
						{rule.merchant}
					</span>

					<CategoryPicker
						merchant={rule.merchant}
						current={rule.category}
						{options}
						{recent}
						{onassign}
					/>

					<span class="flex-none text-right text-xs text-faint max-[560px]:hidden">
						{rule.count === 0 ? 'nothing in these files' : formatCount(rule.count, 'transaction')}
					</span>

					<Button
						variant="ghost"
						size="icon-xs"
						class="flex-none text-faint hover:border-destructive hover:text-foreground"
						aria-label="Clear the choice for {rule.merchant}"
						onclick={() => onassign(rule.merchant, '')}
					>
						<XIcon aria-hidden="true" />
					</Button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
