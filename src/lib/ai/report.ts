/**
 * Reading Claude's answer back.
 *
 * A forced tool call is validated against the schema on Anthropic's side, so
 * the shape is very likely right — but it arrives over the network from another
 * system, which is exactly the boundary this codebase validates at. Everything
 * here treats the response as untrusted input.
 *
 * Where a field is presentational, a bad value is repaired rather than fatal: a
 * tone this app cannot draw becomes neutral, and one malformed finding is
 * dropped instead of discarding four good ones. Where a field *is* the content
 * — no headline, no usable findings — the report is rejected, because a card
 * with nothing in it should read as a failure rather than as an empty answer.
 */

import type { Tone } from '../stats/highlights.ts';
import { MAX_ACTIONS, MAX_FINDINGS } from './prompt.ts';

export interface Finding {
	readonly title: string;
	readonly detail: string;
	readonly tone: Tone;
}

export interface SpendingReport {
	readonly headline: string;
	readonly findings: readonly Finding[];
	readonly actions: readonly string[];
}

const TONES: readonly Tone[] = ['neutral', 'good', 'warning'];

/** @returns `null` when the answer cannot be rendered as a report. */
export function parseReport(value: unknown): SpendingReport | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

	const candidate = value as Record<string, unknown>;
	const headline = text(candidate.headline);
	if (headline === null) return null;

	if (!Array.isArray(candidate.findings)) return null;
	const findings = candidate.findings
		.map(toFinding)
		.filter((finding): finding is Finding => finding !== null)
		.slice(0, MAX_FINDINGS);
	if (findings.length === 0) return null;

	return { headline, findings, actions: toActions(candidate.actions) };
}

function toFinding(value: unknown): Finding | null {
	if (typeof value !== 'object' || value === null) return null;

	const candidate = value as Record<string, unknown>;
	const title = text(candidate.title);
	const detail = text(candidate.detail);
	if (title === null || detail === null) return null;

	return { title, detail, tone: toTone(candidate.tone) };
}

function toTone(value: unknown): Tone {
	return TONES.find((tone) => tone === value) ?? 'neutral';
}

function toActions(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];

	return value
		.map(text)
		.filter((action): action is string => action !== null)
		.slice(0, MAX_ACTIONS);
}

/** A non-empty string, trimmed. `null` for anything else, blanks included. */
function text(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}
