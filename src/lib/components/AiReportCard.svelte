<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DotIcon from '@lucide/svelte/icons/dot';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { onMount, type Component } from 'svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { cn } from '$lib/utils.js';
	import {
		AiRequestError,
		requestSpendingReport,
		type AiBrief,
		type ReportReply,
		type ReportTurn,
		type SpendingRequest
	} from '../ai/client.ts';
	import { envApiKey, hasEnvKey } from '../ai/env.ts';
	import { MAX_NOTE_LENGTH, buildFollowUp } from '../ai/prompt.ts';
	import type { Tone } from '../stats/highlights.ts';
	import { clearKey, loadApiKey, saveApiKey } from '../state/persistence.ts';

	/**
	 * Everything about asking Claude that does not depend on what is being asked.
	 *
	 * The key, the note box, the "what gets sent" preview, the conversation and
	 * its follow-ups, the stale warning, the cancel and every failure message are
	 * the same job whichever page is asking — and they are the parts where a
	 * second copy would quietly drift into a second set of promises about what
	 * leaves the browser. So the question travels in as props and this card is
	 * written once.
	 */
	interface Props {
		/** The card's own heading, e.g. "Ask Claude". */
		title: string;
		/** One line under it saying what a press of the button does. */
		description: string;
		/**
		 * The message that would be sent, given a note.
		 *
		 * A builder rather than a finished string so that this card can ask the one
		 * question its stale check needs: *what would the figures on screen say
		 * under the note that was actually sent?* Comparing that against what was
		 * sent tells a changed statement from a changed question, which are two
		 * different things to tell the reader and only one of them is a reason to
		 * start again.
		 */
		buildPreview: (note: string) => string;
		/** What is being asked and in what shape. See {@link AiBrief}. */
		brief: AiBrief;
		/** What the reader has typed. Owned by the parent, which builds the preview. */
		note: string;
		/** Called as they type it. */
		onnote: (next: string) => void;
		/** What the send button says with nothing on screen yet. */
		sendLabel: string;
		/** What the placeholder in the note box suggests asking. */
		notePlaceholder: string;
		/** What the follow-up box suggests asking. */
		followUpPlaceholder: string;
		/** The sentence under the note box, saying what the note does. */
		noteHint?: string;
		/** What the card says while the first request is in flight. */
		busyLabel: string;
		/**
		 * The one line naming what is sent, shown in the standing privacy note.
		 * E.g. "totals, category and merchant rollups, per-month flow".
		 */
		sends: string;
		/**
		 * Why a conversation no longer matches the screen, when the figures have
		 * moved. Named by the parent because only it knows what the figures are.
		 *
		 * A function, and called at the moment of sending rather than read from the
		 * template: this sentence only ever appears once the figures have changed,
		 * which is exactly when "the figures on screen" and "the figures this was
		 * written from" are two different things. Built from what is on screen it
		 * would name the new ones — and so assert the opposite of what it is there
		 * to say.
		 */
		describeSent: () => string;
	}

	const {
		title,
		description,
		buildPreview,
		brief,
		note,
		onnote,
		sendLabel,
		notePlaceholder,
		followUpPlaceholder,
		noteHint = 'Steers what Claude looks at. Sent word for word, so leave anything out you would not want to send.',
		busyLabel,
		sends,
		describeSent
	}: Props = $props();

	/**
	 * A key from `.env` stands in for the reader's own, and where it is set the
	 * card never asks for one, never reads one from this browser and never writes
	 * one to it — a key that was configured is not the reader's to keep or clear.
	 */
	const configured = hasEnvKey();

	/** Which of the two things that send is in flight, if either. */
	type Pending = 'read' | 'follow-up';

	let apiKey = $state(envApiKey());
	let remember = $state(false);
	let pending = $state<Pending | null>(null);
	let error = $state<string | null>(null);

	/**
	 * The conversation, oldest first.
	 *
	 * Every exchange is kept rather than only the latest answer: a follow-up is
	 * sent with everything said so far, so that "break that down" means what the
	 * reader thinks it means. Asking again empties it — that is a new question
	 * about the figures, not a continuation of the old one.
	 */
	let turns = $state<readonly ReportTurn[]>([]);

	/** What the reader has typed in the follow-up box but not yet sent. */
	let followUp = $state('');

	let inFlight: AbortController | null = null;

	const busy = $derived(pending !== null);

	/**
	 * The message itself, built eagerly.
	 *
	 * This is what the reader is shown under "what gets sent" — the actual text,
	 * their own note included, rather than a rendering of it. A note that was sent
	 * but not shown would make the claim on that summary false.
	 */
	const preview = $derived(buildPreview(note));

	/** What the report on screen was written from, and how to say so. */
	let sent = $state<{ preview: string; note: string; described: string } | null>(null);

	const id = $props.id();

	/**
	 * Why the report on screen no longer matches what is beside it, if it does
	 * not. Everything else on the page re-derives; a paragraph from the API
	 * cannot, so it says which of the two moved.
	 *
	 * The figures are compared as the whole message rebuilt under the note that
	 * was actually sent, rather than by their dates: switching account can leave
	 * the first and last dates identical — debit orders on the 1st make that
	 * ordinary — while changing every figure under them.
	 */
	const staleReason = $derived.by((): 'figures' | 'question' | null => {
		if (turns.length === 0 || sent === null) return null;
		if (buildPreview(sent.note) !== sent.preview) return 'figures';
		return note.trim() === sent.note.trim() ? null : 'question';
	});

	/** Status never rides on colour alone — the same markers the local highlights use. */
	const MARKER: Record<Tone, { icon: Component; label: string; class: string }> = {
		neutral: { icon: DotIcon, label: 'Note', class: 'bg-faint text-card' },
		good: { icon: TrendingUpIcon, label: 'Good', class: 'bg-good text-card' },
		warning: { icon: TriangleAlertIcon, label: 'Watch', class: 'bg-warning text-[#0b0b0b]' }
	};

	onMount(() => {
		if (configured) return;

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

	/**
	 * Send, and put anything other than a report in front of the reader.
	 *
	 * `null` back means nothing was returned — it failed, or they cancelled — and
	 * the caller leaves the conversation exactly as it found it. A cancelled
	 * follow-up loses the request, not the thread it was asked about.
	 */
	async function run(
		kind: Pending,
		request: Omit<SpendingRequest, 'apiKey' | 'signal' | 'brief'>
	): Promise<ReportReply | null> {
		pending = kind;
		error = null;
		inFlight = new AbortController();

		try {
			return await requestSpendingReport({
				...request,
				brief,
				apiKey,
				signal: inFlight.signal
			});
		} catch (failure: unknown) {
			// A cancel is the reader's own doing and is not worth reporting back.
			if (failure instanceof DOMException && failure.name === 'AbortError') return null;

			error =
				failure instanceof AiRequestError
					? failure.message
					: 'Something went wrong asking Claude. Try again.';
			return null;
		} finally {
			pending = null;
			inFlight = null;
		}
	}

	/** Open a conversation about the figures on screen, replacing any before it. */
	async function ask(): Promise<void> {
		// Read once, up front: the reader can change the filters while this is in
		// flight, and what comes back has to be filed under what was sent.
		const opening = preview;
		const asked = note;
		// Described now, while what is on screen is still what is being sent.
		const described = describeSent();

		const reply = await run('read', { opening });
		if (reply === null) return;

		turns = [{ question: asked.trim(), ...reply }];
		sent = { preview: opening, note: asked, described };
		followUp = '';
	}

	/** Carry on from what Claude has already said, about the same figures. */
	async function askAgain(): Promise<void> {
		if (sent === null) return;

		const question = buildFollowUp(followUp);
		if (question === '') return;

		const reply = await run('follow-up', { opening: sent.preview, turns, question });
		if (reply === null) return;

		turns = [...turns, { question, ...reply }];
		followUp = '';
	}

	function cancel(): void {
		inFlight?.abort();
	}

	const hint = 'mt-1 block text-xs font-normal text-faint';
</script>

<Card.Root role="region" aria-labelledby="{id}-title" class="min-w-0 [--card-spacing:--spacing(5)]">
	<Card.Header>
		<Card.Title id="{id}-title" class="text-[15px] font-semibold tracking-[-0.01em]">
			{title}
		</Card.Title>
		<Card.Description class="text-[13px]">
			{description}
		</Card.Description>
	</Card.Header>

	<Card.Content>
		<p
			class="rounded-md border border-input bg-muted px-3.5 py-3 text-[13px] text-muted-foreground"
		>
			<strong class="font-semibold text-foreground">
				This is the one thing on this page that leaves your browser.
			</strong>
			Everything else is computed on this device. Press the button and a summary — {sends} — is sent to
			Anthropic under
			{configured ? 'the API key this build was given' : 'your own API key'}, plus anything you type
			in the note box, word for word. No descriptions, references, account numbers or counterparties
			are included, and nothing is sent until you press it.
		</p>

		<Collapsible.Root class="mt-3 text-[13px] text-muted-foreground">
			<Collapsible.Trigger
				class="flex cursor-pointer items-center gap-1 py-1 [&[data-state=open]>svg]:rotate-90"
			>
				<ChevronRightIcon class="size-3.5 transition-transform" aria-hidden="true" />
				See exactly what would be sent
			</Collapsible.Trigger>
			<Collapsible.Content>
				<pre
					class="mt-2 max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-[11.5px]/[1.5]">{preview}</pre>
				<p class={hint}>
					This message, plus a fixed set of instructions that never vary with your statement.
				</p>
			</Collapsible.Content>
		</Collapsible.Root>

		<div class="mt-4 min-w-0">
			<Label for="{id}-note" class="mb-1 text-xs font-semibold text-muted-foreground">
				What do you want from this read? <span class="font-normal text-faint">Optional</span>
			</Label>
			<Textarea
				id="{id}-note"
				rows={2}
				maxlength={MAX_NOTE_LENGTH}
				class="resize-y bg-background text-[13px]"
				placeholder={notePlaceholder}
				value={note}
				oninput={(event) => onnote(event.currentTarget.value)}
			/>
			<p class={hint}>{noteHint}</p>
		</div>

		<div class="mt-3.5 flex flex-wrap items-start gap-3">
			<div class="min-w-0 flex-1 basis-65">
				{#if configured}
					<p class="mb-1 text-xs font-semibold text-muted-foreground">Anthropic API key</p>
					<p class="text-[13px] text-muted-foreground">Using the key this build was given.</p>
					<p class={hint}>
						Read from <code class="font-mono">ANTHROPIC_API_KEY</code> in
						<code class="font-mono">.env</code> when this bundle was built. Calls are billed to that key.
						Unset it and this card asks each reader for their own.
					</p>
				{:else}
					<Label for="{id}-key" class="mb-1 text-xs font-semibold text-muted-foreground">
						Your Anthropic API key
					</Label>
					<Input
						id="{id}-key"
						type="password"
						autocomplete="off"
						spellcheck="false"
						placeholder="sk-ant-…"
						class="w-full bg-background font-mono text-[13px]"
						value={apiKey}
						oninput={(event) => setKey(event.currentTarget.value)}
					/>
					<p class={hint}>
						From <a
							href="https://console.anthropic.com/settings/keys"
							target="_blank"
							rel="noreferrer"
						>
							console.anthropic.com
						</a>. Calls are billed to that key.
					</p>
				{/if}
			</div>

			{#if pending === 'read'}
				<Button
					variant="outline"
					size="lg"
					class="mt-4.5 border-input font-semibold"
					onclick={cancel}
				>
					Cancel
				</Button>
			{:else}
				<!-- The one blue button on the page, for the one action that sends. -->
				<Button
					size="lg"
					class="mt-4.5 bg-series font-semibold text-white hover:bg-series/90"
					disabled={busy || apiKey.trim() === ''}
					onclick={() => void ask()}
				>
					{turns.length === 0 ? sendLabel : 'Start again'}
				</Button>
			{/if}
		</div>

		{#if !configured}
			<div class="mt-3.5 flex items-start gap-2">
				<Checkbox
					id="{id}-remember"
					class="mt-0.5"
					checked={remember}
					onCheckedChange={(next) => setRemember(next === true)}
				/>
				<Label for="{id}-remember" class="block text-[13px] font-normal text-muted-foreground">
					Keep this key in this browser
					<span class="{hint} max-w-[60ch]">
						Off by default — a key is a credential, and local storage is readable by anyone at this
						browser. Left off, it is forgotten on reload.
					</span>
				</Label>
			</div>
		{/if}

		<div
			class="not-empty:mt-4.5 not-empty:border-t not-empty:pt-4"
			aria-live="polite"
			aria-busy={busy}
		>
			{#if pending === 'read'}
				<p class="text-[13px] text-muted-foreground">{busyLabel}</p>
			{:else}
				{#if staleReason !== null}
					<p
						class="mb-3 rounded-md border border-warning px-3 py-2.5 text-[12.5px] text-muted-foreground"
					>
						{#if staleReason === 'figures'}
							{sent?.described}
						{:else}
							You have changed what you asked since this was written — start again for a fresh read
							of the new question, or ask it as a follow-up below.
						{/if}
					</p>
				{/if}

				<!-- Keyed by index: the conversation only ever grows, and a model asked
				     twice about fees can answer with the same headline both times. -->
				{#each turns as turn, index (index)}
					<div class={index === 0 ? '' : 'mt-5 border-t pt-4'}>
						{#if turn.question !== ''}
							<p class="mb-2.5 flex gap-2 text-[13px] text-muted-foreground">
								<span class="font-semibold text-foreground">You asked</span>
								<span>{turn.question}</span>
							</p>
						{/if}

						<p class="mb-3.5 text-[15px] font-semibold tracking-[-0.01em]">
							{turn.report.headline}
						</p>

						<!-- Keyed by index: the titles are written by a model, and two findings
						     called "Bank fees" is an ordinary thing for it to return. -->
						<ul class="grid list-none gap-2.5 p-0">
							{#each turn.report.findings as finding, position (position)}
								{@const marker = MARKER[finding.tone]}
								{@const Icon = marker.icon}
								<li class="flex items-start gap-2.5 rounded-md border bg-muted px-3.5 py-3">
									<span
										class={cn(
											'grid size-5 flex-none place-items-center rounded-full',
											marker.class
										)}
										aria-hidden="true"
									>
										<Icon class="size-3" />
									</span>
									<span class="sr-only">{marker.label}:</span>
									<div>
										<h3 class="mb-0.5 text-[13px] font-semibold">{finding.title}</h3>
										<p class="text-[13.5px] text-muted-foreground">{finding.detail}</p>
									</div>
								</li>
							{/each}
						</ul>

						{#if turn.report.actions.length > 0}
							<h3 class="mt-4 mb-1.5 text-[13px] font-semibold">What you could do</h3>
							<ul class="grid list-disc gap-1.25 pl-5 text-[13.5px] text-muted-foreground">
								{#each turn.report.actions as action, position (position)}
									<li>{action}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}

				{#if pending === 'follow-up'}
					<p class="mt-5 border-t pt-4 text-[13px] text-muted-foreground">Reading your question…</p>
				{/if}

				{#if error !== null}
					<Alert.Root
						variant="destructive"
						class={cn('border-destructive text-[13px]', turns.length > 0 && 'mt-4')}
					>
						<Alert.Description class="text-destructive">{error}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if turns.length > 0}
					<div class="mt-4.5 border-t pt-4">
						<Label for="{id}-follow-up" class="mb-1 text-xs font-semibold text-muted-foreground">
							Ask a follow-up
						</Label>
						<Textarea
							id="{id}-follow-up"
							rows={2}
							maxlength={MAX_NOTE_LENGTH}
							class="resize-y bg-background text-[13px]"
							placeholder={followUpPlaceholder}
							value={followUp}
							oninput={(event) => (followUp = event.currentTarget.value)}
						/>
						<div class="mt-2 flex flex-wrap items-start justify-between gap-3">
							<p class="{hint} mt-0 max-w-[60ch]">
								Sends this whole conversation again — the same figures, every question you have
								asked and every answer above — plus what you type here. No new figures are sent.
							</p>
							{#if pending === 'follow-up'}
								<Button variant="outline" class="border-input font-semibold" onclick={cancel}>
									Cancel
								</Button>
							{:else}
								<Button
									variant="outline"
									class="border-input font-semibold"
									disabled={busy || followUp.trim() === ''}
									onclick={() => void askAgain()}
								>
									Ask
								</Button>
							{/if}
						</div>
					</div>

					<p class="mt-4 border-t pt-3 text-xs text-faint">
						Written by a language model from the figures above. It can be wrong — every number it
						quotes is checkable against the tables on this page.
					</p>
				{/if}
			{/if}
		</div>
	</Card.Content>
</Card.Root>
