<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		BankRequestError,
		type DateRange,
		fetchCertifiedStatement,
		suggestRange,
		tokenExpiry
	} from '$lib/bank/discovery.js';
	import type { StatementState } from '$lib/state/statement.svelte.js';

	interface Props {
		/** Where a fetched statement is read, exactly as a dropped file is. */
		readonly statement: StatementState;
	}

	const { statement }: Props = $props();
	const id = $props.id();

	/**
	 * The reader's Discovery token, held here and nowhere else.
	 *
	 * Not in `persistence.ts`, not in local storage, not in `.env`. It is a
	 * five-minute credential, so there is nothing a saved copy could later be
	 * used for except being leaked — and this page's whole claim is that what
	 * you put into it stays in the tab you put it in.
	 */
	let token = $state('');
	let busy = $state(false);
	let failure = $state<string | null>(null);
	let fetched = $state<string | null>(null);

	/** Ticks so the countdown counts. */
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	/** The last year, until the reader says otherwise. */
	const suggested = suggestRange();

	/**
	 * The period, once the reader has said otherwise.
	 *
	 * `null` while they have not, so the fields show the suggested year.
	 * Touching either field pins both, and a pinned period stays pinned.
	 */
	let chosen = $state<DateRange | null>(null);
	const range = $derived(chosen ?? suggested);

	const expiry = $derived(token.trim() === '' ? null : tokenExpiry(token));
	const secondsLeft = $derived(
		expiry === null ? null : Math.max(0, Math.round((expiry.getTime() - now) / 1000))
	);

	async function pull(): Promise<void> {
		busy = true;
		failure = null;
		fetched = null;

		try {
			const file = await fetchCertifiedStatement({ token, range });
			await statement.loadFile(file);

			// Spent either way within minutes — there is no reason to keep it in a
			// field where a screen-share would catch it.
			token = '';

			// `loadFile` reports a bad parse through `statement.error` rather than
			// by throwing, so arriving here is not the same as having succeeded.
			// Claiming otherwise would put "Loaded …" beside the error saying it
			// was not.
			if (statement.error === null) fetched = file.name;
		} catch (error: unknown) {
			failure =
				error instanceof BankRequestError
					? error.message
					: 'Something went wrong fetching that statement.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="rounded-xl border bg-card p-4" aria-label="Fetch from Discovery">
	<h2 class="text-[15px] font-semibold">Fetch from Discovery</h2>
	<p class="mt-1 text-[13px] text-muted-foreground">
		Pulls the certified statement for a period straight from the bank, instead of downloading it and
		dragging it here.
	</p>

	<div class="mt-3.5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
		<div class="min-w-0">
			<Label for="{id}-token" class="mb-1 text-xs font-semibold text-muted-foreground">
				Discovery access token
			</Label>
			<Input
				id="{id}-token"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="eyJhbGciOi…"
				class="w-full bg-background font-mono text-[13px]"
				disabled={busy}
				bind:value={token}
			/>
		</div>

		<div>
			<Label for="{id}-from" class="mb-1 text-xs font-semibold text-muted-foreground">From</Label>
			<Input
				id="{id}-from"
				type="date"
				class="bg-background text-[13px]"
				disabled={busy}
				value={range.from}
				oninput={(event) => (chosen = { ...range, from: event.currentTarget.value })}
			/>
		</div>

		<div>
			<Label for="{id}-to" class="mb-1 text-xs font-semibold text-muted-foreground">To</Label>
			<Input
				id="{id}-to"
				type="date"
				class="bg-background text-[13px]"
				disabled={busy}
				value={range.to}
				oninput={(event) => (chosen = { ...range, to: event.currentTarget.value })}
			/>
		</div>
	</div>

	<div class="mt-3.5 flex flex-wrap items-center gap-3">
		<Button
			size="sm"
			class="font-semibold"
			disabled={busy || token.trim() === '' || range.from === '' || range.to === ''}
			onclick={() => void pull()}
		>
			{busy ? 'Fetching…' : 'Fetch statement'}
		</Button>

		{#if secondsLeft !== null}
			<p
				class="text-xs"
				class:text-faint={secondsLeft > 30}
				class:text-destructive={secondsLeft <= 30}
			>
				{secondsLeft === 0
					? 'Token expired — copy a fresh one.'
					: `Token good for ${secondsLeft}s.`}
			</p>
		{/if}
	</div>

	{#if failure !== null}
		<p class="mt-3 text-[13px] text-destructive" role="alert">{failure}</p>
	{/if}

	{#if fetched !== null}
		<p class="mt-3 text-[13px] text-muted-foreground">Loaded {fetched}.</p>
	{/if}

	<p class="mt-3.5 border-t pt-3 text-[12.5px] text-faint">
		In your logged-in Discovery tab, open devtools → Network, click any request to
		<code class="font-mono">api.discoverybank.co.za</code>, and copy the
		<code class="font-mono">authorization</code> header. Tokens last about five minutes, so this asks
		for one each time rather than keeping it — it is never saved to this browser, and the statement it
		fetches is read here the same way a dropped file is.
	</p>
</section>
