<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import type { SourceKind, SourceSlot } from '../state/statement.svelte.js';

	interface Props {
		sources: readonly SourceSlot[];
		/** Which source is being read right now, if any. */
		busy: SourceKind | null;
		onfiles: (files: readonly File[]) => void;
		onremove: (kind: SourceKind) => void;
		onerror: (message: string) => void;
		/** Compact once a statement is on screen. */
		compact?: boolean;
	}

	const { sources, busy, onfiles, onremove, onerror, compact = false }: Props = $props();

	/** Generous: a decade of certified statements is still a few megabytes. */
	const MAX_BYTES = 40 * 1024 * 1024;

	let dragging = $state(false);
	let picker = $state<HTMLInputElement | null>(null);
	/** Which slot the picker was opened for, so its filter can be narrowed. */
	let pickingFor = $state<SourceKind | null>(null);

	const accept = $derived(
		pickingFor === null
			? sources.map((source) => source.accept).join(',')
			: (sources.find((source) => source.kind === pickingFor)?.accept ?? '')
	);

	function offer(list: FileList | null): void {
		const files = [...(list ?? [])];
		if (files.length === 0) return;

		const tooBig = files.find((file) => file.size > MAX_BYTES);
		if (tooBig !== undefined) {
			onerror(`${tooBig.name} is larger than 40 MB — that is bigger than any statement.`);
			return;
		}

		onfiles(files);
	}

	function choose(kind: SourceKind | null): void {
		pickingFor = kind;
		// Let the accept filter update before the dialog opens.
		queueMicrotask(() => picker?.click());
	}
</script>

<section
	class={cn(
		'rounded-xl bg-card transition-colors duration-100',
		compact ? 'border p-4' : 'border-[1.5px] border-dashed border-input p-6',
		dragging && 'border-series bg-muted'
	)}
	aria-label="Statement files"
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(event) => {
		event.preventDefault();
		dragging = false;
		offer(event.dataTransfer?.files ?? null);
	}}
>
	<input
		bind:this={picker}
		type="file"
		class="hidden"
		multiple
		{accept}
		onchange={(event) => {
			offer(event.currentTarget.files);
			event.currentTarget.value = '';
		}}
	/>

	{#if !compact}
		<header class="mb-4.5 text-center">
			<h2 class="text-xl font-semibold tracking-[-0.02em]">Choose your statement files</h2>
			<p class="mx-auto mt-1.5 max-w-[48ch] text-sm text-muted-foreground">
				Add either one, or both together. They are read in this browser and never uploaded anywhere.
			</p>
		</header>
	{/if}

	<ul class="grid list-none grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 p-0">
		{#each sources as source (source.kind)}
			<li
				class={cn(
					'flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card',
					compact ? 'px-3 py-2' : 'px-3.5 py-3',
					source.loaded && 'border-good'
				)}
			>
				<div class="min-w-0">
					<p class="flex items-center gap-1 text-[13px] font-semibold">
						{source.label}
						{#if source.loaded}
							<CheckIcon class="size-3.5 text-positive" aria-hidden="true" />
						{/if}
					</p>
					<p class="mt-0.5 text-xs text-faint">
						{#if busy === source.kind}
							Reading {source.fileName}…
						{:else if source.loaded}
							<span
								class="block max-w-[30ch] truncate text-muted-foreground"
								title={source.fileName}
							>
								{source.fileName}
							</span>
						{:else}
							{source.hint}
						{/if}
					</p>
				</div>

				<div class="flex flex-none gap-1.5">
					<Button
						variant="secondary"
						size="xs"
						class="border-input font-semibold hover:border-series disabled:cursor-progress"
						onclick={() => choose(source.kind)}
						disabled={busy !== null}
					>
						{source.loaded ? 'Replace' : 'Choose'}
					</Button>
					{#if source.loaded}
						<Button
							variant="outline"
							size="xs"
							class="border-input bg-transparent text-muted-foreground hover:border-destructive"
							onclick={() => onremove(source.kind)}
						>
							Remove
						</Button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if !compact}
		<p class="mt-3.5 text-center text-xs text-faint">…or drop both files here at once.</p>
	{/if}
</section>
