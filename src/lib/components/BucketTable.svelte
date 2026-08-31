<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatCurrency, formatPercent } from '../format.ts';
	import type { Bucket } from '../types.ts';

	interface Props {
		buckets: readonly Bucket[];
		heading: string;
		/**
		 * Opens the rows behind a bucket. The chart's twin takes the same handler,
		 * or reading the figures as text would cost the reader the way in.
		 */
		onselect?: (label: string) => void;
	}

	const { buckets, heading, onselect }: Props = $props();

	/** Sticky so the headings stay readable while a long list scrolls under them. */
	const head = 'sticky top-0 z-10 h-auto bg-card px-2.5 pb-2 text-xs text-muted-foreground';
	const numeric = 'text-right tabular-nums';
</script>

<div class="max-h-105 overflow-y-auto">
	<Table.Root class="text-[13px]">
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={head}>{heading}</Table.Head>
				<Table.Head class="{head} {numeric}">Total</Table.Head>
				<Table.Head class="{head} {numeric}">Count</Table.Head>
				<Table.Head class="{head} {numeric}">Share</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each buckets as bucket (bucket.label)}
				<Table.Row>
					<Table.Cell class="px-2.5">
						{#if onselect}
							<button
								type="button"
								class="cursor-pointer text-left hover:text-series hover:underline"
								onclick={() => onselect(bucket.label)}
							>
								{bucket.label}<span class="sr-only"> — open the transactions behind it</span>
							</button>
						{:else}
							{bucket.label}
						{/if}
					</Table.Cell>
					<Table.Cell class="px-2.5 {numeric}">{formatCurrency(bucket.total)}</Table.Cell>
					<Table.Cell class="px-2.5 {numeric}">{bucket.count}</Table.Cell>
					<Table.Cell class="px-2.5 {numeric}">{formatPercent(bucket.share)}</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row class="hover:bg-transparent">
					<Table.Cell colspan={4} class="py-7 text-center text-faint">Nothing to show.</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
