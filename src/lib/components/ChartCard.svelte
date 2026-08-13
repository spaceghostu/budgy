<script lang="ts">
	import type { Snippet } from 'svelte';

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

<section class="card" aria-labelledby="{id}-title">
	<header>
		<div class="heading">
			<h2 id="{id}-title">{title}</h2>
			{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		</div>

		<div class="controls">
			{@render actions?.()}
			{#if table}
				<div class="toggle" role="group" aria-label="{title} view">
					<button
						type="button"
						class:selected={view === 'chart'}
						aria-pressed={view === 'chart'}
						onclick={() => (view = 'chart')}>Chart</button
					>
					<button
						type="button"
						class:selected={view === 'table'}
						aria-pressed={view === 'table'}
						onclick={() => (view = 'table')}>Table</button
					>
				</div>
			{/if}
		</div>
	</header>

	{#if toolbar}
		<div class="toolbar">{@render toolbar()}</div>
	{/if}

	<div class="body">
		{#if view === 'chart' || !table}
			{@render chart()}
		{:else}
			{@render table()}
		{/if}
	</div>
</section>

<style>
	.card {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		padding: 20px;
		min-width: 0;
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}

	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.subtitle {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.toggle button {
		background: transparent;
		border: 0;
		padding: 4px 10px;
		font-size: 12px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.toggle button + button {
		border-left: 1px solid var(--border);
	}

	.toggle button:hover {
		background: var(--surface-2);
	}

	.toggle button.selected {
		background: var(--surface-2);
		color: var(--text-primary);
		font-weight: 600;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 10px 18px;
		margin: -4px 0 18px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}

	.body {
		min-width: 0;
	}
</style>
