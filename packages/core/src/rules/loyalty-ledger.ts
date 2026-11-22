import { addMonthsUtc } from "./loyalty-months.js";

/**
 * The loyalty ledger as an executable model (docs/schema.md, "Loyalty ledger").
 *
 * It mirrors the rows the SQL functions write: `app.loyalty_earn`,
 * `app.loyalty_confirm`, `app.redeem_coupon` (a pending `redeem` row that holds
 * the reward's stamps and points), `app.release_redemption` (an `adjust` row
 * with reason `redemption_released` and the opposite deltas of the hold),
 * `app.loyalty_clawback`, `app.loyalty_apply_adjustment` and `app.loyalty_expire`.
 * Operations are applied in time order. No phone, name or other personal datum
 * enters the model: members are opaque ids.
 */
export type LedgerEntryKind =
	| "earn"
	| "confirm"
	| "clawback"
	| "redeem"
	| "adjust"
	| "expire";

export const REDEMPTION_RELEASED = "redemption_released";
export const REDEMPTION_REASON = "redemption";
export const EXPIRED_REASON = "expired";

export interface LedgerRules {
	readonly stampValidityMonths: number;
	readonly pointsExpiryMonths: number;
	/** IANA time zone of the tenant: local months and days follow it. */
	readonly timezone: string;
}

export interface LedgerEntry {
	readonly id: number;
	readonly member: string;
	readonly kind: LedgerEntryKind;
	readonly stampDelta: number;
	readonly pointDelta: number;
	readonly pending: boolean;
	readonly sourceId: number | null;
	readonly reason: string | null;
	readonly expiresAt: number | null;
	readonly occurredAt: number;
}

export interface Amounts {
	readonly stamps: number;
	readonly points: number;
}

export type LedgerRefusal =
	| "unknown_member"
	| "unknown_entry"
	| "nothing_to_earn"
	| "not_pending"
	| "reversed"
	| "not_held"
	| "no_cost"
	| "insufficient_stamps"
	| "insufficient_points"
	| "already_reversed"
	| "would_go_negative"
	| "nothing_to_adjust";

export type LedgerResult =
	| { readonly ok: true; readonly entryId: number }
	| { readonly ok: false; readonly refusal: LedgerRefusal };

export type RedemptionState = "held" | "confirmed" | "released";

export interface Balance {
	readonly stamps: number;
	readonly points: number;
	readonly pendingStamps: number;
	readonly pendingPoints: number;
}

/**
 * Where every stamp and point of a member is, kept by explicit transitions
 * (not by summing rows), so that it can be checked against the ledger.
 */
export interface LedgerAccount {
	readonly spendable: Amounts;
	readonly held: Amounts;
	readonly spent: Amounts;
	readonly earned: Amounts;
	readonly reversed: Amounts;
	readonly expired: Amounts;
	readonly pending: Amounts;
}

interface MutableAmounts {
	stamps: number;
	points: number;
}

type MutableAccount = {
	[Key in keyof LedgerAccount]: MutableAmounts;
};

interface StampLot {
	readonly id: number;
	readonly member: string;
	readonly earnEntryId: number;
	readonly earnedAt: number;
	readonly expiresAt: number;
	state: "active" | "redeemed" | "expired" | "clawed_back";
	closedBy: number | null;
}

export interface LedgerOptions {
	/**
	 * `app.loyalty_apply_adjustment` writes any negative adjustment, so a balance
	 * can be taken below zero. The model refuses such an adjustment unless this
	 * is true (the intended rule: an adjustment never takes more than is there).
	 */
	readonly allowNegativeAdjustments?: boolean;
}

const NEVER = Number.POSITIVE_INFINITY;

function zero(): MutableAmounts {
	return { stamps: 0, points: 0 };
}

function emptyAccount(): MutableAccount {
	return {
		spendable: zero(),
		held: zero(),
		spent: zero(),
		earned: zero(),
		reversed: zero(),
		expired: zero(),
		pending: zero(),
	};
}

