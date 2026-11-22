// The 30-day liability replay (docs/test-gaps.md G-16): a scripted year-on-year
// scenario whose nightly liability rows @fnb/core computes and the pgTAP file
// supabase/tests/236_loyalty_liability_replay.sql compares with
// `loyalty_liability_daily`, day by day.
//
// The window has 30 nightly runs (2027-10-17 to 2027-11-15, 04:00 local). Inside it:
//   * an expiry-month boundary: the points of the October 2026 cohort run out
//     through 31 October, those of the November 2026 cohort from 1 November;
//   * the switch of the breakage rate from the configured one to the observed
//     one, exactly six months after the first expiry (a run on 2027-04-21 04:00);
//   * confirmed and unconfirmed earns, clawbacks, holds that are confirmed,
//     released by hand or released by the nightly 24-hour rule, a manual credit
//     and a manual debit, and one member whose balance is negative.
// Two nightly runs before the window (2027-04-21 and 2027-05-16) expire the
// April 2026 cohort's points and the stamps of the autumn cohorts.
import { zonedInstant } from "../../src/rules/business-date.js";
import {
	type LedgerRules,
	LoyaltyLedger,
} from "../../src/rules/loyalty-ledger.js";
import {
	computeLiabilityRow,
	type LiabilityProgramme,
	type LiabilityRow,
} from "../../src/rules/loyalty-liability.js";
import { earnForAmount } from "../../src/rules/loyalty-rules.js";
import { REPLAY_PARAMETERS } from "./loyalty-replay.js";

export const LIABILITY_TIMEZONE = "Asia/Ho_Chi_Minh";
export const LIABILITY_RULES: LedgerRules = {
	stampValidityMonths: 6,
	pointsExpiryMonths: 12,
	timezone: LIABILITY_TIMEZONE,
};
export const LIABILITY_PROGRAMME: LiabilityProgramme = {
	pointValueAmount: 500,
	expectedBreakageRate: 0.2,
};
export const LIABILITY_MEMBER_COUNT = 12;
export const LIABILITY_WINDOW_FIRST = "2027-10-17";
export const LIABILITY_WINDOW_DAYS = 30;
export const LIABILITY_JOINED_AT = "2026-04-01T02:00:00.000Z";
export const LIABILITY_COUPONS = {
	cake: { key: "points-cake", stamps: 0, points: 40 },
	drink: { key: "stamp-drink", stamps: 2, points: 0 },
} as const;
export type LiabilityCoupon = keyof typeof LIABILITY_COUPONS;

export type LiabilityOp =
	| {
			kind: "earn";
			ref: string;
			member: number;
			soldAt: string;
			amount: number;
			at: string;
			pending: boolean;
	  }
	| { kind: "confirm"; ref: string; at: string }
	| { kind: "void"; ref: string; at: string }
	| {
			kind: "hold";
			ref: string;
			member: number;
			coupon: LiabilityCoupon;
			at: string;
	  }
	| { kind: "confirm_hold"; ref: string; invoice: string; at: string }
	| { kind: "release"; ref: string; at: string }
	| {
			kind: "adjust";
			member: number;
			stamps: number;
			points: number;
			reason: string;
			at: string;
	  }
	| { kind: "nightly"; at: string }
	| { kind: "liability"; at: string };

export interface LiabilityReplayFixture {
	readonly window: { readonly first: string; readonly days: number };
	readonly phones: readonly string[];
	readonly joinedAt: string;
	readonly ops: readonly LiabilityOp[];
	/** The row each nightly run (04:00) stores. */
	readonly rows: readonly LiabilityRow[];
	/** The row of an end-of-day run (23:30), which replaces the day's nightly row. */
	readonly closing: readonly LiabilityRow[];
	/** Ledger rows by kind once every operation has run. */
	readonly ledgerCounts: Readonly<Record<string, number>>;
	/** Spendable [stamps, points] by member index, as `app.loyalty_balance` returns them. */
	readonly balances: Readonly<Record<string, readonly [number, number]>>;
}

export function replaySummary(ledger: LoyaltyLedger): {
	ledgerCounts: Record<string, number>;
	balances: Record<string, [number, number]>;
} {
	const ledgerCounts: Record<string, number> = {};
	for (const row of ledger.entries) {
		ledgerCounts[row.kind] = (ledgerCounts[row.kind] ?? 0) + 1;
	}
	const balances: Record<string, [number, number]> = {};
	for (let index = 0; index < LIABILITY_MEMBER_COUNT; index += 1) {
		const balance = ledger.balance(memberId(index));
		balances[String(index)] = [balance.stamps, balance.points];
	}
	return { ledgerCounts, balances };
}

