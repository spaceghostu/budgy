<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';

	interface Props {
		/** What this particular page would have shown. */
		what: string;
		/** True once the history is known to be empty, rather than still loading. */
		savedCount: number;
	}

	const { what, savedCount }: Props = $props();
</script>

<!-- Every page but the first can be landed on directly — from a bookmark, or a
     reload after navigating — so each says what it needs rather than drawing
     an empty chart. -->
<Card.Root class="[--card-spacing:--spacing(8)]">
	<Card.Content class="text-center">
		<h2 class="text-[15px] font-semibold">Nothing open yet</h2>
		<p class="mx-auto mt-1.5 max-w-[46ch] text-sm text-muted-foreground">
			{what} appears here once a statement is open.
		</p>

		<div class="mt-5 flex flex-wrap justify-center gap-2">
			<a href={resolve('/')} class={buttonVariants({ variant: 'default' })}>Upload a statement</a>
			{#if savedCount > 0}
				<a href={resolve('/history')} class={buttonVariants({ variant: 'outline' })}>
					Open a saved one ({savedCount})
				</a>
			{/if}
		</div>
	</Card.Content>
</Card.Root>
