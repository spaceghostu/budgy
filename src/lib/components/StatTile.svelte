<script lang="ts">
	interface Props {
		label: string;
		value: string;
		hint?: string;
		/** Colour the value only when the number genuinely means good or bad. */
		tone?: 'neutral' | 'good' | 'critical';
	}

	const { label, value, hint, tone = 'neutral' }: Props = $props();
</script>

<div class="tile">
	<p class="label">{label}</p>
	<p class="value" class:good={tone === 'good'} class:critical={tone === 'critical'}>{value}</p>
	{#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
	.tile {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		padding: 16px 18px;
		min-width: 0;
	}

	p {
		margin: 0;
	}

	.label {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.value {
		margin-top: 6px;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
		/* Proportional figures: tabular-nums reads loose at this size. */
	}

	.value.good {
		color: var(--status-good-text);
	}

	.value.critical {
		color: var(--status-critical);
	}

	.hint {
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
