<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/styles/tokens.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Budgy — bank statement insights</title>
	<meta
		name="description"
		content="Turn a bank statement CSV into a balance chart and spending insights, entirely in your browser."
	/>
</svelte:head>

{@render children()}
