<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';

	interface Props {
		title: string;
		subtitle?: string;
		/** The visual view. */
		chart: Snippet;
		/** The WCAG-clean twin — every value the chart shows, as text. */
		table?: Snippet;
		/** Optional extra controls rendered beside the view toggle. */
		actions?: Snippet;
		/**
		 * Controls that change what both views show, on their own row above them.
		 * Wider than {@link actions} allows, and rendered for the table too, since
		 * a control the table ignored would leave the two views disagreeing.
		 */
		toolbar?: Snippet;
	}

	const { title, subtitle, chart, table, actions, toolbar }: Props = $props();

	let view = $state<'chart' | 'table'>('chart');
	const id = $props.id();
</script>

<Card.Root role="region" aria-labelledby="{id}-title" class="min-w-0 [--card-spacing:--spacing(5)]">
	<Card.Header>
		<Card.Title id="{id}-title" class="text-[15px] font-semibold tracking-[-0.01em]">
			{title}
		</Card.Title>
		{#if subtitle}
			<Card.Description class="text-[13px]">{subtitle}</Card.Description>
		{/if}

		<Card.Action class="flex items-center gap-2">
			{@render actions?.()}
			{#if table}
				<ToggleGroup
					type="single"
					variant="outline"
					size="sm"
					aria-label="{title} view"
					value={view}
					onValueChange={(next) => {
						// A group that can be emptied would leave the card blank.
						if (next) view = next as 'chart' | 'table';
					}}
				>
					<ToggleGroupItem value="chart">Chart</ToggleGroupItem>
					<ToggleGroupItem value="table">Table</ToggleGroupItem>
				</ToggleGroup>
			{/if}
		</Card.Action>
	</Card.Header>

	{#if toolbar}
		<div class="flex flex-wrap items-end gap-x-[18px] gap-y-2.5 border-b px-(--card-spacing) pb-4">
			{@render toolbar()}
		</div>
	{/if}

	<Card.Content class="min-w-0">
		{#if view === 'chart' || !table}
			{@render chart()}
		{:else}
			{@render table()}
		{/if}
	</Card.Content>
</Card.Root>