function openPendingEarnIds(rows: readonly LedgerEntry[]): ReadonlySet<number> {
	const confirmed = new Set<number>();
	for (const row of rows) {
		if (row.kind === "confirm" && row.sourceId !== null) {
			confirmed.add(row.sourceId);
		}
	}
	const open = new Set<number>();
	for (const row of rows) {
		if (row.kind === "earn" && row.pending && !confirmed.has(row.id)) {
			open.add(row.id);
		}
	}
	return open;
}

/** `app.loyalty_balance`: spendable and pending stamps and points of a member. */
export function ledgerBalance(
	entries: readonly LedgerEntry[],
	member: string,
	at: number = NEVER,
): Balance {
	const rows = entries.filter(
		(row) => row.member === member && row.occurredAt <= at,
	);
	const open = openPendingEarnIds(rows);
	let stamps = 0;
	let points = 0;
	let pendingStamps = 0;
	let pendingPoints = 0;
	for (const row of rows) {
		const isPending =
			open.has(row.id) || (row.sourceId !== null && open.has(row.sourceId));
		if (isPending) {
			pendingStamps += row.stampDelta;
			pendingPoints += row.pointDelta;
		} else {
			stamps += row.stampDelta;
			points += row.pointDelta;
		}
	}
	return { stamps, points, pendingStamps, pendingPoints };
}

/**
 * The points of a member that expire by `at`, first in first out: the confirmed
 * credits past their expiry (net of their clawbacks) less every point already
 * spent, held, adjusted away or expired; a released hold cancels its debit.
 */
export function expiringPoints(
	entries: readonly LedgerEntry[],
	member: string,
	at: number,
): number {
	const rows = entries.filter(
		(row) => row.member === member && row.occurredAt <= at,
	);
	const open = openPendingEarnIds(rows);
	let expiringCredits = 0;
	for (const credit of rows) {
		if (
			credit.pointDelta > 0 &&
			(credit.kind === "earn" || credit.kind === "adjust") &&
			credit.reason !== REDEMPTION_RELEASED &&
			!open.has(credit.id) &&
			credit.expiresAt !== null &&
			credit.expiresAt <= at
		) {
			let net = credit.pointDelta;
			for (const row of rows) {
				if (row.kind === "clawback" && row.sourceId === credit.id) {
					net += row.pointDelta;
				}
			}
			expiringCredits += net;
		}
	}
	let debits = 0;
	for (const row of rows) {
		if (
			row.kind === "redeem" ||
			row.kind === "expire" ||
			(row.kind === "adjust" &&
				(row.pointDelta < 0 || row.reason === REDEMPTION_RELEASED))
		) {
			debits -= row.pointDelta;
		}
	}
	return Math.max(expiringCredits - debits, 0);
}

export class LoyaltyLedger {
	readonly rules: LedgerRules;
	private readonly options: LedgerOptions;
	private readonly rows: LedgerEntry[] = [];
	private readonly lots: StampLot[] = [];
	private readonly members = new Map<string, MutableAccount>();
	private readonly holdExpiry = new Map<number, number>();
	private clock = Number.NEGATIVE_INFINITY;

	constructor(rules: LedgerRules, options: LedgerOptions = {}) {
		this.rules = rules;
		this.options = options;
	}

	get entries(): readonly LedgerEntry[] {
		return this.rows;
	}

	memberIds(): string[] {
		return [...this.members.keys()];
	}

	join(member: string): void {
		if (!this.members.has(member)) {
			this.members.set(member, emptyAccount());
		}
	}

	balance(member: string, at: number = NEVER): Balance {
		return ledgerBalance(this.rows, member, at);
	}

	/** The running account of a member, kept by transitions. */
	account(member: string): LedgerAccount | undefined {
		const account = this.members.get(member);
		if (account === undefined) {
			return undefined;
		}
		const copy = (value: MutableAmounts): Amounts => ({ ...value });
		return {
			spendable: copy(account.spendable),
			held: copy(account.held),
			spent: copy(account.spent),
			earned: copy(account.earned),
			reversed: copy(account.reversed),
			expired: copy(account.expired),
			pending: copy(account.pending),
		};
	}

	entry(id: number): LedgerEntry | undefined {
		return this.rows.find((row) => row.id === id);
	}

