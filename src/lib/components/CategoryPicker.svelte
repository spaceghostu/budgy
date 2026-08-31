<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { MAX_CATEGORY_LENGTH, resolveCategory } from '../categorise.ts';

	interface Props {
		/**
		 * The merchant the choice is filed against. Rules are keyed by merchant,
		 * never by transaction — see the note at the top of `categorise.ts`.
		 */
		merchant: string;
		/** The category in force, or `''` where the merchant has none. */
		current?: string;
		options: readonly string[];
		/** The categories last chosen, most recent first — the shortlist. */
		recent?: readonly string[];
		/** A blank takes the merchant's choice back off again. */
		onassign: (merchant: string, category: string) => void;
		/** Shown when nothing is filed yet. */
		placeholder?: string;
	}

	const {
		merchant,
		current = '',
		options,
		recent = [],
		onassign,
		placeholder = 'Choose a category…'
	}: Props = $props();

	/** True while a category of the reader's own is being typed. */
	let naming = $state(false);
	let draft = $state('');
	let picking = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);

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

	/**
	 * A choice made against an earlier statement can name a category these files
	 * never use. It still has to be offered, and shown as the current one.
	 */
	const choices = $derived(
		current !== '' && !options.includes(current) ? [current, ...options] : options
	);

	/**
	 * The picker in two groups: the handful last used, then everything else.
	 *
	 * Filing a month of stray rows means reaching for the same few categories over
	 * and over, and hunting each one out of sixty alphabetical names is the slow
	 * part. Nothing appears twice — a shortlisted category is taken out of the long
	 * list rather than repeated in it, so arrowing down never passes the same name
	 * twice.
	 */
	const shortlist = $derived(recent.filter((category) => choices.includes(category)));
	const rest = $derived(choices.filter((category) => !shortlist.includes(category)));

	function close(): void {
		naming = false;
		draft = '';
	}

	function add(): void {
		if (resolved === null) return;

		onassign(merchant, resolved);
		close();
	}

	function keys(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			add();
		}
		if (event.key === 'Escape') close();
	}

	/** Put the cursor where the reader has just said they want to type. */
	$effect(() => {
		if (naming) nameInput?.focus();
	});

	/** Dressed as the select trigger it replaces, so rows of these still match. */
	const triggerLook =
		'flex h-8 w-full max-w-60 items-center justify-between gap-1.5 rounded-lg border border-input' +
		' bg-transparent py-2 pr-2 pl-2.5 text-[13px] whitespace-nowrap transition-colors outline-none' +
		' select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50' +
		' dark:bg-input/30 dark:hover:bg-input/50 max-[560px]:max-w-none';

	const quietButton =
		'border-input text-muted-foreground hover:border-series hover:text-foreground';
</script>

{#if naming}
	<div class="flex min-w-0 flex-col gap-1">
		<div class="flex items-center gap-2">
			<Input
				type="text"
				aria-label="New category ({merchant})"
				placeholder="Name the category"
				class="max-w-60 text-[13px]"
				maxlength={MAX_CATEGORY_LENGTH}
				bind:value={draft}
				onkeydown={keys}
				bind:ref={nameInput}
			/>
			<Button
				variant="outline"
				size="xs"
				class={quietButton}
				disabled={resolved === null}
				onclick={add}
			>
				Add
			</Button>
			<!-- Cancel is the way back, not a second thing to press. -->
			<Button variant="ghost" size="xs" class="text-faint" onclick={close}>Cancel</Button>
		</div>

		{#if problem !== null}
			<p class="text-xs text-faint" role="alert">{problem}</p>
		{:else if isNew === null && resolved !== null}
			<p class="text-xs text-faint">There is already a {resolved} — this files it there.</p>
		{/if}
	</div>
{:else}
	<!-- A combobox rather than a plain list: a bank's own category list runs to
	     sixty-odd names, which is past the point where scrolling for one beats
	     typing three letters of it. -->
	<Popover.Root open={picking} onOpenChange={(open) => (picking = open)}>
		<Popover.Trigger
			role="combobox"
			aria-label="Category for {merchant}"
			class={triggerLook}
			onkeydown={(event) => {
				// The arrow that opens a listbox, so the picker can be reached
				// without leaving the keyboard to find the button.
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					picking = true;
				}
			}}
		>
			{#if current === ''}
				<span class="truncate text-muted-foreground">{placeholder}</span>
			{:else}
				<span class="truncate font-semibold text-foreground">{current}</span>
			{/if}
			<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		</Popover.Trigger>
		<!--
			The page is pinned while the panel is open, the way this app's other
			dropdowns already are. Without it, focus moving into a panel taller than
			the room under the trigger scrolls the page to reach it — and the panel
			is portalled to the end of the body, so that scroll can go all the way to
			the top. Holding the page still is what makes the panel stay where the
			reader put it.
		-->
		<Popover.Content
			class="max-h-(--bits-floating-available-height) w-60 overflow-hidden p-0"
			preventScroll
		>
			<Command.Root class="min-h-0 flex-1">
				<Command.Input placeholder="Find a category…" />
				<!-- Bounded by the room the trigger has rather than a fixed height:
				     the page cannot be scrolled while this is open, so a panel taller
				     than the viewport would put its own contents out of reach. -->
				<Command.List class="min-h-0 flex-1">
					<Command.Empty>No category by that name.</Command.Empty>
					{#if shortlist.length > 0}
						<Command.Group heading="Recent">
							{#each shortlist as option (option)}
								{@render choice(option)}
							{/each}
						</Command.Group>
					{/if}
					<Command.Group heading={shortlist.length > 0 ? 'All categories' : undefined}>
						{#each rest as option (option)}
							{@render choice(option)}
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>

	<Button
		variant="outline"
		size="xs"
		class={quietButton}
		aria-label="New category ({merchant})"
		onclick={() => {
			naming = true;
			draft = '';
		}}
	>
		+ New
	</Button>
{/if}

{#snippet choice(option: string)}
	<Command.Item
		value={option}
		data-checked={option === current}
		onSelect={() => {
			onassign(merchant, option);
			picking = false;
		}}
	>
		{option}
	</Command.Item>
{/snippet}
