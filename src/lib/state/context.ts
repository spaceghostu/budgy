import { getContext, setContext } from 'svelte';
import { StatementState } from './statement.svelte.ts';

/**
 * The one statement state, shared by every page.
 *
 * Held in context rather than a module singleton so nothing is constructed at
 * import time: the constructor reads local storage, and a module that touches
 * the browser on import is a module that cannot be imported anywhere else.
 *
 * The layout provides it and each page takes it, which is what lets the filter
 * row live above the pages it scopes and a statement survive navigating between
 * them.
 */
const KEY = Symbol('budgy:statement');

export function provideStatement(): StatementState {
	const state = new StatementState();
	setContext(KEY, state);
	return state;
}

export function useStatement(): StatementState {
	const state = getContext<StatementState | undefined>(KEY);
	if (state === undefined) {
		throw new Error('No statement state in context — a page must render inside the root layout.');
	}

	return state;
}
