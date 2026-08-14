<script lang="ts">
	import {
		MAX_CATEGORY_LENGTH,
		resolveCategory,
		type AppliedRule,
		type MerchantGroup
	} from '../categorise.ts';
	import { formatCount, formatCurrency, formatDate } from '../format.ts';

	interface Props {
		/** Merchants still without a category, heaviest first. */
		pending: readonly MerchantGroup[];
		/** The choices already made, whether or not this period shows them. */
		applied: readonly AppliedRule[];
		options: readonly string[];
		/** A blank takes the merchant's choice back off again. */
		onassign: (merchant: string, category: string) => void;
	}

	const { pending, applied, options, onassign }: Props = $props();

	/**
	 * Merchants shown before the "show all" control appears.
	 *
	 * Heaviest first, so the few that carry most of the unfiled money are the
	 * ones on screen: a real export left 266 rows unfiled across 86 merchants,
	 * and the top handful of those was most of the money.
	 */
	const PAGE_SIZE = 8;

	let expanded = $state(false);

	/** The one merchant, if any, having a category typed for it. */
	let naming = $state<string | null>(null);
	let draft = $state('');

	const visible = $derived(expanded ? pending : pending.slice(0, PAGE_SIZE));
	const total = $derived(pending.reduce((sum, group) => sum + group.total, 0));

	/**
	 * What the typed name would file under — the existing category when there
	 * already is one by that name, so the same spending cannot end up split
	 * across two spellings of it.
	 */
	const resolved = $derived(resolveCategory(draft, options));

	/** Said while it is being typed, rather than swallowing the name on submit. */
	const problem = $derived(
		draft.trim() === '' || resolved !== null
			? null
			: 'Uncategorised is what these rows already are. Give it another name.'
	);

	const isNew = $derived(
		resolved !== null && !options.some((option) => option === resolved) ? resolved : null
	);

	function open(merchant: string): void {
		naming = merchant;
		draft = '';
	}

	function close(): void {
		naming = null;
		draft = '';
	}

	function add(merchant: string): void {
		if (resolved === null) return;

		onassign(merchant, resolved);
		close();
	}

	function keys(event: KeyboardEvent, merchant: string): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			add(merchant);
		}
		if (event.key === 'Escape') close();
	}

	/** Put the cursor where the reader has just said they want to type. */
	function takeFocus(node: HTMLInputElement): void {
		node.focus();
	}
</script>

