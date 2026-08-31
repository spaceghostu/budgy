import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * `ANTHROPIC_API_KEY` from `.env`, substituted into the bundle at build time.
 *
 * Read here rather than through `$env`: SvelteKit only hands the browser
 * `PUBLIC_`-prefixed variables, and this one is deliberately named without that
 * prefix, because putting it in a bundle is a decision to be made once, in the
 * open, by whoever builds — not a naming convention that makes it routine. What
 * that decision costs is written out in `src/lib/ai/env.ts`. Unset, this is
 * `''` and the card asks the reader for a key as before.
 */
const apiKey = (mode: string): string =>
	JSON.stringify(loadEnv(mode, process.cwd(), 'ANTHROPIC_').ANTHROPIC_API_KEY ?? '');

export default defineConfig(({ mode }) => ({
	define: { __ANTHROPIC_API_KEY__: apiKey(mode) },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Statements are parsed in the browser and never leave it, so there is
			// no server to deploy — the build is a static bundle.
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
}));
