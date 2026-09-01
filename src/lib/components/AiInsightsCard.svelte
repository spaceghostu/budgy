<script lang="ts">
	import AiReportCard from '$lib/components/AiReportCard.svelte';
	import { MODEL, SPENDING_BRIEF } from '../ai/client.ts';
	import { buildAiPayload } from '../ai/payload.ts';
	import { buildUserPrompt } from '../ai/prompt.ts';
	import { formatDate } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import type { Insights } from '../types.ts';

	interface Props {
		insights: Insights;
		/** Day of the month the reader's months open on. */
		monthStart?: number;
	}

	const { insights, monthStart = CALENDAR_START }: Props = $props();

	let note = $state('');

	const payload = $derived(buildAiPayload(insights, monthStart));

	/**
	 * What the figures on screen are about, named for the stale warning.
	 *
	 * Read from the payload rather than kept beside it, so the sentence and the
	 * message it is about can only ever describe the same period.
	 */
	const period = $derived(payload.period);
</script>

<AiReportCard
	title="Ask Claude"
	description="A written read of the period shown above, from {MODEL}."
	brief={SPENDING_BRIEF}
	buildPreview={(text) => buildUserPrompt(payload, text)}
	{note}
	onnote={(next) => (note = next)}
	sendLabel="Read my spending"
	busyLabel="Reading {payload.totals.transactionCount} transactions…"
	sends="totals, category and merchant rollups, per-month flow, recurring charges"
	notePlaceholder="Saving for a deposit in June — what is in the way? · Why was January so much worse than December? · Ignore the medical bills, they were a one-off."
	followUpPlaceholder="Break down those bank fees. · Which of those subscriptions is the newest? · What would cutting the takeaways in half be worth over a year?"
	describeSent={() =>
		`This conversation is about ${formatDate(period.from)} to ${formatDate(period.to)}. The figures on screen have changed since — follow-ups carry on about the earlier period, so start again to catch up.`}
/>
