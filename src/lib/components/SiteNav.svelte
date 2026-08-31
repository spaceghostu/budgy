<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { cn } from '$lib/utils.js';

	interface Props {
		/** How many statements are kept, shown against History. */
		savedCount: number;
	}

	const { savedCount }: Props = $props();

	interface Section {
		/** A route id, so it can be resolved against the deployed base path. */
		readonly id:
			| '/'
			| '/net-worth'
			| '/spending'
			| '/recurring'
			| '/forecast'
			| '/transactions'
			| '/insights'
			| '/history';
		readonly label: string;
	}

	/**
	 * The dashboard, split by the question each page answers.
	 *
	 * Ordered the way a statement is read: what happened, where it went, what
	 * repeats, what is still coming, then the rows themselves — with the two that
	 * are not about this period at the end.
	 *
	 * Net worth sits second because it answers the widest question, and because
	 * it is the one page the period row above does not scope. Forecast follows
	 * Recurring because it is built on it: the charges that repeat are most of
	 * what the rest of a month is already committed to.
	 */
	const SECTIONS: readonly Section[] = [
		{ id: '/', label: 'Overview' },
		{ id: '/net-worth', label: 'Net worth' },
		{ id: '/spending', label: 'Spending' },
		{ id: '/recurring', label: 'Recurring' },
		{ id: '/forecast', label: 'Forecast' },
		{ id: '/transactions', label: 'Transactions' },
		{ id: '/insights', label: 'Ask Claude' },
		{ id: '/history', label: 'History' }
	];
</script>

<nav aria-label="Sections" class="-mx-1 overflow-x-auto">
	<ul class="flex list-none gap-0.5 p-1">
		{#each SECTIONS as section (section.id)}
			<!-- Matched on the route rather than the path, so no prefix rule is
			     needed to stop `/` claiming every page. -->
			{@const current = page.route.id === section.id}
			<li>
				<a
					href={resolve(section.id)}
					aria-current={current ? 'page' : undefined}
					class={cn(
						'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
						current
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
					)}
				>
					{section.label}
					{#if section.id === '/history' && savedCount > 0}
						<span
							class="rounded-full bg-background px-1.5 text-[11px] font-semibold text-muted-foreground tabular-nums"
						>
							{savedCount}
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
