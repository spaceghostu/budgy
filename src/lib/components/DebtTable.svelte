<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { CreditAccount, CreditKind } from '../credit/types.ts';
	import { formatCurrency } from '../format.ts';
	import type { DebtSetting } from '../state/persistence.ts';
	import type { DebtMatch } from '../stats/debt-match.ts';

	interface Props {
		accounts: readonly CreditAccount[];
		/** One per account, from `matchDebts`. */
		matches: readonly DebtMatch[];
		settings: Readonly<Record<string, DebtSetting>>;
		/** Payees on the statement that money goes out to — what a debt can be linked to. */
		payees: readonly string[];
		onrate: (id: string, rate: number | null) => void;
		onday: (id: string, day: number | null) => void;
		onlink: (id: string, merchant: string) => void;
		onunlink: (id: string) => void;
		onignore: (id: string) => void;
	}

	const { accounts, matches, settings, payees, onrate, onday, onlink, onunlink, onignore }: Props =
		$props();

	const KINDS: Record<CreditKind, string> = {
		loan: 'Loan',
		card: 'Credit card',
		revolving: 'Revolving credit',
		store: 'Store account',
		other: 'Credit account'
	};

	/** What stands in the picker for "this is not paid from my statement". */
	const NOT_ON_STATEMENT = '\u0000none';

	const matchOf = $derived(new Map(matches.map((match) => [match.accountId, match])));

	/**
	 * How the instalment is being treated, in the reader's terms.
	 *
	 * An assumption is called one. It is the app's guess that two documents are
	 * describing the same payment, and the forecast is already acting on it.
	 */
	function linkLabel(match: DebtMatch | undefined): string {
		if (match === undefined || match.origin === 'none') return 'Not found on your statement';
		if (match.origin === 'unlinked') return 'Not paid from your statement';
		if (match.origin === 'missing') {
			return `Linked to ${match.merchant}, which is not on the open statement — counted as unpaid`;
		}

		return match.origin === 'confirmed'
			? `Paid by ${match.merchant}`
			: `Paid by ${match.merchant} (assumed)`;
	}

	/** Blank means "not known", never zero — a 0% loan is a real and different claim. */
	function numberOrNull(text: string): number | null {
		const value = Number(text);
		return text.trim() === '' || !Number.isFinite(value) ? null : value;
	}

	/**
	 * Read a field, hold it to its range, and show the reader what was kept.
	 *
	 * Written back to the field because a value out of range is not stored, and
	 * a box still showing 150% above a plan run at no interest would be the page
	 * saying two things at once.
	 */
	function bounded(
		field: HTMLInputElement,
		min: number,
		max: number,
		whole = false
	): number | null {
		const typed = numberOrNull(field.value);
		if (typed === null) return null;

		const kept = Math.min(Math.max(whole ? Math.round(typed) : typed, min), max);
		field.value = `${kept}`;
		return kept;
	}
</script>

{#if accounts.length === 0}
	<p class="py-6 text-center text-[13px] text-faint">No open debts on this report.</p>
{:else}
	<ul class="list-none">
		{#each accounts as account (account.id)}
			{@const match = matchOf.get(account.id)}
			{@const setting = settings[account.id]}
			<li class="border-t py-3 first:border-t-0">
				<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					<div class="min-w-0">
						<p class="truncate text-[13px] font-medium" title={account.creditor}>
							{account.creditor}
						</p>
						<p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
							<span>{KINDS[account.kind]}</span>
							{#if account.arrears > 0}
								<Badge
									variant="outline"
									class="rounded-full border-destructive px-1.5 py-px text-[11px] font-normal text-destructive"
								>
									{formatCurrency(account.arrears)} in arrears
								</Badge>
							{/if}
						</p>
					</div>
					<div class="flex-none text-right">
						<p class="text-[13px] font-semibold tabular-nums">{formatCurrency(account.balance)}</p>
						<p class="mt-0.5 text-xs text-faint tabular-nums">
							{account.instalment > 0
								? `${formatCurrency(account.instalment)} a month`
								: 'No instalment reported'}
						</p>
					</div>
				</div>

				<div class="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2">
					<div class="flex flex-col gap-1">
						<Label for="rate-{account.id}" class="text-xs font-normal text-muted-foreground">
							Interest rate (% a year)
						</Label>
						<Input
							id="rate-{account.id}"
							type="number"
							inputmode="decimal"
							min="0"
							max="100"
							step="0.05"
							class="h-8 w-28 text-[13px]"
							placeholder="Not known"
							value={setting?.rate ?? ''}
							onchange={(event) => onrate(account.id, bounded(event.currentTarget, 0, 100))}
						/>
					</div>

					{#if account.instalment > 0}
						<div class="flex min-w-0 flex-col gap-1">
							<span id="link-{account.id}" class="text-xs text-muted-foreground">
								{linkLabel(match)}
							</span>
							<div class="flex flex-wrap items-center gap-2">
								<Select.Root
									type="single"
									value={match?.origin === 'unlinked' ? NOT_ON_STATEMENT : (match?.merchant ?? '')}
									onValueChange={(next) =>
										next === NOT_ON_STATEMENT ? onunlink(account.id) : onlink(account.id, next)}
								>
									<Select.Trigger
										aria-labelledby="link-{account.id}"
										class="h-8 max-w-56 text-[13px]"
									>
										<span class="truncate">
											{match?.merchant ??
												(match?.origin === 'unlinked' ? 'Not on my statement' : 'Choose a payee')}
										</span>
									</Select.Trigger>
									<Select.Content>
										<Select.Item value={NOT_ON_STATEMENT} label="Not on my statement">
											Not on my statement
										</Select.Item>
										{#each payees as payee (payee)}
											<Select.Item value={payee} label={payee}>{payee}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								{#if match?.origin === 'suggested' && match.merchant !== null}
									<Button
										variant="outline"
										size="sm"
										class="h-8 text-[13px]"
										onclick={() => onlink(account.id, match.merchant ?? '')}
									>
										Confirm
									</Button>
								{/if}
							</div>
						</div>

						{#if match === undefined || match.merchant === null || match.origin === 'missing'}
							<!-- Only where nothing on the statement says which day: a linked
							     debt lands on the day its own debit order does. -->
							<div class="flex flex-col gap-1">
								<Label for="day-{account.id}" class="text-xs font-normal text-muted-foreground">
									Leaves on day
								</Label>
								<Input
									id="day-{account.id}"
									type="number"
									inputmode="numeric"
									min="1"
									max="31"
									step="1"
									class="h-8 w-20 text-[13px]"
									placeholder="1"
									value={setting?.paymentDay ?? ''}
									onchange={(event) => onday(account.id, bounded(event.currentTarget, 1, 31, true))}
								/>
							</div>
						{/if}
					{/if}

					<Button
						variant="ghost"
						size="sm"
						class="ml-auto h-8 text-[13px] text-muted-foreground"
						onclick={() => onignore(account.id)}
					>
						Leave out
					</Button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
