<script lang="ts">
	import { onMount } from 'svelte';
	import { AiRequestError, MODEL, requestSpendingReport } from '../ai/client.ts';
	import { buildAiPayload } from '../ai/payload.ts';
	import { MAX_NOTE_LENGTH, buildUserPrompt } from '../ai/prompt.ts';
	import type { SpendingReport } from '../ai/report.ts';
	import { formatDate } from '../format.ts';
	import type { Tone } from '../stats/highlights.ts';
	import { clearKey, loadApiKey, saveApiKey } from '../state/persistence.ts';
	import type { Insights } from '../types.ts';

	interface Props {
		insights: Insights;
	}

	const { insights }: Props = $props();

	let apiKey = $state('');
	let note = $state('');
	let remember = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let report = $state<SpendingReport | null>(null);
	let request: AbortController | null = null;

	const payload = $derived(buildAiPayload(insights));

	/**
	 * The message itself, built eagerly.
	 *
	 * This is what the reader is shown under "what gets sent" — the actual text,
	 * their own note included, rather than a rendering of it. A note that was
	 * sent but not shown would make the claim on that summary false.
	 */
	const preview = $derived(buildUserPrompt(payload, note));

	/** What the report on screen was written from, and when. */
	let sent = $state<{ preview: string; note: string; from: string; to: string } | null>(null);

	const id = $props.id();

	/**
	 * Why the report on screen no longer matches what is beside it, if it does
	 * not. Everything else on the page re-derives; a paragraph from the API
	 * cannot, so it says which of the two moved.
	 *
	 * The figures are compared as the whole payload rather than by their dates:
	 * switching account can leave the first and last dates identical — debit
	 * orders on the 1st make that ordinary — while changing every figure under
	 * them.
	 */
	const staleReason = $derived.by((): 'figures' | 'question' | null => {
		if (report === null || sent === null) return null;
		if (buildUserPrompt(payload, sent.note) !== sent.preview) return 'figures';
		return note.trim() === sent.note.trim() ? null : 'question';
	});

	/** Status never rides on colour alone — the same markers the local highlights use. */
	const MARKER: Record<Tone, { symbol: string; label: string }> = {
		neutral: { symbol: '•', label: 'Note' },
		good: { symbol: '↑', label: 'Good' },
		warning: { symbol: '!', label: 'Watch' }
	};

	onMount(() => {
		const stored = loadApiKey();
		if (stored === '') return;

		apiKey = stored;
		remember = true;
	});

	function setKey(next: string): void {
		apiKey = next;
		if (remember) saveApiKey(next);
	}

	function setRemember(next: boolean): void {
		remember = next;
		if (next) {
			saveApiKey(apiKey);
		} else {
			clearKey('apiKey');
		}
	}

	async function ask(): Promise<void> {
		busy = true;
		error = null;
		request = new AbortController();

		try {
			report = await requestSpendingReport({ payload, apiKey, note, signal: request.signal });
			sent = { preview, note, from: payload.period.from, to: payload.period.to };
		} catch (failure: unknown) {
			// A cancel is the reader's own doing and is not worth reporting back.
			if (failure instanceof DOMException && failure.name === 'AbortError') return;

			error =
				failure instanceof AiRequestError
					? failure.message
					: 'Something went wrong asking Claude. Try again.';
		} finally {
			busy = false;
			request = null;
		}
	}

	function cancel(): void {
		request?.abort();
	}
</script>