	redemptionState(holdId: number): RedemptionState | undefined {
		const hold = this.entry(holdId);
		if (hold === undefined || hold.kind !== "redeem") {
			return undefined;
		}
		if (this.rows.some((row) => this.isReleaseOf(row, holdId))) {
			return "released";
		}
		if (
			this.rows.some((row) => row.kind === "confirm" && row.sourceId === holdId)
		) {
			return "confirmed";
		}
		return "held";
	}

	holdExpiresAt(holdId: number): number | undefined {
		return this.holdExpiry.get(holdId);
	}

	/** Entry ids of the holds not yet confirmed or released. */
	heldRedemptions(): number[] {
		return this.rows
			.filter(
				(row) =>
					row.kind === "redeem" && this.redemptionState(row.id) === "held",
			)
			.map((row) => row.id);
	}

	earn(
		member: string,
		amounts: Amounts,
		options: { soldAt: number; at: number; pending?: boolean },
	): LedgerResult {
		const account = this.members.get(member);
		if (account === undefined) {
			return refuse("unknown_member");
		}
		if (amounts.stamps <= 0 && amounts.points <= 0) {
			return refuse("nothing_to_earn");
		}
		this.ensureOrder(options.at);
		const pending = options.pending ?? false;
		const entry = this.write({
			member,
			kind: "earn",
			stampDelta: amounts.stamps,
			pointDelta: amounts.points,
			pending,
			sourceId: null,
			reason: null,
			expiresAt:
				amounts.points > 0
					? addMonthsUtc(options.soldAt, this.rules.pointsExpiryMonths)
					: null,
			occurredAt: options.at,
		});
		this.openLots(
			member,
			entry.id,
			amounts.stamps,
			options.soldAt,
			addMonthsUtc(options.soldAt, this.rules.stampValidityMonths),
		);
		if (pending) {
			add(account.pending, amounts);
		} else {
			add(account.earned, amounts);
			add(account.spendable, amounts);
		}
		return { ok: true, entryId: entry.id };
	}

	confirm(entryId: number, at: number): LedgerResult {
		const target = this.entry(entryId);
		if (target === undefined) {
			return refuse("unknown_entry");
		}
		if (
			!target.pending ||
			(target.kind !== "earn" && target.kind !== "redeem")
		) {
			return refuse("not_pending");
		}
		const existing = this.rows.find(
			(row) => row.kind === "confirm" && row.sourceId === entryId,
		);
		if (existing !== undefined) {
			return { ok: true, entryId: existing.id };
		}
		if (
			this.rows.some(
				(row) => row.kind === "clawback" && row.sourceId === entryId,
			)
		) {
			return refuse("reversed");
		}
		if (target.kind === "redeem" && this.redemptionState(entryId) !== "held") {
			return refuse("not_held");
		}
		this.ensureOrder(at);
		const confirm = this.write({
			member: target.member,
			kind: "confirm",
			stampDelta: 0,
			pointDelta: 0,
			pending: false,
			sourceId: entryId,
			reason: null,
			expiresAt: null,
			occurredAt: at,
		});
		const account = this.members.get(target.member);
		if (account !== undefined) {
			if (target.kind === "earn") {
				const amounts = {
					stamps: target.stampDelta,
					points: target.pointDelta,
				};
				sub(account.pending, amounts);
				add(account.earned, amounts);
				add(account.spendable, amounts);
			} else {
				const cost = negated(target);
				sub(account.held, cost);
				add(account.spent, cost);
			}
		}
		return { ok: true, entryId: confirm.id };
	}

