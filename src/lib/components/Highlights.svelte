<script lang="ts">
	import DotIcon from '@lucide/svelte/icons/dot';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { Component } from 'svelte';
	import { cn } from '$lib/utils.js';
	import type { Highlight } from '../stats/highlights.ts';

	interface Props {
		highlights: readonly Highlight[];
	}

	const { highlights }: Props = $props();

	/** Status never rides on colour alone — every tone ships an icon and a label. */
	const MARKER: Record<Highlight['tone'], { icon: Component; label: string; class: string }> = {
		neutral: { icon: DotIcon, label: 'Note', class: 'bg-faint text-card' },
		good: { icon: TrendingUpIcon, label: 'Good', class: 'bg-good text-card' },
		warning: { icon: TriangleAlertIcon, label: 'Watch', class: 'bg-warning text-[#0b0b0b]' }
	};
</script>

{#if highlights.length > 0}
	<ul class="grid list-none gap-2.5 p-0">
		{#each highlights as highlight (highlight.id)}
			{@const marker = MARKER[highlight.tone]}
			{@const Icon = marker.icon}
			<li class="flex items-start gap-2.5 rounded-md border bg-card px-3.5 py-3">
				<span
					class={cn('grid size-5 flex-none place-items-center rounded-full', marker.class)}
					aria-hidden="true"
				>
					<Icon class="size-3" />
				</span>
				<span class="sr-only">{marker.label}:</span>
				<p class="text-[13.5px] text-muted-foreground">{highlight.text}</p>
			</li>
		{/each}
	</ul>
{/if}