<section class="card" aria-labelledby="{id}-title">
	<header>
		<div class="heading">
			<h2 id="{id}-title">Ask Claude</h2>
			<p class="subtitle">
				A written read of the period shown above, from {MODEL}.
			</p>
		</div>
	</header>

	<p class="warning">
		<strong>This is the one thing on this page that leaves your browser.</strong>
		Everything else is computed on this device. Press the button and a summary — totals, category and
		merchant rollups, per-month flow, recurring charges — is sent to Anthropic under your own API key,
		plus anything you type in the note box, word for word. No descriptions, references, account numbers
		or counterparties are included, and nothing is sent until you press it.
	</p>

	<details>
		<summary>See exactly what would be sent</summary>
		<pre>{preview}</pre>
		<p class="hint">
			This message, plus a fixed set of instructions that never vary with your statement.
		</p>
	</details>

	<div class="field">
		<label for="{id}-note"
			>What do you want from this read? <span class="optional">Optional</span></label
		>
		<textarea
			id="{id}-note"
			rows="2"
			maxlength={MAX_NOTE_LENGTH}
			placeholder="Saving for a deposit in June — what is in the way? · Why was January so much worse than December? · Ignore the medical bills, they were a one-off."
			value={note}
			oninput={(event) => (note = event.currentTarget.value)}></textarea>
		<p class="hint">
			Steers what Claude looks at. Sent word for word, so leave anything out you would not want to
			send.
		</p>
	</div>

	<div class="controls">
		<div class="field">
			<label for="{id}-key">Your Anthropic API key</label>
			<input
				id="{id}-key"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="sk-ant-…"
				value={apiKey}
				oninput={(event) => setKey(event.currentTarget.value)}
			/>
			<p class="hint">
				From <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
					>console.anthropic.com</a
				>. Calls are billed to that key.
			</p>
		</div>

		{#if busy}
			<button type="button" class="secondary" onclick={cancel}>Cancel</button>
		{:else}
			<button
				type="button"
				class="primary"
				disabled={apiKey.trim() === ''}
				onclick={() => void ask()}
			>
				{report === null ? 'Read my spending' : 'Read it again'}
			</button>
		{/if}
	</div>

	<label class="remember">
		<input
			type="checkbox"
			checked={remember}
			onchange={(event) => setRemember(event.currentTarget.checked)}
		/>
		<span>
			Keep this key in this browser
			<span class="hint">
				Off by default — a key is a credential, and local storage is readable by anyone at this
				browser. Left off, it is forgotten on reload.
			</span>
		</span>
	</label>

	<div class="result" aria-live="polite" aria-busy={busy}>
		{#if busy}
			<p class="status">Reading {payload.totals.transactionCount} transactions…</p>
		{:else if error !== null}
			<p class="banner" role="alert">{error}</p>
		{:else if report !== null}
			{#if staleReason !== null}
				<p class="stale">
					{#if staleReason === 'figures'}
						This read describes {formatDate(sent?.from ?? '')} to {formatDate(sent?.to ?? '')}. The
						figures on screen have changed since — read it again to catch up.
					{:else}
						You have changed what you asked since this was written — read it again for an answer to
						the new question.
					{/if}
				</p>
			{/if}

			<p class="headline">{report.headline}</p>

			<!-- Keyed by index: the titles are written by a model, and two findings
			     called "Bank fees" is an ordinary thing for it to return. -->
			<ul class="findings">
				{#each report.findings as finding, index (index)}
					<li class={finding.tone}>
						<span class="marker" aria-hidden="true">{MARKER[finding.tone].symbol}</span>
						<span class="sr-only">{MARKER[finding.tone].label}:</span>
						<div>
							<h3>{finding.title}</h3>
							<p>{finding.detail}</p>
						</div>
					</li>
				{/each}
			</ul>

			{#if report.actions.length > 0}
				<h3 class="actions-heading">What you could do</h3>
				<ul class="actions">
					{#each report.actions as action, index (index)}
						<li>{action}</li>
					{/each}
				</ul>
			{/if}

			<p class="caveat">
				Written by a language model from the figures above. It can be wrong — every number it quotes
				is checkable against the tables on this page.
			</p>
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
		margin-bottom: 14px;
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

	.warning {
		margin: 0 0 12px;
		padding: 11px 14px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: 13px;
		color: var(--text-secondary);
	}

	.warning strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	details {
		font-size: 13px;
		color: var(--text-secondary);
		margin-bottom: 16px;
	}

	summary {
		cursor: pointer;
		padding: 4px 0;
	}

	pre {
		margin: 8px 0 0;
		padding: 12px;
		max-height: 320px;
		overflow: auto;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.controls {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 14px;
	}

	.field {
		flex: 1 1 260px;
		min-width: 0;
	}

	.optional {
		font-weight: 400;
		color: var(--text-muted);
	}

	textarea {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--page);
		color: var(--text-primary);
		font-family: inherit;
		font-size: 13px;
		line-height: 1.5;
		resize: vertical;
	}

	label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}

	input[type='password'] {
		width: 100%;
		padding: 7px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--page);
		color: var(--text-primary);
		font-family: var(--font-mono);
		font-size: 13px;
	}

	.hint {
		display: block;
		margin: 4px 0 0;
		font-size: 12px;
		font-weight: 400;
		color: var(--text-muted);
	}

	button {
		margin-top: 18px;
		padding: 8px 14px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-strong);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.primary {
		background: var(--series-1);
		border-color: var(--series-1);
		color: #ffffff;
	}

	.secondary {
		background: var(--surface-1);
		color: var(--text-primary);
	}

	.remember {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 14px;
		font-size: 13px;
		font-weight: 400;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.remember .hint {
		max-width: 60ch;
	}

	.result:not(:empty) {
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.status {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.banner {
		margin: 0;
		padding: 11px 14px;
		border: 1px solid var(--status-critical);
		border-radius: var(--radius-md);
		font-size: 13px;
	}

	.stale {
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid var(--status-warning);
		border-radius: var(--radius-md);
		font-size: 12.5px;
		color: var(--text-secondary);
	}

	.headline {
		margin: 0 0 14px;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.findings {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}

	.findings li {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 12px 14px;
	}

	.findings h3 {
		margin: 0 0 3px;
		font-size: 13px;
		font-weight: 600;
	}

	.findings p {
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

	.findings li.good .marker {
		background: var(--status-good);
	}

	.findings li.warning .marker {
		background: var(--status-warning);
		color: #0b0b0b;
	}

	.actions-heading {
		margin: 16px 0 6px;
		font-size: 13px;
		font-weight: 600;
	}

	.actions {
		margin: 0;
		padding-left: 20px;
		display: grid;
		gap: 5px;
		font-size: 13.5px;
		color: var(--text-secondary);
	}

	.caveat {
		margin: 16px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-muted);
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