	/** `app.redeem_coupon`: a pending `redeem` row holds the cost at once. */
	hold(
		member: string,
		cost: Amounts,
		at: number,
		holdHours = 24,
	): LedgerResult {
		const account = this.members.get(member);
		if (account === undefined) {
			return refuse("unknown_member");
		}
		if (
			cost.stamps < 0 ||
			cost.points < 0 ||
			(cost.stamps === 0 && cost.points === 0)
		) {
			return refuse("no_cost");
		}
		this.ensureOrder(at);
		const balance = this.balance(member, at);
		const usable = this.spendableLots(member, at);
		if (
			cost.stamps > 0 &&
			(balance.stamps < cost.stamps || usable.length < cost.stamps)
		) {
			return refuse("insufficient_stamps");
		}
		if (cost.points > 0 && balance.points < cost.points) {
			return refuse("insufficient_points");
		}
		const entry = this.write({
			member,
			kind: "redeem",
			stampDelta: 0 - cost.stamps,
			pointDelta: 0 - cost.points,
			pending: true,
			sourceId: null,
			reason: REDEMPTION_REASON,
			expiresAt: null,
			occurredAt: at,
		});
		for (const lot of usable.slice(0, cost.stamps)) {
			lot.state = "redeemed";
			lot.closedBy = entry.id;
		}
		this.holdExpiry.set(entry.id, at + holdHours * 3_600_000);
		sub(account.spendable, cost);
		add(account.held, cost);
		return { ok: true, entryId: entry.id };
	}

	/** `app.release_redemption`: the hold's stamps and points come back, exactly. */
	release(holdId: number, at: number): LedgerResult {
		const hold = this.entry(holdId);
		if (hold === undefined || hold.kind !== "redeem") {
			return refuse("unknown_entry");
		}
		if (this.redemptionState(holdId) !== "held") {
			return refuse("not_held");
		}
		this.ensureOrder(at);
		const release = this.write({
			member: hold.member,
			kind: "adjust",
			stampDelta: 0 - hold.stampDelta,
			pointDelta: 0 - hold.pointDelta,
			pending: false,
			sourceId: holdId,
			reason: REDEMPTION_RELEASED,
			expiresAt: null,
			occurredAt: at,
		});
		for (const lot of this.lots) {
			if (lot.closedBy === holdId && lot.state === "redeemed") {
				lot.state = "active";
				lot.closedBy = null;
			}
		}
		const account = this.members.get(hold.member);
		if (account !== undefined) {
			const cost = negated(hold);
			sub(account.held, cost);
			add(account.spendable, cost);
		}
		return { ok: true, entryId: release.id };
	}

	/** `app.loyalty_clawback` of one earn: the opposite deltas, whatever was spent. */
	clawback(
		earnId: number,
		at: number,
		reason = "invoice_voided",
	): LedgerResult {
		const earn = this.entry(earnId);
		if (earn === undefined || earn.kind !== "earn") {
			return refuse("unknown_entry");
		}
		if (
			this.rows.some(
				(row) => row.kind === "clawback" && row.sourceId === earnId,
			)
		) {
			return refuse("already_reversed");
		}
		this.ensureOrder(at);
		const wasPending = this.isOpenPending(earn);
		const claw = this.write({
			member: earn.member,
			kind: "clawback",
			stampDelta: 0 - earn.stampDelta,
			pointDelta: 0 - earn.pointDelta,
			pending: false,
			sourceId: earnId,
			reason,
			expiresAt: null,
			occurredAt: at,
		});
		for (const lot of this.lots) {
			if (lot.earnEntryId === earnId && lot.state === "active") {
				lot.state = "clawed_back";
				lot.closedBy = claw.id;
			}
		}
		const account = this.members.get(earn.member);
		if (account !== undefined) {
			const amounts = { stamps: earn.stampDelta, points: earn.pointDelta };
			if (wasPending) {
				sub(account.pending, amounts);
			} else {
				add(account.reversed, amounts);
				sub(account.spendable, amounts);
			}
		}
		return { ok: true, entryId: claw.id };
	}

