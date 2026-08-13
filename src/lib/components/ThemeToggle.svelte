<script lang="ts">
	import { loadTheme, saveTheme, type Theme } from '../state/persistence.ts';

	const OPTIONS: readonly { id: Theme; label: string; symbol: string }[] = [
		{ id: 'light', label: 'Light', symbol: '☀' },
		{ id: 'dark', label: 'Dark', symbol: '☾' },
		{ id: 'system', label: 'System', symbol: '◐' }
	];

	// The app renders client-side only, so storage is available at init.
	let theme = $state<Theme>(loadTheme());

	$effect(() => {
		const root = document.documentElement;
		if (theme === 'system') {
			root.removeAttribute('data-theme');
		} else {
			root.setAttribute('data-theme', theme);
		}
	});

	function choose(next: Theme): void {
		theme = next;
		saveTheme(next);
	}
</script>

<div class="toggle" role="group" aria-label="Colour theme">
	{#each OPTIONS as option (option.id)}
		<button
			type="button"
			title={option.label}
			aria-label={option.label}
			aria-pressed={theme === option.id}
			class:selected={theme === option.id}
			onclick={() => choose(option.id)}
		>
			<span aria-hidden="true">{option.symbol}</span>
		</button>
	{/each}
</div>

<style>
	.toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface-1);
	}

	button {
		border: 0;
		background: transparent;
		padding: 5px 9px;
		font-size: 13px;
		line-height: 1;
		color: var(--text-secondary);
		cursor: pointer;
	}

	button + button {
		border-left: 1px solid var(--border);
	}

	button:hover {
		background: var(--surface-2);
	}

	button.selected {
		background: var(--surface-2);
		color: var(--text-primary);
	}
</style>
