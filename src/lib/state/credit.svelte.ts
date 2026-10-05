import type { CreditAccount, CreditReport } from '../credit/types.ts';
import {
	clearKey,
	loadCreditSnapshots,
	loadDebtExtra,
	loadDebtSettings,
	MAX_CREDIT_SNAPSHOTS,
	saveCreditSnapshots,
	saveDebtExtra,
	saveDebtSettings,
	type DebtSetting
} from './persistence.ts';

/**
 * What the reader owes, as far as a credit bureau can see it.
 *
 * Held beside the statement rather than inside it because it is a different
 * document with a different life: a statement is replaced by the next export,
 * while a debt goes on being the same debt, with the same rate the reader typed
 * and the same debit order paying it, through report after report.
 *
 * Two kinds of thing live here and are kept apart on purpose. The *snapshots*
 * are the bureau's word and are replaced wholesale by a newer report. The
 * *settings* are the reader's own — a rate, a link, a day — and are never
 * touched by an import, including for an account the newest report has dropped:
 * a bureau can lose an account for a month, and the reader should not have to
 * look their interest rate up twice.
 */
export class CreditState {
	/** Every report brought in, oldest first. */
	snapshots = $state<readonly CreditReport[]>([]);
	settings = $state<Record<string, DebtSetting>>({});
	/** Rand a month the reader can put towards debt over the instalments. */
	extra = $state(0);

	/** The newest report, or `null` before the first. */
	readonly latest = $derived(this.snapshots.at(-1) ?? null);

	/** The debts there is still something to do about. */
	readonly open = $derived(
		(this.latest?.accounts ?? []).filter(
			(account) =>
				account.balance > 0 &&
				account.status !== 'closed' &&
				this.settings[account.id]?.ignored !== true
		)
	);

	/** Open in the bureau's eyes but set aside by the reader — listed, not counted. */
	readonly ignored = $derived(
		(this.latest?.accounts ?? []).filter(
			(account: CreditAccount) => this.settings[account.id]?.ignored === true
		)
	);

	constructor() {
		this.snapshots = loadCreditSnapshots();
		this.settings = loadDebtSettings();
		this.extra = loadDebtExtra();
	}

	/**
	 * File a report.
	 *
	 * One per date: bringing the same day's report in twice replaces it rather
	 * than recording a month that never passed.
	 */
	accept(report: CreditReport): void {
		const rest = this.snapshots.filter((snapshot) => snapshot.reportDate !== report.reportDate);
		const next = [...rest, report]
			.sort((a, b) => a.reportDate.localeCompare(b.reportDate))
			.slice(-MAX_CREDIT_SNAPSHOTS);

		this.snapshots = next;
		saveCreditSnapshots(next);
	}

	/** @param rate Annual percentage, or `null` to say it is not known after all. */
	setRate(id: string, rate: number | null): void {
		const valid = rate !== null && Number.isFinite(rate) && rate >= 0 && rate <= 100;
		this.change(id, { rate: valid ? rate : undefined });
	}

	setPaymentDay(id: string, day: number | null): void {
		const valid = day !== null && Number.isInteger(day) && day >= 1 && day <= 31;
		this.change(id, { paymentDay: valid ? day : undefined });
	}

	/** Confirm that this payee on the statement is what pays the debt. */
	link(id: string, merchant: string): void {
		if (merchant === '') return;

		this.change(id, { link: merchant });
	}

	/** Say the debt is not paid from anything on the statement. Never re-suggested. */
	unlink(id: string): void {
		this.change(id, { link: null });
	}

	/** Forget what was said about the link, and let it be worked out again. */
	resetLink(id: string): void {
		this.change(id, { link: undefined });
	}

	setIgnored(id: string, ignored: boolean): void {
		this.change(id, { ignored: ignored ? true : undefined });
	}

	setExtra(extra: number): void {
		this.extra = Number.isFinite(extra) && extra > 0 ? extra : 0;
		saveDebtExtra(this.extra);
	}

	/** Forget every report and everything said about them. */
	clear(): void {
		this.snapshots = [];
		this.settings = {};
		this.extra = 0;
		clearKey('creditSnapshots');
		clearKey('debtSettings');
		clearKey('debtExtra');
	}

	/**
	 * Merge a change into one debt's settings.
	 *
	 * A field set to `undefined` is dropped rather than stored, and a debt with
	 * nothing left said about it gives up its entry, so the stored map holds only
	 * what the reader actually told it.
	 */
	private change(id: string, patch: Partial<Record<keyof DebtSetting, unknown>>): void {
		const merged = { ...this.settings[id], ...patch };
		const kept = Object.fromEntries(
			Object.entries(merged).filter(([, value]) => value !== undefined)
		) as DebtSetting;

		const rest = Object.fromEntries(
			Object.entries(this.settings).filter(([other]) => other !== id)
		);
		const next = Object.keys(kept).length === 0 ? rest : { ...rest, [id]: kept };

		this.settings = next;
		saveDebtSettings(next);
	}
}
