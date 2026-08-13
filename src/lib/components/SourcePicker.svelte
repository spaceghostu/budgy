<script lang="ts">
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
	class="picker"
	class:dragging
	class:compact
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
		multiple
		{accept}
		onchange={(event) => {
			offer(event.currentTarget.files);
			event.currentTarget.value = '';
		}}
	/>

	{#if !compact}
		<header>
			<h2>Choose your statement files</h2>
			<p>
				Add either one, or both together. They are read in this browser and never uploaded anywhere.
			</p>
		</header>
	{/if}

	<ul class="slots">
		{#each sources as source (source.kind)}
			<li class:loaded={source.loaded}>
				<div class="slot-text">
					<p class="slot-label">
						{source.label}
						{#if source.loaded}<span class="tick" aria-hidden="true">✓</span>{/if}
					</p>
					<p class="slot-hint">
						{#if busy === source.kind}
							Reading {source.fileName}…
						{:else if source.loaded}
							<span class="file-name" title={source.fileName}>{source.fileName}</span>
						{:else}
							{source.hint}
						{/if}
					</p>
				</div>

				<div class="slot-actions">
					<button type="button" onclick={() => choose(source.kind)} disabled={busy !== null}>
						{source.loaded ? 'Replace' : 'Choose'}
					</button>
					{#if source.loaded}
						<button type="button" class="remove" onclick={() => onremove(source.kind)}>
							Remove
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if !compact}
		<p class="drop-hint">…or drop both files here at once.</p>
	{/if}
</section>

<style>
	.picker {
		background: var(--surface-1);
		border: 1.5px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		padding: 24px;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}

	.picker.compact {
		padding: 14px 16px;
		border-style: solid;
		border-width: 1px;
		border-color: var(--border);
	}

	.picker.dragging {
		border-color: var(--series-1);
		background: var(--surface-2);
	}

	input {
		display: none;
	}

	header {
		text-align: center;
		margin-bottom: 18px;
	}

	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	header p {
		margin: 6px auto 0;
		max-width: 48ch;
		font-size: 14px;
		color: var(--text-secondary);
	}

	.slots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 12px;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 0;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-1);
	}

	.compact li {
		padding: 8px 12px;
	}

	li.loaded {
		border-color: var(--status-good);
	}

	.slot-text {
		min-width: 0;
	}

	.slot-text p {
		margin: 0;
	}

	.slot-label {
		font-size: 13px;
		font-weight: 600;
	}

	.tick {
		color: var(--status-good-text);
		margin-left: 4px;
	}

	.slot-hint {
		margin-top: 2px !important;
		font-size: 12px;
		color: var(--text-muted);
	}

	.file-name {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 30ch;
		color: var(--text-secondary);
	}

	.slot-actions {
		flex: none;
		display: flex;
		gap: 6px;
	}

	button {
		padding: 5px 11px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		border-color: var(--series-1);
	}

	button:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	button.remove {
		background: transparent;
		font-weight: 400;
		color: var(--text-secondary);
	}

	button.remove:hover {
		border-color: var(--status-critical);
	}

	.drop-hint {
		margin: 14px 0 0;
		text-align: center;
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
