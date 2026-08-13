<script lang="ts">
	import type { Highlight } from '../stats/highlights.ts';

	interface Props {
		highlights: readonly Highlight[];
	}

	const { highlights }: Props = $props();

	/** Status never rides on colour alone — every tone ships an icon and a label. */
	const MARKER: Record<Highlight['tone'], { symbol: string; label: string }> = {
		neutral: { symbol: '•', label: 'Note' },
		good: { symbol: '↑', label: 'Good' },
		warning: { symbol: '!', label: 'Watch' }
	};
</script>

{#if highlights.length > 0}
	<ul>
		{#each highlights as highlight (highlight.id)}
			<li class={highlight.tone}>
				<span class="marker" aria-hidden="true">{MARKER[highlight.tone].symbol}</span>
				<span class="sr-only">{MARKER[highlight.tone].label}:</span>
				<p>{highlight.text}</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 12px 14px;
	}

	p {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-secondary);
	}

	.marker {
		flex: none;
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
		color: var(--surface-1);
		background: var(--text-muted);
	}

	li.good .marker {
		background: var(--status-good);
	}

	li.warning .marker {
		background: var(--status-warning);
		color: #0b0b0b;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
