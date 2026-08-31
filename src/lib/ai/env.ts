/**
 * A key supplied by whoever built the bundle, rather than by whoever reads it.
 *
 * `ANTHROPIC_API_KEY` in `.env` is read at build time by `vite.config.ts` and
 * substituted here. There is no server in this app — the build is a static
 * bundle — so "configured" means *baked into the JavaScript that ships*, which
 * is only safe for a build nobody else loads: your own machine, or a page
 * behind your own login. Ship this bundle publicly and you have published the
 * key. Left unset, the card asks the reader for their own key as before, which
 * is the only arrangement that is safe to hand out.
 */

/** Replaced literally at build time; `''` when the variable is unset. */
declare const __ANTHROPIC_API_KEY__: string;

/**
 * The configured key, or `''` where there is none.
 *
 * A function rather than a constant so that it stays one value with one
 * source: a constant read at module load is fixed before a test can say what
 * this build should be carrying.
 */
export function envApiKey(): string {
	return typeof __ANTHROPIC_API_KEY__ === 'string' ? __ANTHROPIC_API_KEY__.trim() : '';
}

/** Whether this build carries its own key, and so need not ask for one. */
export function hasEnvKey(): boolean {
	return envApiKey() !== '';
}
