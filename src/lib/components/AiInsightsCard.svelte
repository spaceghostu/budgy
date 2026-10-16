<script lang="ts">
	import AiReportCard from '$lib/components/AiReportCard.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { MODEL, SPENDING_BRIEF } from '../ai/client.ts';
	import { buildAiPayload } from '../ai/payload.ts';
	import { buildPromptFigures, withNote } from '../ai/prompt.ts';
	import { formatDate } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import type { Insights, Transaction } from '../types.ts';

	interface Props {
		insights: Insights;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
		/**
		 * The lines {@link insights} was built from — the period on screen, filters
		 * and all. Only ever sent when the reader ticks the box for it.
		 */
		transactions?: readonly Transaction[];
	}

	const { insights, monthStart = CALENDAR_START, transactions = [] }: Props = $props();

	let note = $state('');

	/**
	 * Whether every line goes with the totals.
	 *
	 * Off on every visit and never stored: a choice to send descriptions,
	 * references and account numbers is made for one read, not once for good.
	 */
	let sendAll = $state(false);

	const id = $props.id();

	const lineCount = $derived(transactions.length);
	const lines = $derived(`${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`);

	/**
	 * Whether the lines are actually going.
	 *
	 * The box is hidden while there are no lines to send, and a hidden box that
	 * was left ticked must not send them the moment the filters bring some back.
	 */
	const sending = $derived(sendAll && lineCount > 0);

	const payload = $derived(
		buildAiPayload(insights, monthStart, sending ? transactions : undefined)
	);

	/**
	 * The message less the note, built once per payload rather than on every
	 * keystroke in the note box — with every line going, it is thousands of them.
	 */
	const figures = $derived(buildPromptFigures(payload));

	/**
	 * What the figures on screen are about, named for the stale warning.
	 *
	 * Read from the payload rather than kept beside it, so the sentence and the
	 * message it is about can only ever describe the same period.
	 */
	const period = $derived(payload.period);
</script>

{#snippet options()}
	{#if lineCount > 0}
		<div class="mt-3.5 flex items-start gap-2">
			<Checkbox
				id="{id}-send-all"
				class="mt-0.5"
				checked={sendAll}
				onCheckedChange={(next) => (sendAll = next === true)}
			/>
			<Label for="{id}-send-all" class="block text-[13px] font-normal text-muted-foreground">
				Send every transaction in full ({lines})
				<span class="mt-1 block max-w-[60ch] text-xs font-normal text-faint">
					Lets Claude answer what the totals cannot — which payment that was, what one merchant's
					lines came to. Sends each line as the bank gave it: description, reference, counterparty,
					account name and number, time, running balance and your notes. Off by default, never
					remembered, and a long period costs more to send.
				</span>
			</Label>
		</div>
	{/if}
{/snippet}

<AiReportCard
	title="Ask Claude"
	description="A written read of the period shown above, from {MODEL}."
	brief={SPENDING_BRIEF}
	buildPreview={(text) => withNote(figures, text)}
	{note}
	onnote={(next) => (note = next)}
	sendLabel="Read my spending"
	busyLabel={sending
		? `Reading ${lines}…`
		: `Reading ${payload.totals.transactionCount} transactions…`}
	sends={sending
		? 'totals, category and merchant rollups, per-month flow, recurring charges and every transaction'
		: 'totals, category and merchant rollups, per-month flow, recurring charges'}
	includes={sending
		? `Every transaction in the period goes with it, in full — ${lines}, descriptions, references, account names and numbers, counterparties, running balances and notes included`
		: undefined}
	{options}
	notePlaceholder="Saving for a deposit in June — what is in the way? · Why was January so much worse than December? · Ignore the medical bills, they were a one-off."
	followUpPlaceholder="Break down those bank fees. · Which of those subscriptions is the newest? · What would cutting the takeaways in half be worth over a year?"
	describeSent={() =>
		`This conversation is about ${formatDate(period.from)} to ${formatDate(period.to)}, sent ${sending ? `with every transaction (${lines})` : 'as totals only'}. What is on screen has changed since — follow-ups carry on about what was sent, so start again to catch up.`}
/>
