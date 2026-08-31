<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';

	interface Props {
		label: string;
		value: string;
		hint?: string;
		/** Colour the value only when the number genuinely means good or bad. */
		tone?: 'neutral' | 'good' | 'critical';
	}

	const { label, value, hint, tone = 'neutral' }: Props = $props();
</script>

<Card.Root class="@container min-w-0 gap-0 px-0.5 [--card-spacing:--spacing(4)]">
	<Card.Content>
		<p class="text-xs text-muted-foreground">{label}</p>
		<!-- Held on one line — a currency figure broken across two is unreadable —
		     and sized to the tile, so a seven-figure balance still fits. -->
		<p
			class="mt-1.5 text-[clamp(1rem,11cqi,1.5rem)] font-semibold tracking-[-0.02em] whitespace-nowrap"
			class:text-positive={tone === 'good'}
			class:text-destructive={tone === 'critical'}
		>
			<!-- Proportional figures: tabular-nums reads loose at this size. -->
			{value}
		</p>
		{#if hint}<p class="mt-1 text-xs text-faint">{hint}</p>{/if}
	</Card.Content>
</Card.Root>
