<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { formatCount, formatDate } from '$lib/format.js';
	import { useStatement } from '$lib/state/context.js';
	import { entryLabel, type StatementEntry } from '$lib/state/library.js';
	import { cn } from '$lib/utils.js';

	const app = useStatement();
	const library = $derived(app.library);

	/** Which row is mid-open, so a slow PDF does not look like a dead button. */
	let opening = $state('');
	/** Delete asks once, in place, rather than through a dialog. */
	let confirming = $state('');
	let confirmingClearAll = $state(false);

	async function open(id: string): Promise<void> {
		opening = id;
		try {
			await app.openEntry(id);
		} finally {
			opening = '';
		}

		if (app.hasStatement) await goto(resolve('/'));
	}

	async function remove(id: string): Promise<void> {
		confirming = '';
		await app.deleteEntry(id);
	}

	async function clearAll(): Promise<void> {
		confirmingClearAll = false;
		await app.clearAll();
	}

	/** The files an entry was built from, named for the row that lists it. */
	function files(entry: StatementEntry): string {
		return [entry.pdfName, entry.csvName].filter((name) => name !== '').join(' · ');
	}

	function uploaded(entry: StatementEntry): string {
		return new Date(entry.uploadedAt).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div>
	<h2 class="text-[15px] font-semibold">Your statements</h2>
	<p class="mt-0.5 text-[13px] text-muted-foreground">
		Every statement you open is kept in this browser. Open one to read it; the rest stay where they
		are.
	</p>
</div>

{#if library.loading}
	<p class="py-8 text-center text-sm text-muted-foreground">Reading your statements…</p>
{:else if library.count === 0}
	<Card.Root class="[--card-spacing:--spacing(8)]">
		<Card.Content class="text-center">
			<h3 class="text-[15px] font-semibold">Nothing kept yet</h3>
			<p class="mx-auto mt-1.5 max-w-[46ch] text-sm text-muted-foreground">
				{#if library.keepUploads}
					Upload a statement and it will be saved here, so next month's export joins it rather than
					replacing it.
				{:else}
					Keeping statements in this browser is turned off, so nothing is being saved.
				{/if}
			</p>
			<div class="mt-5">
				<a href={resolve('/')} class={buttonVariants({ variant: 'default' })}>Upload a statement</a>
			</div>
		</Card.Content>
	</Card.Root>
{:else}
	<ul class="grid list-none gap-2.5 p-0">
		{#each library.entries as entry (entry.id)}
			{@const isOpen = entry.id === library.activeId && app.hasStatement}
			<li>
				<Card.Root class={cn('[--card-spacing:--spacing(4)]', isOpen && 'border-good bg-muted/40')}>
					<Card.Content class="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
						<div class="min-w-0">
							<p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
								{#if entry.summary.from === ''}
									{entryLabel(entry)}
								{:else}
									{formatDate(entry.summary.from)} → {formatDate(entry.summary.to)}
								{/if}
								{#if isOpen}
									<span
										class="rounded-full border border-good px-2 py-0.5 text-[11px] font-semibold text-positive"
									>
										Open
									</span>
								{/if}
							</p>

							<p class="mt-1 text-xs text-muted-foreground">
								{formatCount(entry.summary.transactionCount, 'transaction')}
								{#if entry.summary.accounts.length > 0}
									· {entry.summary.accounts.join(', ')}
								{/if}
								· added {uploaded(entry)}
							</p>

							{#if files(entry) !== ''}
								<p class="mt-0.5 truncate text-xs text-faint" title={files(entry)}>
									{files(entry)}
								</p>
							{/if}
						</div>

						<div class="flex flex-none flex-wrap items-center gap-1.5">
							{#if confirming === entry.id}
								<span class="text-xs text-muted-foreground">Delete this statement?</span>
								<Button variant="destructive" size="xs" onclick={() => void remove(entry.id)}>
									Delete
								</Button>
								<Button
									variant="outline"
									size="xs"
									class="border-input"
									onclick={() => (confirming = '')}
								>
									Keep
								</Button>
							{:else}
								<Button
									variant={isOpen ? 'outline' : 'secondary'}
									size="xs"
									class="border-input font-semibold hover:border-series"
									disabled={opening !== ''}
									onclick={() => void open(entry.id)}
								>
									{#if opening === entry.id}
										Opening…
									{:else if isOpen}
										Go to it
									{:else}
										Open
									{/if}
								</Button>
								<Button
									variant="outline"
									size="xs"
									class="border-input bg-transparent text-muted-foreground hover:border-destructive"
									onclick={() => (confirming = entry.id)}
								>
									Delete
								</Button>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
			</li>
		{/each}
	</ul>
{/if}

<footer class="flex flex-wrap items-start justify-between gap-4 border-t pt-4">
	<div class="flex items-start gap-2">
		<Checkbox
			id="keep-uploads"
			class="mt-0.5"
			checked={library.keepUploads}
			onCheckedChange={(next) => void app.setKeepUploads(next === true)}
		/>
		<Label for="keep-uploads" class="block text-[13px] font-normal text-muted-foreground">
			Keep statements in this browser
			<span class="mt-1 block max-w-[52ch] text-xs font-normal text-faint">
				On, so a reload does not lose them and each month's export joins the last. Turning it off
				deletes what is already kept. Nothing is uploaded anywhere either way.
			</span>
		</Label>
	</div>

	{#if library.count > 0}
		<div class="flex flex-wrap items-center gap-2">
			{#if confirmingClearAll}
				<span class="text-xs text-muted-foreground">
					Delete all {library.count}?
				</span>
				<Button variant="destructive" size="sm" onclick={() => void clearAll()}>Delete all</Button>
				<Button
					variant="outline"
					size="sm"
					class="border-input"
					onclick={() => (confirmingClearAll = false)}
				>
					Cancel
				</Button>
			{:else}
				<Button
					variant="outline"
					class="border-input hover:border-destructive"
					onclick={() => (confirmingClearAll = true)}
				>
					Delete every statement
				</Button>
			{/if}
		</div>
	{/if}
</footer>
