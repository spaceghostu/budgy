<script lang="ts">
	import { formatMonth } from '../format.ts';
	import { RANGE_OPTIONS, ALL_ACCOUNTS, type StatementState } from '../state/statement.svelte.ts';

	interface Props {
		state: StatementState;
	}

	const { state }: Props = $props();

	const showAccounts = $derived(state.accounts.length > 1);

	const monthIndex = $derived(state.months.indexOf(state.activeMonth));
	const atOldest = $derived(monthIndex <= 0);
	const atNewest = $derived(monthIndex < 0 || monthIndex === state.months.length - 1);
</script>

<!-- One row, above everything it scopes: every figure below re-renders together. -->
<div class="filters">
	{#if showAccounts}
		<label class="field">
			<span>Account</span>
			<select bind:value={state.account}>
				{#each state.accounts as account (account)}
					<option value={account}>{account}</option>
				{/each}
				<option value={ALL_ACCOUNTS}>All accounts</option>
			</select>
		</label>
	{/if}

	<div class="field">
		<span id="range-label">Period</span>
		<div class="presets" role="group" aria-labelledby="range-label">
			{#each RANGE_OPTIONS as option (option.id)}
				<button
					type="button"
					class:selected={state.range === option.id}
					aria-pressed={state.range === option.id}
					onclick={() => (state.range = option.id)}
				>
					{#if state.range === option.id}<span class="check" aria-hidden="true">✓</span>{/if}
					{option.label}
				</button>
			{/each}
		</div>
	</div>

	{#if state.range === 'month'}
		<div class="field">
			<span id="month-label">Showing</span>
			<!-- Arrows for the common step, the select for a jump across the year. -->
			<div class="stepper" role="group" aria-labelledby="month-label">
				<button
					type="button"
					aria-label="Previous month"
					disabled={atOldest}
					onclick={() => state.stepMonth(-1)}>‹</button
				>
				<!-- Reads from the resolved month, not the raw selection, which starts
				     blank and stands for "whichever month is newest". -->
				<select
					value={state.activeMonth}
					aria-label="Month"
					onchange={(event) => (state.selectedMonth = event.currentTarget.value)}
				>
					{#each [...state.months].reverse() as month (month)}
						<option value={month}>{formatMonth(month)}</option>
					{/each}
				</select>
				<button
					type="button"
					aria-label="Next month"
					disabled={atNewest}
					onclick={() => state.stepMonth(1)}>›</button
				>
			</div>
		</div>
	{/if}

	{#if state.range === 'custom'}
		<label class="field">
			<span>From</span>
			<input
				type="date"
				bind:value={state.customFrom}
				min={state.earliestDate}
				max={state.latestDate}
			/>
		</label>
		<label class="field">
			<span>To</span>
			<input
				type="date"
				bind:value={state.customTo}
				min={state.earliestDate}
				max={state.latestDate}
			/>
		</label>
	{/if}
</div>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	.field > span {
		font-size: 12px;
		color: var(--text-secondary);
	}

	select,
	input[type='date'] {
		padding: 6px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
	}

	.stepper {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface-1);
	}

	.stepper select {
		border: 0;
		border-radius: 0;
		min-width: 118px;
	}

	.stepper button {
		border: 0;
		background: transparent;
		padding: 0 11px;
		font-size: 15px;
		line-height: 1;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.stepper button:hover:not(:disabled) {
		background: var(--surface-2);
	}

	.stepper button:disabled {
		color: var(--text-muted);
		opacity: 0.45;
		cursor: default;
	}

	.presets {
		display: inline-flex;
		flex-wrap: wrap;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface-1);
	}

	.presets button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 0;
		background: transparent;
		padding: 6px 11px;
		font-size: 13px;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.presets button + button {
		border-left: 1px solid var(--border);
	}

	/* Hover stays a ghost wash so it never competes with the selection mark. */
	.presets button:hover:not(.selected) {
		background: var(--surface-2);
	}

	.presets button.selected {
		background: var(--surface-2);
		color: var(--text-primary);
		font-weight: 600;
	}

	.check {
		font-size: 11px;
		font-weight: 700;
	}
</style>
