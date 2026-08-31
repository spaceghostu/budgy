<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import type { Component } from 'svelte';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group/index.js';
	import { loadTheme, saveTheme, type Theme } from '../state/persistence.ts';

	const OPTIONS: readonly { id: Theme; label: string; icon: Component }[] = [
		{ id: 'light', label: 'Light', icon: SunIcon },
		{ id: 'dark', label: 'Dark', icon: MoonIcon },
		{ id: 'system', label: 'System', icon: MonitorIcon }
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

<ToggleGroup
	type="single"
	variant="outline"
	size="sm"
	aria-label="Colour theme"
	value={theme}
	onValueChange={(next) => {
		// There is always a theme in force, so the group cannot be emptied.
		if (next) choose(next as Theme);
	}}
>
	{#each OPTIONS as option (option.id)}
		{@const Icon = option.icon}
		<ToggleGroupItem value={option.id} title={option.label} aria-label={option.label}>
			<Icon aria-hidden="true" />
		</ToggleGroupItem>
	{/each}
</ToggleGroup>