	/** `app.loyalty_apply_adjustment`: a signed manual change with its reason. */
	adjust(
		member: string,
		amounts: Amounts,
		at: number,
		reason: string,
	): LedgerResult {
		const account = this.members.get(member);
		if (account === undefined) {
			return refuse("unknown_member");
		}
		if (amounts.stamps === 0 && amounts.points === 0) {
			return refuse("nothing_to_adjust");
		}
		this.ensureOrder(at);
		if (!this.options.allowNegativeAdjustments) {
			const balance = this.balance(member, at);
			const eligible = this.lots.filter(
				(lot) =>
					lot.member === member &&
					lot.state === "active" &&
					!this.lotIsPending(lot),
			).length;
			if (
				balance.stamps + amounts.stamps < 0 ||
				balance.points + amounts.points < 0 ||
				(amounts.stamps < 0 && eligible < -amounts.stamps)
			) {
				return refuse("would_go_negative");
			}
		}
		const entry = this.write({
			member,
			kind: "adjust",
			stampDelta: amounts.stamps,
			pointDelta: amounts.points,
			pending: false,
			sourceId: null,
			reason,
			expiresAt:
				amounts.points > 0
					? addMonthsUtc(at, this.rules.pointsExpiryMonths)
					: null,
			occurredAt: at,
		});
		if (amounts.stamps > 0) {
			this.openLots(
				member,
				entry.id,
				amounts.stamps,
				at,
				addMonthsUtc(at, this.rules.stampValidityMonths),
			);
		} else if (amounts.stamps < 0) {
			const oldest = this.lots
				.filter(
					(lot) =>
						lot.member === member &&
						lot.state === "active" &&
						!this.lotIsPending(lot),
				)
				.sort((a, b) => a.expiresAt - b.expiresAt || a.id - b.id)
				.slice(0, -amounts.stamps);
			for (const lot of oldest) {
				lot.state = "clawed_back";
				lot.closedBy = entry.id;
			}
		}
		const positive = {
			stamps: Math.max(amounts.stamps, 0),
			points: Math.max(amounts.points, 0),
		};
		const negative = {
			stamps: Math.max(-amounts.stamps, 0),
			points: Math.max(-amounts.points, 0),
		};
		add(account.earned, positive);
		add(account.reversed, negative);
		add(account.spendable, amounts);
		return { ok: true, entryId: entry.id };
	}