export function memberId(index: number): string {
	return `member-${String(index + 1).padStart(2, "0")}`;
}

export function liabilityPhone(index: number): string {
	return `09000008${String(index).padStart(2, "0")}`;
}

function iso(date: string, hhmm: string): string {
	const [hours, minutes] = hhmm.split(":").map(Number) as [number, number];
	return zonedInstant(
		date,
		hours * 60 + minutes,
		LIABILITY_TIMEZONE,
	).toISOString();
}

function plusMinutes(isoMoment: string, minutes: number): string {
	return new Date(Date.parse(isoMoment) + minutes * 60_000).toISOString();
}

function shift(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

function generator(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Applies operations to the ledger model and collects a liability row per nightly run. */
export class LiabilityReplayRunner {
	readonly ledger = new LoyaltyLedger(LIABILITY_RULES);
	readonly rows: LiabilityRow[] = [];
	readonly closing: LiabilityRow[] = [];
	private readonly joinedAt = new Map<string, number>();
	private readonly earns = new Map<string, number>();
	private readonly holds = new Map<string, number>();
	private readonly voided: string[] = [];

	constructor(joinedAt: string = LIABILITY_JOINED_AT) {
		for (let index = 0; index < LIABILITY_MEMBER_COUNT; index += 1) {
			this.ledger.join(memberId(index));
			this.joinedAt.set(memberId(index), Date.parse(joinedAt));
		}
	}

	apply(op: LiabilityOp): void {
		const at = Date.parse(op.at);
		switch (op.kind) {
			case "earn": {
				const result = this.ledger.earn(
					memberId(op.member),
					earnForAmount(op.amount, REPLAY_PARAMETERS),
					{ soldAt: Date.parse(op.soldAt), at, pending: op.pending },
				);
				this.need(result.ok, `earn ${op.ref}`);
				if (result.ok) {
					this.earns.set(op.ref, result.entryId);
				}
				return;
			}
			case "confirm":
				this.need(
					this.ledger.confirm(this.earnId(op.ref), at).ok,
					`confirm ${op.ref}`,
				);
				return;
			case "void":
				this.voided.push(op.ref);
				return;
			case "hold": {
				const coupon = LIABILITY_COUPONS[op.coupon];
				const result = this.ledger.hold(
					memberId(op.member),
					{ stamps: coupon.stamps, points: coupon.points },
					at,
				);
				this.need(result.ok, `hold ${op.ref}`);
				if (result.ok) {
					this.holds.set(op.ref, result.entryId);
				}
				return;
			}
			case "confirm_hold":
				this.need(
					this.ledger.confirm(this.holdId(op.ref), at).ok,
					`confirm hold ${op.ref}`,
				);
				return;
			case "release":
				this.need(
					this.ledger.release(this.holdId(op.ref), at).ok,
					`release ${op.ref}`,
				);
				return;
			case "adjust":
				this.need(
					this.ledger.adjust(
						memberId(op.member),
						{ stamps: op.stamps, points: op.points },
						at,
						op.reason,
					).ok,
					`adjust ${op.reason}`,
				);
				return;
			case "nightly":
				this.nightly(at);
				return;
			case "liability":
				this.closing.push(this.liabilityAt(at));
				return;
		}
	}

	/** `app.loyalty_nightly`: release due holds, claw back voided invoices, expire, store the liability. */
	private nightly(at: number): void {
		const due = this.ledger
			.heldRedemptions()
			.filter(
				(id) =>
					(this.ledger.holdExpiresAt(id) ?? Number.POSITIVE_INFINITY) <= at,
			)
			.sort(
				(a, b) =>
					(this.ledger.holdExpiresAt(a) ?? 0) -
						(this.ledger.holdExpiresAt(b) ?? 0) || a - b,
			);
		for (const id of due) {
			this.ledger.release(id, at);
		}
		for (const ref of this.voided) {
			this.ledger.clawback(this.earnId(ref), at);
		}
		this.ledger.expire(at);
		this.rows.push(this.liabilityAt(at));
	}

	private liabilityAt(at: number): LiabilityRow {
		return computeLiabilityRow({
			entries: this.ledger.entries,
			joinedAt: this.joinedAt,
			rules: LIABILITY_RULES,
			programme: LIABILITY_PROGRAMME,
			asOf: at,
		});
	}

	private need(ok: boolean, what: string): void {
		if (!ok) {
			throw new Error(
				`the replay scenario is not feasible: ${what} was refused`,
			);
		}
	}

	private earnId(ref: string): number {
		const id = this.earns.get(ref);
		if (id === undefined) {
			throw new Error(`unknown earn ${ref}`);
		}
		return id;
	}

	private holdId(ref: string): number {
		const id = this.holds.get(ref);
		if (id === undefined) {
			throw new Error(`unknown hold ${ref}`);
		}
		return id;
	}
}

export function runLiabilityReplay(ops: readonly LiabilityOp[]): {
	rows: LiabilityRow[];
	closing: LiabilityRow[];
} {
	const runner = new LiabilityReplayRunner();
	for (const op of ops) {
		runner.apply(op);
	}
	return { rows: runner.rows, closing: runner.closing };
}

function byTime(left: LiabilityOp, right: LiabilityOp): number {
	return Date.parse(left.at) - Date.parse(right.at);
}

function hhmmOf(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function buildLiabilityReplay(seed = 20261122): LiabilityReplayFixture {
	const random = generator(seed);
	const integer = (min: number, max: number) =>
		min + Math.floor(random() * (max - min + 1));
	const ops: LiabilityOp[] = [];
	const live = new LiabilityReplayRunner();
	const perDay = new Map<string, number>();
	const lastEarnOf = new Map<number, string>();
	const reserved = new Set([11]);
	let sequence = 0;
	let day: LiabilityOp[] = [];
	const plan = (op: LiabilityOp) => {
		day.push(op);
	};
	// Applies the planned operations of a stretch of time, in time order.
	const flush = () => {
		day.sort(byTime);
		for (const op of day) {
			ops.push(op);
			live.apply(op);
		}
		day = [];
	};
	const sale = (
		member: number,
		date: string,
		hhmm: string,
		amount: number,
		pending = false,
	): string => {
		sequence += 1;
		const ref = `lq-${String(sequence).padStart(4, "0")}`;
		const soldAt = iso(date, hhmm);
		perDay.set(`${member}|${date}`, (perDay.get(`${member}|${date}`) ?? 0) + 1);
		plan({
			kind: "earn",
			ref,
			member,
			soldAt,
			amount,
			at: plusMinutes(soldAt, 5),
			pending,
		});
		return ref;
	};
	const free = (member: number, date: string) =>
		(perDay.get(`${member}|${date}`) ?? 0) < 3;
	const distinctMembers = (count: number, date: string) => {
		const picked = new Set<number>();
		while (picked.size < count) {
			const member = integer(0, LIABILITY_MEMBER_COUNT - 1);
			if (!reserved.has(member) && free(member, date)) {
				picked.add(member);
			}
		}
		return [...picked];
	};
	const sellDay = (
		date: string,
		count: number,
		latest: number,
		pendingShare: number,
	): { member: number; ref: string; pending: boolean }[] => {
		const members = distinctMembers(count, date);
		const times = members
			.map(() => integer(8 * 60, latest))
			.sort((a, b) => a - b);
		return members.map((member, index) => {
			const pending = random() < pendingShare;
			const ref = sale(
				member,
				date,
				hhmmOf(times[index] ?? 8 * 60),
				1_000 * integer(10, 150),
				pending,
			);
			return { member, ref, pending };
		});
	};

	// The April 2026 cohort: its points expire on 2027-04-20 and the first nightly
	// run after that is the programme's first expiry.
	sale(0, "2026-04-20", "10:00", 80_000);
	sale(1, "2026-04-20", "10:10", 45_000);
	sale(2, "2026-04-20", "10:20", 120_000);
	flush();

	// The two cohorts that straddle the expiry-month boundary of the window: sales
	// from 17 October to 15 November 2026, a year before it.
	for (let offset = 0; offset < 30; offset += 1) {
		const date = shift("2026-10-17", offset);
		sellDay(date, integer(2, 3), 20 * 60 - 1, 0);
		if (date === "2026-10-31") {
			// After the nightly hour: their points expire on 31 October 2027 after
			// 04:00, so the run of 1 November takes them.
			if (free(3, date)) sale(3, date, "22:30", 70_000);
			if (free(4, date)) sale(4, date, "23:45", 30_000);
		}
		flush();
	}

	plan({ kind: "nightly", at: iso("2027-04-21", "04:00") });
	plan({ kind: "nightly", at: iso("2027-05-16", "04:00") });
	flush();

	// The window: a nightly run each morning and events during the days between.
	const confirmOn = new Map<string, string[]>();
	const voidOn = new Map<string, string[]>();
	const later = (book: Map<string, string[]>, date: string, ref: string) => {
		book.set(date, [...(book.get(date) ?? []), ref]);
	};
	for (let k = 0; k < LIABILITY_WINDOW_DAYS; k += 1) {
		const date = shift(LIABILITY_WINDOW_FIRST, k);
		plan({ kind: "nightly", at: iso(date, "04:00") });
		if (k === LIABILITY_WINDOW_DAYS - 1) {
			flush();
			break;
		}
		for (const ref of confirmOn.get(date) ?? []) {
			plan({ kind: "confirm", ref, at: iso(date, "09:30") });
		}
		for (const ref of voidOn.get(date) ?? []) {
			plan({ kind: "void", ref, at: iso(date, "11:00") });
			for (const [member, last] of lastEarnOf) {
				if (last === ref) lastEarnOf.delete(member);
			}
		}
		for (const { member, ref, pending } of sellDay(
			date,
			integer(3, 5),
			19 * 60,
			0.12,
		)) {
			if (pending) {
				later(confirmOn, shift(date, 1), ref);
			} else {
				lastEarnOf.set(member, ref);
				if (random() < 0.08) later(voidOn, shift(date, 1), ref);
			}
		}
		if (k === 4) {
			plan({
				kind: "adjust",
				member: 3,
				stamps: 1,
				points: 25,
				reason: "goodwill credit",
				at: iso(date, "15:00"),
			});
		}
		if (k === 12) {
			plan({
				kind: "adjust",
				member: 5,
				stamps: 0,
				points: -10,
				reason: "correction",
				at: iso(date, "15:30"),
			});
		}
		if (k === 9) {
			// The negative member: three 150,000 earns, a cake held and confirmed,
			// then the last earn is voided and clawed back (45 - 40 - 15 = -10).
			sale(11, date, "09:00", 150_000);
			const second = sale(11, date, "10:00", 150_000);
			const third = sale(11, date, "11:00", 150_000);
			plan({
				kind: "hold",
				ref: "hold-neg",
				member: 11,
				coupon: "cake",
				at: iso(date, "14:00"),
			});
			plan({
				kind: "confirm_hold",
				ref: "hold-neg",
				invoice: second,
				at: iso(date, "15:00"),
			});
			later(voidOn, shift(date, 1), third);
		}
		flush();
		if ((k - 2) % 3 === 0) {
			// A hold in the evening, once the day's sales are in.
			const slot = (k - 2) / 3;
			const coupon: LiabilityCoupon = slot % 2 === 0 ? "cake" : "drink";
			const cost = LIABILITY_COUPONS[coupon];
			const at = Date.parse(iso(date, "20:30"));
			const holders = new Set(
				live.ledger
					.heldRedemptions()
					.map((id) => live.ledger.entry(id)?.member),
			);
			const candidates = [...Array(LIABILITY_MEMBER_COUNT).keys()].filter(
				(member) => {
					const id = memberId(member);
					const balance = live.ledger.balance(id);
					return (
						!reserved.has(member) &&
						lastEarnOf.has(member) &&
						!holders.has(id) &&
						balance.points >= cost.points &&
						balance.stamps >= cost.stamps &&
						live.ledger.spendableLots(id, at).length >= cost.stamps
					);
				},
			);
			const chosen = candidates[integer(0, Math.max(candidates.length - 1, 0))];
			if (chosen !== undefined) {
				const ref = `hold-${String(k).padStart(2, "0")}`;
				plan({
					kind: "hold",
					ref,
					member: chosen,
					coupon,
					at: iso(date, "20:30"),
				});
				if (slot % 3 === 0) {
					plan({
						kind: "confirm_hold",
						ref,
						invoice: lastEarnOf.get(chosen) ?? "",
						at: iso(date, "21:30"),
					});
				} else if (slot % 3 === 1) {
					plan({ kind: "release", ref, at: iso(date, "21:30") });
				}
				// Otherwise the nightly 24-hour rule releases it.
				flush();
			}
		}
		// An end-of-day run replaces the day's nightly row with the whole day's flows.
		plan({ kind: "liability", at: iso(date, "23:30") });
		flush();
	}
	return {
		window: { first: LIABILITY_WINDOW_FIRST, days: LIABILITY_WINDOW_DAYS },
		phones: Array.from({ length: LIABILITY_MEMBER_COUNT }, (_, index) =>
			liabilityPhone(index),
		),
		joinedAt: LIABILITY_JOINED_AT,
		ops,
		rows: live.rows,
		closing: live.closing,
		...replaySummary(live.ledger),
	};
}
