<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		BankRequestError,
		type DateRange,
		fetchStatementSources,
		parseAccountIds,
		suggestRange,
		tokenExpiry
	} from '$lib/bank/discovery.js';
	import { loadBankAccounts, saveBankAccounts } from '$lib/state/persistence.js';
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
	let fetched = $state<readonly string[]>([]);
	/** What did not arrive, said plainly beside what did. */
	let shortfall = $state<readonly string[]>([]);

	/**
	 * Discovery's account ids, as pasted — kept in this browser, never in git.
	 *
	 * Blank is a real answer, not an unfinished one: it asks the bank for its own
	 * default. The field exists because that default does not reach every
	 * account — the certified statement omits at least one — and only an explicit
	 * list is known to bring back the rest.
	 */
	let accountsText = $state(loadBankAccounts().join('\n'));
	let showAccounts = $state(false);
	const accounts = $derived(parseAccountIds(accountsText));

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
		fetched = [];
		shortfall = [];

		try {
			// Saved before the request rather than after it, so a list that took a
			// moment to gather survives a fetch that then fails.
			saveBankAccounts(accounts);

			const sources = await fetchStatementSources({ token, range, scope: { accounts } });

			// Spent either way within minutes — there is no reason to keep it in a
			// field where a screen-share would catch it.
			token = '';

			const loaded: string[] = [];
			// Sequentially, not in parallel: both halves land in the one
			// `StatementState`, and `loadFile` reads `statement.error` as it goes.
			for (const file of [sources.pdf, sources.csv]) {
				if (file === null) continue;

				await statement.loadFile(file);

				// `loadFile` reports a bad parse through `statement.error` rather
				// than by throwing, so arriving here is not the same as having
				// succeeded. Claiming otherwise would put "Loaded …" beside the
				// error saying it was not.
				if (statement.error === null) loaded.push(file.name);
			}

			fetched = loaded;
			shortfall = sources.failures;

			// Nothing at all arrived: that is a failure, not a partial success, and
			// it belongs in the alert rather than in a quiet line underneath.
			if (loaded.length === 0 && sources.failures.length > 0) {
				failure = sources.failures.join(' ');
				shortfall = [];
			}
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
		Pulls a period straight from the bank instead of downloading it and dragging it here — both the
		certified statement and the Smart Search export, and it says which of them arrived.
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

	<div class="mt-3">
		<button
			type="button"
			class="text-xs font-semibold text-muted-foreground hover:text-foreground"
			aria-expanded={showAccounts}
			onclick={() => (showAccounts = !showAccounts)}
		>
			{showAccounts ? '▾' : '▸'} Accounts{accounts.length > 0 ? ` (${accounts.length})` : ''}
		</button>

		{#if showAccounts}
			<div class="mt-2">
				<Label for="{id}-accounts" class="mb-1 text-xs font-semibold text-muted-foreground">
					Discovery account ids
				</Label>
				<textarea
					id="{id}-accounts"
					rows="4"
					spellcheck="false"
					class="w-full rounded-md border bg-background p-2 font-mono text-[12px]"
					placeholder="One per line, or pasted straight out of the request."
					disabled={busy}
					bind:value={accountsText}></textarea>
				<p class="mt-1 text-[12px] text-faint">
					Kept in this browser only. Leave it blank to take whatever the bank sends by default —
					which is not everything: the certified statement leaves at least one account out, and
					listing the ids here is what brings the rest back. Copy them from the
					<code class="font-mono">AccountsList</code> of a Smart Search request in devtools.
				</p>
			</div>
		{/if}
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

	{#if fetched.length > 0}
		<p class="mt-3 text-[13px] text-muted-foreground">Loaded {fetched.join(' and ')}.</p>
	{/if}

	{#if shortfall.length > 0}
		<div class="mt-2 text-[13px] text-amber-600 dark:text-amber-500" role="status">
			{#each shortfall as reason (reason)}
				<p>{reason}</p>
			{/each}
		</div>
	{/if}

	<p class="mt-3.5 border-t pt-3 text-[12.5px] text-faint">
		In your logged-in Discovery tab, open devtools → Network, click any request to
		<code class="font-mono">api.discoverybank.co.za</code>, and copy the
		<code class="font-mono">authorization</code> header. Tokens last about five minutes, so this asks
		for one each time rather than keeping it — it is never saved to this browser, and whatever it fetches
		is read here the same way a dropped file is.
	</p>
</section>