	/** `app.loyalty_expire` for every member: one `expire` row each, counts back. */
	expire(at: number): { memberships: number; stamps: number; points: number } {
		this.ensureOrder(at);
		const total = { memberships: 0, stamps: 0, points: 0 };
		for (const [member, account] of [...this.members.entries()].sort(
			([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
		)) {
			const due = this.lots.filter(
				(lot) =>
					lot.member === member &&
					lot.state === "active" &&
					lot.expiresAt <= at &&
					!this.lotIsPending(lot),
			);
			const points = expiringPoints(this.rows, member, at);
			if (due.length === 0 && points === 0) {
				continue;
			}
			const entry = this.write({
				member,
				kind: "expire",
				stampDelta: 0 - due.length,
				pointDelta: 0 - points,
				pending: false,
				sourceId: null,
				reason: EXPIRED_REASON,
				expiresAt: null,
				occurredAt: at,
			});
			for (const lot of due) {
				lot.state = "expired";
				lot.closedBy = entry.id;
			}
			const amounts = { stamps: due.length, points };
			add(account.expired, amounts);
			sub(account.spendable, amounts);
			total.memberships += 1;
			total.stamps += due.length;
			total.points += points;
		}
		return total;
	}

	/** The stamps a redemption may use at a moment, oldest expiry first. */
	spendableLots(member: string, at: number): StampLot[] {
		return this.lots
			.filter(
				(lot) =>
					lot.member === member &&
					lot.state === "active" &&
					lot.earnedAt <= at &&
					lot.expiresAt > at &&
					!this.lotIsPending(lot),
			)
			.sort(
				(a, b) =>
					a.expiresAt - b.expiresAt || a.earnedAt - b.earnedAt || a.id - b.id,
			);
	}

	activeStampLots(member: string): number {
		return this.lots.filter(
			(lot) => lot.member === member && lot.state === "active",
		).length;
	}

	private lotIsPending(lot: StampLot): boolean {
		const earn = this.entry(lot.earnEntryId);
		return earn !== undefined && this.isOpenPending(earn);
	}

	private isOpenPending(earn: LedgerEntry): boolean {
		return (
			earn.kind === "earn" &&
			earn.pending &&
			!this.rows.some(
				(row) => row.kind === "confirm" && row.sourceId === earn.id,
			)
		);
	}

	private isReleaseOf(row: LedgerEntry, holdId: number): boolean {
		return (
			row.kind === "adjust" &&
			row.reason === REDEMPTION_RELEASED &&
			row.sourceId === holdId
		);
	}

	/** Rows are written in time order; a refused operation writes none and moves no clock. */
	private ensureOrder(at: number): void {
		if (!Number.isFinite(at)) {
			throw new RangeError("a ledger operation needs a finite moment");
		}
		if (at < this.clock) {
			throw new RangeError("ledger operations are applied in time order");
		}
	}

	private write(entry: Omit<LedgerEntry, "id">): LedgerEntry {
		const row: LedgerEntry = { id: this.rows.length + 1, ...entry };
		this.rows.push(row);
		this.clock = row.occurredAt;
		return row;
	}

	private openLots(
		member: string,
		earnEntryId: number,
		count: number,
		earnedAt: number,
		expiresAt: number,
	): void {
		for (let index = 0; index < count; index += 1) {
			this.lots.push({
				id: this.lots.length + 1,
				member,
				earnEntryId,
				earnedAt,
				expiresAt,
				state: "active",
				closedBy: null,
			});
		}
	}
}

function refuse(refusal: LedgerRefusal): LedgerResult {
	return { ok: false, refusal };
}

function add(target: MutableAmounts, amounts: Amounts): void {
	target.stamps += amounts.stamps;
	target.points += amounts.points;
}

function sub(target: MutableAmounts, amounts: Amounts): void {
	target.stamps -= amounts.stamps;
	target.points -= amounts.points;
}

function negated(hold: LedgerEntry): Amounts {
	return { stamps: 0 - hold.stampDelta, points: 0 - hold.pointDelta };
}

/**
 * The same account, derived from the rows alone: confirmed earns and positive
 * adjustments are earned, clawbacks and negative adjustments reverse them,
 * holds not yet confirmed or released are held, confirmed holds are spent.
 */
export function accountFromEntries(
	entries: readonly LedgerEntry[],
	member: string,
): LedgerAccount {
	const rows = entries.filter((row) => row.member === member);
	const open = openPendingEarnIds(rows);
	const confirmed = new Set(
		rows.filter((row) => row.kind === "confirm").map((row) => row.sourceId),
	);
	const released = new Set(
		rows
			.filter(
				(row) => row.kind === "adjust" && row.reason === REDEMPTION_RELEASED,
			)
			.map((row) => row.sourceId),
	);
	const spendable = zero();
	const held = zero();
	const spent = zero();
	const earned = zero();
	const reversed = zero();
	const expired = zero();
	const pending = zero();
	for (const row of rows) {
		const amounts = { stamps: row.stampDelta, points: row.pointDelta };
		const isPending =
			open.has(row.id) || (row.sourceId !== null && open.has(row.sourceId));
		if (isPending) {
			add(pending, amounts);
			continue;
		}
		add(spendable, amounts);
		switch (row.kind) {
			case "earn":
				add(earned, amounts);
				break;
			case "clawback":
				sub(reversed, amounts);
				break;
			case "expire":
				sub(expired, amounts);
				break;
			case "redeem":
				if (released.has(row.id)) {
					break;
				}
				sub(confirmed.has(row.id) ? spent : held, amounts);
				break;
			case "adjust":
				if (row.reason === REDEMPTION_RELEASED) {
					break;
				}
				if (row.stampDelta > 0 || row.pointDelta > 0) {
					add(earned, {
						stamps: Math.max(amounts.stamps, 0),
						points: Math.max(amounts.points, 0),
					});
				}
				if (row.stampDelta < 0 || row.pointDelta < 0) {
					add(reversed, {
						stamps: Math.max(-amounts.stamps, 0),
						points: Math.max(-amounts.points, 0),
					});
				}
				break;
			case "confirm":
				break;
		}
	}
	// A released hold nets to nothing in the ledger (the hold and its release
	// cancel), so `spendable` above already counts the returned amounts.
	return { spendable, held, spent, earned, reversed, expired, pending };
}