<!-- The picker for one merchant: the categories that exist, or a name of your
     own. Shared by both lists, so one can be made from either. -->
{#snippet picker(merchant: string, current: string)}
	{#if naming === merchant}
		<div class="naming">
			<div class="entry">
				<input
					type="text"
					aria-label="New category ({merchant})"
					placeholder="Name the category"
					maxlength={MAX_CATEGORY_LENGTH}
					bind:value={draft}
					onkeydown={(event) => keys(event, merchant)}
					use:takeFocus
				/>
				<button type="button" disabled={resolved === null} onclick={() => add(merchant)}>
					Add
				</button>
				<button type="button" class="plain" onclick={close}>Cancel</button>
			</div>

			{#if problem !== null}
				<p class="problem" role="alert">{problem}</p>
			{:else if isNew === null && resolved !== null}
				<p class="problem">There is already a {resolved} — this files it there.</p>
			{/if}
		</div>
	{:else}
		<select
			aria-label="Category for {merchant}"
			value={current}
			onchange={(event) => onassign(merchant, event.currentTarget.value)}
		>
			{#if current === ''}
				<option value="">Choose a category…</option>
			{:else if !options.includes(current)}
				<!-- A choice made against an earlier statement can name a category
				     these files never use. It still has to show what it is. -->
				<option value={current}>{current}</option>
			{/if}
			{#each options as option (option)}
				<option value={option}>{option}</option>
			{/each}
		</select>

		<button
			type="button"
			class="new"
			aria-label="New category ({merchant})"
			onclick={() => open(merchant)}
		>
			+ New
		</button>
	{/if}
{/snippet}

{#if pending.length > 0}
	<p class="lede">
		{formatCurrency(total)} across {formatCount(pending.length, 'merchant')} has no category, so the breakdowns
		cannot place it. Choosing one files every transaction from that merchant — in this statement and in
		next month's.
	</p>

	<ul class="pending">
		{#each visible as group (group.merchant)}
			<li>
				<div class="who">
					<span class="merchant" title={group.merchant}>{group.merchant}</span>
					<span class="meta">
						{formatCount(group.count, 'transaction')} · {formatCurrency(group.total)} · last
						{formatDate(group.lastSeen)}
					</span>
					<!-- The merchant name is the description with its reference numbers
					     stripped, which can leave a code. The line it came from says more. -->
					{#if group.example !== '' && group.example !== group.merchant}
						<span class="example" title={group.example}>{group.example}</span>
					{/if}
				</div>

				<div class="choose">
					<!-- Where the same merchant is filed elsewhere in the statement — the
					     usual case for a row the two files could not match — that answer
					     is one press away rather than a hunt through the list. -->
					{#if group.suggestion !== null && naming !== group.merchant}
						{@const suggestion = group.suggestion}
						<button
							type="button"
							class="suggestion"
							onclick={() => onassign(group.merchant, suggestion)}
						>
							Use {suggestion}
						</button>
					{/if}

					{@render picker(group.merchant, '')}
				</div>
			</li>
		{/each}
	</ul>

	{#if pending.length > PAGE_SIZE}
		<button class="more" type="button" onclick={() => (expanded = !expanded)}>
			{expanded ? 'Show fewer' : `Show all ${pending.length}`}
		</button>
	{/if}
{:else}
	<p class="done">Every transaction in this period is filed under something.</p>
{/if}

{#if applied.length > 0}
	<section class="applied">
		<h3>Your categories</h3>
		<p class="note">Kept on this device, and applied to every statement you open here.</p>

		<ul>
			{#each applied as rule (rule.merchant)}
				<li>
					<span class="merchant" title={rule.merchant}>{rule.merchant}</span>

					{@render picker(rule.merchant, rule.category)}

					<span class="meta">
						{rule.count === 0 ? 'nothing in these files' : formatCount(rule.count, 'transaction')}
					</span>

					<button
						type="button"
						class="remove"
						aria-label="Clear the choice for {rule.merchant}"
						onclick={() => onassign(rule.merchant, '')}
					>
						✕
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.lede,
	.done,
	.note {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}

	.done {
		padding: 8px 0;
	}

	ul {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.pending li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
		flex-wrap: wrap;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}

	.pending li:first-child {
		border-top: 1px solid var(--border);
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.merchant {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		color: var(--text-primary);
	}

	.meta,
	.example {
		font-size: 12px;
		color: var(--text-muted);
	}

	.example {
		max-width: 42ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.choose {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}

	select,
	input {
		padding: 6px 10px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 13px;
		max-width: 15rem;
	}

	.naming {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.problem {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}

	.suggestion,
	.new,
	.entry button,
	.more {
		padding: 6px 11px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		cursor: pointer;
	}

	.suggestion:hover,
	.new:hover,
	.entry button:hover:not(:disabled),
	.more:hover {
		border-color: var(--series-1);
		color: var(--text-primary);
	}

	.entry button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* Cancel is the way back, not a second thing to press. */
	.entry button.plain,
	.entry button.plain:hover {
		border-color: transparent;
		background: transparent;
		color: var(--text-muted);
	}

	.more {
		margin-top: 12px;
	}

	.applied {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.applied h3 {
		margin: 0 0 2px;
		font-size: 13px;
		font-weight: 600;
	}

	.applied li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
	}

	.applied .merchant {
		flex: 1;
		min-width: 0;
	}

	.applied .meta {
		flex: none;
		text-align: right;
	}

	.remove {
		flex: none;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		font-size: 12px;
		color: var(--text-muted);
		cursor: pointer;
	}

	.remove:hover {
		border-color: var(--status-critical);
		color: var(--text-primary);
	}

	@media (max-width: 560px) {
		.choose,
		select {
			width: 100%;
			max-width: none;
		}

		.applied .meta {
			display: none;
		}
	}
</style>
