import { formatCount, formatCurrency, formatDate, formatPercent } from '../format.ts';
import type { Insights } from '../types.ts';

/** Severity, which decides both the icon and the wording's urgency. */
export type Tone = 'neutral' | 'good' | 'warning';

export interface Highlight {
	readonly id: string;
	readonly tone: Tone;
	readonly text: string;
}

/** Runway below this reads as something to act on rather than a statistic. */
const SHORT_RUNWAY_DAYS = 30;

/** Fees above this share of spending are worth calling out on their own. */
const NOTABLE_FEE_SHARE = 0.01;

const MAX_HIGHLIGHTS = 5;

/**
 * The handful of sentences worth reading before any chart.
 *
 * Ordered by how much they should change what the reader does, then trimmed —
 * a wall of observations is the same as no observations.
 */
export function buildHighlights(insights: Insights): readonly Highlight[] {
	const { summary, categories, recurring } = insights;
	const candidates: (Highlight | null)[] = [
		runway(insights),
		netPosition(insights),
		declinedFees(insights),
		topCategory(categories, summary.expense),
		fees(insights),
		recurringLoad(recurring),
		heaviestDay(insights)
	];

	return candidates
		.filter((highlight): highlight is Highlight => highlight !== null)
		.slice(0, MAX_HIGHLIGHTS);
}

function runway({ summary }: Insights): Highlight | null {
	if (summary.runwayDays === null || summary.closingBalance <= 0) return null;

	const perDay = summary.closingBalance / summary.runwayDays;

	return {
		id: 'runway',
		tone: summary.runwayDays < SHORT_RUNWAY_DAYS ? 'warning' : 'neutral',
		text:
			`You are burning about ${formatCurrency(perDay)} a day net of income. ` +
			`At that rate this balance lasts around ${formatCount(summary.runwayDays, 'more day')}.`
	};
}

function netPosition({ summary }: Insights): Highlight | null {
	if (summary.income === 0 && summary.expense === 0) return null;

	const surplus = summary.net >= 0;

	return {
		id: 'net',
		tone: surplus ? 'good' : 'warning',
		text: surplus
			? `You took in ${formatCurrency(summary.net)} more than you spent over these ${summary.days} days.`
			: `You spent ${formatCurrency(Math.abs(summary.net))} more than came in over these ${summary.days} days.`
	};
}

function declinedFees({ summary }: Insights): Highlight | null {
	if (summary.declinedFees <= 0) return null;

	return {
		id: 'declined-fees',
		tone: 'warning',
		text:
			`${formatCurrency(summary.declinedFees)} went on fees for declined transactions ` +
			`across ${formatCount(summary.declinedCount, 'declined attempt')} — a charge for nothing you received.`
	};
}

function topCategory(categories: Insights['categories'], expense: number): Highlight | null {
	const top = categories.at(0);
	if (top === undefined || expense <= 0) return null;

	// "Uncategorised is where most of your money went" tells the reader nothing
	// about their money — it tells them about their bank. Point them somewhere
	// useful, and the card that fixes it is on the same page.
	if (top.label.toLowerCase() === 'uncategorised') {
		return {
			id: 'top-category',
			tone: 'neutral',
			text:
				`Your bank left ${formatPercent(top.share)} of your spending uncategorised ` +
				`(${formatCurrency(top.total)}) — file those merchants below, or read the merchant ` +
				'breakdown instead.'
		};
	}

	return {
		id: 'top-category',
		tone: 'neutral',
		text:
			`${top.label} took the biggest share of your spending: ${formatCurrency(top.total)}, ` +
			`${formatPercent(top.share)} of everything that went out.`
	};
}

function fees({ summary }: Insights): Highlight | null {
	if (summary.fees <= 0 || summary.expense <= 0) return null;

	const share = summary.fees / summary.expense;
	if (share < NOTABLE_FEE_SHARE) return null;

	return {
		id: 'fees',
		tone: 'neutral',
		text: `Bank fees and interest came to ${formatCurrency(summary.fees)} — ${formatPercent(share)} of everything you spent.`
	};
}

function recurringLoad(recurring: Insights['recurring']): Highlight | null {
	if (recurring.length === 0) return null;

	const total = recurring.reduce((sum, charge) => sum + charge.latestAmount, 0);

	return {
		id: 'recurring',
		tone: 'neutral',
		text:
			`${formatCount(recurring.length, 'repeating charge')} account for ${formatCurrency(total)} — ` +
			`the part of your spending that happens whether you act or not.`
	};
}

function heaviestDay({ summary }: Insights): Highlight | null {
	if (summary.busiestSpendDay === null) return null;

	return {
		id: 'heaviest-day',
		tone: 'neutral',
		text: `Your heaviest day was ${formatDate(summary.busiestSpendDay.date)}, with ${formatCurrency(summary.busiestSpendDay.expense)} going out.`
	};
}
