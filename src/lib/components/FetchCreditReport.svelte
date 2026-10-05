<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { CreditRequestError, fetchCreditReport } from '$lib/credit/finance365.js';
	import { CreditFormatError, importCreditReport } from '$lib/credit/parse.js';
	import type { CreditReport } from '$lib/credit/types.js';
	import { formatCount, formatDate } from '$lib/format.js';

	interface Props {
		/** Handed the reduced report — never the response it was read from. */
		readonly onreport: (report: CreditReport) => void;
	}

	const { onreport }: Props = $props();
	const id = $props.id();

	/**
	 * The reader's Finance365 token, held here and nowhere else.
	 *
	 * It opens a credit file, which is a good deal more than a statement, so it
	 * gets Discovery's treatment and for the same reason: used once, cleared, and
	 * never written to this browser.
	 */
	let token = $state('');
	/** A response pasted from devtools. Holds the whole report until it is read. */
	let pasted = $state('');
	let showPaste = $state(false);
	let busy = $state(false);
	let failure = $state<string | null>(null);
	let loaded = $state<string | null>(null);

	function today(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function accept(report: CreditReport): void {
		onreport(report);
		// Said in counts and a date, and never by showing any of it back: what was
		// pasted or fetched has an identity number in it.
		loaded = `Read ${formatCount(report.accounts.length, 'account')} from the report dated ${formatDate(report.reportDate)}.`;
	}

	function describe(error: unknown): string {
		return error instanceof CreditRequestError || error instanceof CreditFormatError
			? error.message
			: 'Something went wrong reading that report.';
	}

	async function pull(): Promise<void> {
		busy = true;
		failure = null;
		loaded = null;

		try {
			const report = await fetchCreditReport({ token, today: today() });
			accept(report);
		} catch (error: unknown) {
			failure = describe(error);
		} finally {
			// Cleared whether or not it worked: a field is the wrong place to leave
			// a credential that a screen-share would catch.
			token = '';
			busy = false;
		}
	}

	function read(): void {
		failure = null;
		loaded = null;

		try {
			accept(importCreditReport(pasted, today()));
		} catch (error: unknown) {
			failure = describe(error);
		} finally {
			// Emptied whether or not it could be read: what was pasted is a whole
			// credit file, and it should not sit on screen for want of a brace.
			pasted = '';
		}
	}
</script>

<section class="rounded-xl border bg-card p-4" aria-label="Fetch from Finance365">
	<h2 class="text-[15px] font-semibold">Fetch from Finance365</h2>
	<p class="mt-1 text-[13px] text-muted-foreground">
		Reads your latest credit report and keeps each account's lender, balance, instalment and arrears
		— nothing else. It never asks Finance365 to draw a new report.
	</p>

	<div class="mt-3.5 flex flex-wrap items-end gap-3">
		<div class="min-w-0 flex-1 basis-64">
			<Label for="{id}-token" class="mb-1 text-xs font-semibold text-muted-foreground">
				Finance365 token
			</Label>
			<Input
				id="{id}-token"
				type="password"
				autocomplete="off"
				spellcheck="false"
				class="w-full bg-background font-mono text-[13px]"
				disabled={busy}
				bind:value={token}
			/>
		</div>
		<Button
			size="sm"
			class="font-semibold"
			disabled={busy || token.trim() === ''}
			onclick={() => void pull()}
		>
			{busy ? 'Fetching…' : 'Fetch report'}
		</Button>
	</div>

	<div class="mt-3">
		<button
			type="button"
			class="text-xs font-semibold text-muted-foreground hover:text-foreground"
			aria-expanded={showPaste}
			onclick={() => (showPaste = !showPaste)}
		>
			{showPaste ? '▾' : '▸'} Paste the response instead
		</button>

		{#if showPaste}
			<div class="mt-2">
				<Label for="{id}-paste" class="mb-1 text-xs font-semibold text-muted-foreground">
					Response to the credit-report request
				</Label>
				<textarea
					id="{id}-paste"
					rows="4"
					spellcheck="false"
					autocomplete="off"
					class="w-full rounded-md border bg-background p-2 font-mono text-[12px]"
					placeholder="Copied from devtools → Network → credit-report → Response."
					bind:value={pasted}></textarea>
				<Button
					variant="outline"
					size="sm"
					class="mt-1.5 font-semibold"
					disabled={pasted.trim() === ''}
					onclick={read}
				>
					Read report
				</Button>
			</div>
		{/if}
	</div>

	{#if failure !== null}
		<p class="mt-3 text-[13px] text-destructive" role="alert">{failure}</p>
	{/if}

	{#if loaded !== null}
		<p class="mt-3 text-[13px] text-muted-foreground" role="status">{loaded}</p>
	{/if}

	<p class="mt-3.5 border-t pt-3 text-[12.5px] text-faint">
		Log in at <code class="font-mono">dashboard.finance365.co.za</code>, open devtools → Network,
		click the request to <code class="font-mono">credit-report</code>, and copy its
		<code class="font-mono">authorization</code> header — or copy the value of the
		<code class="font-mono">userstore</code> cookie, and only the token in it is read. The token is used
		for the one request and never saved. The report it fetches carries your identity number and full account
		numbers; neither is kept, in this browser or anywhere else.
	</p>
</section>
