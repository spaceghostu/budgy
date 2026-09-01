<script lang="ts">
	import AiReportCard from '$lib/components/AiReportCard.svelte';
	import { MODEL, type AiBrief } from '../ai/client.ts';
	import { buildForecastPayload } from '../ai/forecast-payload.ts';
	import { FORECAST_SYSTEM_PROMPT, PLAN_TOOL, buildForecastPrompt } from '../ai/forecast-prompt.ts';
	import { formatDate } from '../format.ts';
	import { CALENDAR_START } from '../stats/cycle.ts';
	import type { ForecastWindow } from '../stats/forecast.ts';
	import type { Runway } from '../stats/runway.ts';

	interface Props {
		/** The same runway the line, the tiles and the lists on this page draw. */
		runway: Runway;
		/** How many months the projection was learned from. */
		window: ForecastWindow;
		/** Day of the month the reader is paid on. */
		monthStart?: number;
		/** True while the balance is a shape rather than real money. */
		isRelative?: boolean;
		/** False when the page has been narrowed to the named charges alone. */
		everydayCounted?: boolean;
	}

	const {
		runway,
		window,
		monthStart = CALENDAR_START,
		isRelative = false,
		everydayCounted = true
	}: Props = $props();

	let note = $state('');

	/**
	 * Built from the runway on screen rather than from the statement, so the plan
	 * is written about the month the reader is looking at — the window they chose,
	 * the charges they have ticked off, and the everyday spending only if the page
	 * is counting it.
	 */
	const payload = $derived(
		buildForecastPayload(runway, { monthStart, isRelative, everydayCounted, window })
	);

	/** Fixed instructions and a forced tool, the way the insights card has them. */
	const brief: AiBrief = { system: FORECAST_SYSTEM_PROMPT, tool: PLAN_TOOL };

	/**
	 * What a press of the button is worth saying up front.
	 *
	 * Without a balance the plan cannot say whether the money lasts — only what
	 * the month costs and what could be saved — and that is worth knowing before
	 * spending a call rather than after reading one.
	 */
	const description = $derived(
		isRelative
			? `A plan for getting to payday, from ${MODEL}. Set your current balance on the overview and it can also say whether the money lasts.`
			: `A plan for getting to ${formatDate(runway.payday)} on what is in the account, from ${MODEL}.`
	);
</script>

<AiReportCard
	title="Ask Claude how to get through the month"
	{description}
	{brief}
	buildPreview={(text) => buildForecastPrompt(payload, text)}
	{note}
	onnote={(next) => (note = next)}
	sendLabel="Plan the rest of my month"
	busyLabel="Reading the {payload.period.daysLeft} days to payday…"
	sends="what is in the account, the charges still expected and what each category usually takes"
	noteHint="Steers the plan — a bill you know is coming, an amount you are trying to keep back. Sent word for word, so leave anything out you would not want to send."
	notePlaceholder="I need to keep R3 000 back for tyres. · Which of these can I put off until after payday? · Groceries are for three people, not one."
	followUpPlaceholder="What would cutting the takeaways to nothing be worth? · Which of those is safe to skip this month? · Give me a daily number to stick to."
	describeSent={() =>
		`This plan is about the ${payload.period.daysLeft} days to ${formatDate(payload.period.payday)} as the figures stood when it was written. They have changed since — follow-ups carry on about the earlier ones, so start again to catch up.`}
/>
