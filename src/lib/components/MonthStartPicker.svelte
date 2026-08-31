<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { formatOrdinal } from '../format.ts';
	import type { StatementState } from '../state/statement.svelte.ts';
	import { CALENDAR_START, MONTH_START_DAYS } from '../stats/cycle.ts';

	interface Props {
		state: StatementState;
	}

	const { state }: Props = $props();

	/**
	 * The setting reads as what it does, not as a number.
	 *
	 * "Months start on the 25th" is the sentence a reader would say out loud; a
	 * bare "25" beside a chart would be read as a date on it.
	 */
	const label = $derived(
		state.monthStart === CALENDAR_START
			? 'Calendar months'
			: `Months from the ${formatOrdinal(state.monthStart)}`
	);
</script>

<Select.Root
	type="single"
	value={`${state.monthStart}`}
	onValueChange={(day) => state.setMonthStart(Number(day))}
>
	<Select.Trigger aria-label="Day the month starts on" class="h-8 text-[13px]">
		{label}
	</Select.Trigger>
	<Select.Content>
		{#each MONTH_START_DAYS as day (day)}
			<Select.Item value={`${day}`} label={`Months from the ${formatOrdinal(day)}`}>
				{day === CALENDAR_START
					? 'Calendar months (the 1st)'
					: `Months from the ${formatOrdinal(day)}`}
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
