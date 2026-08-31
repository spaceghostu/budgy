<script lang="ts">
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		checkForUpdates,
		downloadUpdate,
		installUpdate,
		isDesktop,
		updateStatus,
		type UpdateState
	} from '../desktop/update.ts';

	/**
	 * Where the desktop app says what version it is, and offers a newer one.
	 *
	 * Rendered only in the desktop app — on the web `isDesktop()` is false and
	 * this is nothing at all, rather than a button that explains it cannot work.
	 *
	 * Each step is the reader's: the app checks on launch and says what it found,
	 * and downloads only when asked, because the download is a hundred megabytes
	 * and the check is a few kilobytes. Installing waits for a quit, so an update
	 * never takes the window away mid-sentence.
	 */
	const desktop = isDesktop();

	let update = $state<UpdateState | null>(null);
	/** True while a request the reader started is in flight. */
	let busy = $state(false);

	/** How often to re-read the shell's state while a download is running. */
	const POLL_MS = 700;

	onMount(() => {
		if (!desktop) return;

		// The launch check is the shell's, not this card's — it is already running
		// or already done by the time a window paints. This only reads the result,
		// so opening the app does not start a second one.
		void updateStatus().then((next) => (update = next));

		// A download reports progress to the shell, and the shell is the only
		// thing that knows how far it has got. Polled rather than streamed: an
		// interval that reads one small JSON object is less machinery than a
		// socket, and this is a progress bar, not a trade feed.
		const timer = setInterval(() => {
			if (update?.phase !== 'downloading') return;
			void updateStatus().then((next) => (update = next));
		}, POLL_MS);

		return () => clearInterval(timer);
	});

	/** Run one of the shell's actions, keeping the button honest while it runs. */
	async function run(action: () => Promise<UpdateState>): Promise<void> {
		busy = true;
		try {
			update = await action();
		} finally {
			busy = false;
		}
	}

	/**
	 * Shown only once there is something to say.
	 *
	 * A build that cannot update itself — run from source rather than installed —
	 * says so rather than offering a button that would do nothing, but it says it
	 * quietly, because it is a fact about the build and not a problem to solve.
	 */
	const phase = $derived(update?.phase ?? 'idle');
	const checking = $derived(phase === 'checking' || (busy && phase === 'idle'));
</script>

{#if desktop && update !== null}
	<Card.Root class="gap-0 [--card-spacing:--spacing(4)]">
		<Card.Content class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
			<div class="min-w-0">
				<p class="text-[13px] font-semibold">
					Budgy {update.version}
					{#if phase === 'available' || phase === 'ready'}
						<span class="ml-1 font-normal text-series">· {update.latest} available</span>
					{/if}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{update.message === ''
						? 'The desktop app checks for updates when it starts.'
						: update.message}
				</p>

				{#if phase === 'downloading'}
					<!-- A determinate bar, because the shell knows the total: an
					     indeterminate one on a hundred-megabyte download tells the
					     reader nothing they cannot already see. -->
					<div
						class="mt-2 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-label="Downloading the update"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={update.percent}
					>
						<div class="h-full rounded-full bg-series" style="width: {update.percent}%"></div>
					</div>
				{/if}
			</div>

			<div class="flex flex-none items-center gap-2">
				{#if phase === 'available'}
					<Button size="sm" class="text-[13px]" disabled={busy} onclick={() => run(downloadUpdate)}>
						<DownloadIcon />
						Download {update.latest}
					</Button>
				{:else if phase === 'ready'}
					<!-- Named for what it does. "Install" alone would not warn a reader
					     mid-statement that the window is about to go. -->
					<Button size="sm" class="text-[13px]" disabled={busy} onclick={() => run(installUpdate)}>
						Quit and install
					</Button>
				{/if}

				{#if phase !== 'unsupported' && phase !== 'downloading' && phase !== 'ready'}
					<Button
						variant="outline"
						size="sm"
						class="text-[13px]"
						disabled={busy || checking}
						onclick={() => run(checkForUpdates)}
					>
						<RefreshCwIcon class={checking ? 'animate-spin' : ''} />
						{checking ? 'Checking…' : 'Check for updates'}
					</Button>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
{/if}
