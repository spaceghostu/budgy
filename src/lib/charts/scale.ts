/**
 * The small amount of maths a hand-drawn SVG chart needs: mapping data onto
 * pixels, choosing round axis ticks, and turning a series into a path.
 */

export interface Scale {
	(value: number): number;
	readonly domain: readonly [number, number];
	readonly range: readonly [number, number];
}

/**
 * Map a data interval onto a pixel interval.
 *
 * A zero-width domain (one point, or a flat line) would divide by zero, so it
 * is pinned to the middle of the range instead.
 */
export function linearScale(
	domain: readonly [number, number],
	range: readonly [number, number]
): Scale {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;

	const scale = (value: number): number =>
		span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0);

	return Object.assign(scale, { domain, range });
}

/**
 * Round tick values covering `[min, max]`, at roughly `count` intervals.
 *
 * Ticks carry the values the chart doesn't directly label, so they have to be
 * numbers a reader recognises — 0 / 5,000 / 10,000, never 3,847.2.
 */
export function niceTicks(min: number, max: number, count = 5): readonly number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
	if (min === max) return [min];
	if (min > max) return niceTicks(max, min, count);

	const step = niceStep((max - min) / Math.max(count, 1));
	const first = Math.ceil(min / step) * step;

	const ticks: number[] = [];
	for (let tick = first; tick <= max + step / 1e6; tick += step) {
		// Re-round each tick: repeated addition of a fractional step drifts.
		ticks.push(Math.round(tick / step) * step);
	}
	return ticks;
}

/** The nearest 1 / 2 / 5 × 10ⁿ at or above `rough`. */
function niceStep(rough: number): number {
	if (rough <= 0) return 1;

	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const normalised = rough / magnitude;
	const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;

	return factor * magnitude;
}

/**
 * Pad a domain outwards to the enclosing round numbers, so the plot has air
 * above and below the data and the top gridline is a tick.
 */
export function niceDomain(min: number, max: number, count = 5): readonly [number, number] {
	if (min === max) {
		const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
		return [min - pad, max + pad];
	}

	const step = niceStep((max - min) / Math.max(count, 1));
	return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

/**
 * A step-after path: hold the value, then jump at the next point.
 *
 * A balance is a step function — it holds until a transaction moves it. Drawing
 * a straight diagonal between two transactions would claim the money drained
 * gradually, which is not what happened.
 */
export function stepAfterPath(points: readonly Point[]): string {
	if (points.length === 0) return '';

	const [first, ...rest] = points;
	const segments = rest.map((point) => `H${round(point.x)}V${round(point.y)}`);

	return `M${round(first.x)},${round(first.y)}${segments.join('')}`;
}

/** The same shape closed down to a baseline, for the area wash under a line. */
export function stepAfterAreaPath(points: readonly Point[], baseline: number): string {
	if (points.length === 0) return '';

	const line = stepAfterPath(points);

	return `${line}V${round(baseline)}H${round(points[0].x)}Z`;
}

/**
 * A bar with its *data end* rounded and its baseline end square.
 *
 * Rounding both ends would detach the bar from its baseline and make short bars
 * read as pills rather than as magnitudes measured from zero.
 *
 * @param side Which end carries the data — the end away from the baseline.
 */
export function barPath(
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
	side: 'top' | 'bottom'
): string {
	const w = Math.max(width, 0);
	const h = Math.max(height, 0);
	const r = Math.max(0, Math.min(radius, w / 2, h));

	if (side === 'top') {
		return [
			`M${n(x)},${n(y + h)}`,
			`V${n(y + r)}`,
			`Q${n(x)},${n(y)} ${n(x + r)},${n(y)}`,
			`H${n(x + w - r)}`,
			`Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + r)}`,
			`V${n(y + h)}`,
			'Z'
		].join('');
	}

	return [
		`M${n(x)},${n(y)}`,
		`V${n(y + h - r)}`,
		`Q${n(x)},${n(y + h)} ${n(x + r)},${n(y + h)}`,
		`H${n(x + w - r)}`,
		`Q${n(x + w)},${n(y + h)} ${n(x + w)},${n(y + h - r)}`,
		`V${n(y)}`,
		'Z'
	].join('');
}

/** Index of the point whose x is nearest `x` — the crosshair's snap target. */
export function nearestIndex(points: readonly Point[], x: number): number {
	if (points.length === 0) return -1;

	return points.reduce(
		(best, point, index) => (Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best),
		0
	);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

const n = round;
