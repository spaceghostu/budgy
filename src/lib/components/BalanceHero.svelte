<script lang="ts">
	import { CURRENCY_SYMBOL, formatCurrency, formatDate, formatSigned } from '../format.ts';
	import { parseAmount } from '../parse/statement.ts';
	import type { PeriodSummary } from '../types.ts';

	interface Props {
		summary: PeriodSummary;
		/** True while no real balance has been supplied — the figure is net change. */
		isRelative: boolean;
		anchor: number;
		/** True when the bank printed the balances, so nothing needs anchoring. */
		isCertified?: boolean;
		/** True when a stored anchor no longer matches this statement's last date. */
		isStale?: boolean;
		account?: string;
		onanchor: (balance: number | null) => void;
	}

	const {
		summary,
		isRelative,
		anchor,
		isCertified = false,
		isStale = false,
		account = '',
		onanchor
	}: Props = $props();

	let editing = $state(false);
	let draft = $state('');
	let invalid = $state(false);

	function open(): void {
		draft = isRelative ? '' : `${anchor}`;
		invalid = false;
		editing = true;
	}

	function commit(event: SubmitEvent): void {
		event.preventDefault();

		const trimmed = draft.trim();
		if (trimmed === '') {
			onanchor(null);
			editing = false;
			return;
		}

		// The statement parser already reads every separator convention a South
		// African keyboard produces — "4820,55" and "4 820.55" both mean the same
		// balance, and getting this wrong would silently skew every figure.
		const parsed = parseAmount(trimmed);
		if (parsed === null) {
			invalid = true;
			return;
		}

		invalid = false;
		onanchor(parsed);
		editing = false;
	}
</script>

<div class="hero">
	<div class="figure">
		<p class="label">
			{isRelative ? 'Net change over this period' : 'Balance at the end of this period'}
		</p>
		<p class="value">
			{formatCurrency(isRelative ? summary.balanceChange : summary.closingBalance)}
		</p>
		<p class="context">
			{formatDate(summary.from)} – {formatDate(summary.to)} ·
			{formatSigned(summary.balanceChange)} over {summary.days}
			{summary.days === 1 ? 'day' : 'days'}
		</p>
	</div>

	<div class="anchor">
		{#if isCertified}
			<!-- The certified statement prints a balance on every row, so there is
			     nothing to anchor and nothing for the reader to do here. -->
			<p class="certified">
				<span class="tick" aria-hidden="true">✓</span>
				<span>
					Balances come from the certified statement{account === '' ? '' : ` for ${account}`}, and
					every one was checked against the row before it.
				</span>
			</p>
		{:else if editing}
			<form onsubmit={commit}>
				<label for="anchor-input">Your current balance</label>
				<div class="row">
					<span class="prefix">{CURRENCY_SYMBOL}</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="anchor-input"
						type="text"
						inputmode="decimal"
						placeholder="12500.00"
						aria-invalid={invalid}
						aria-describedby="anchor-help"
						bind:value={draft}
						autofocus
					/>
					<button type="submit" class="primary">Save</button>
					<button type="button" onclick={() => (editing = false)}>Cancel</button>
				</div>
				<p class="help" id="anchor-help" class:invalid>
					{#if invalid}
						That is not a number this can read. Try something like 4820.55 or 4820,55.
					{:else}
						The figure from your banking app, as of the most recent transaction in this statement.
						Leave it empty to go back to showing net change. Stored only in this browser.
					{/if}
				</p>
			</form>
		{:else}
			<button type="button" class="primary" onclick={open}>
				{isRelative ? 'Set your current balance' : 'Change balance'}
			</button>
			<p class="help">
				{#if isStale}
					This statement runs to {formatDate(summary.to)}, later than the balance you last entered —
					re-enter it to make these figures real again.
				{:else if isRelative}
					A CSV export lists amounts but no balances. Add yours and every figure becomes real.
				{:else}
					Anchored to {formatCurrency(anchor)} after the most recent transaction.
				{/if}
			</p>
		{/if}
	</div>
</div>

<style>
	.hero {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		padding: 24px;
	}

	p {
		margin: 0;
	}

	.label {
		font-size: 13px;
		color: var(--text-secondary);
	}

	.value {
		margin-top: 4px;
		font-size: 52px;
		font-weight: 600;
		line-height: 1.05;
		letter-spacing: -0.03em;
		/* Proportional figures — tabular digits look loose at display size. */
	}

	.context {
		margin-top: 8px;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.anchor {
		max-width: 34ch;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
	}

	label {
		font-size: 12px;
		color: var(--text-secondary);
	}

	.prefix {
		color: var(--text-muted);
	}

	input {
		width: 8em;
		padding: 6px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	button {
		padding: 6px 12px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
		cursor: pointer;
	}

	button.primary {
		background: var(--surface-2);
		font-weight: 600;
	}

	button:hover {
		border-color: var(--series-1);
	}

	.help {
		margin-top: 8px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.help.invalid {
		color: var(--status-critical);
	}

	.certified {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 12.5px;
		color: var(--text-secondary);
	}

	.certified .tick {
		flex: none;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--status-good);
		color: var(--surface-1);
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
	}

	input[aria-invalid='true'] {
		border-color: var(--status-critical);
	}

	@media (max-width: 620px) {
		.value {
			font-size: 40px;
		}
	}
</style>
