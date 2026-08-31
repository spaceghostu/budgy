<script lang="ts">
	import AiInsightsCard from '$lib/components/AiInsightsCard.svelte';
	import NoStatement from '$lib/components/NoStatement.svelte';
	import { useStatement } from '$lib/state/context.js';

	const state = useStatement();
</script>

{#if !state.hasStatement}
	<NoStatement what="A written read of the period" savedCount={state.library.count} />
{:else}
	<!-- On its own page, and the only one that can send anything off the device.
	     It asks first, and shows what it would send. -->
	<AiInsightsCard insights={state.insights} monthStart={state.monthStart} />
{/if}
