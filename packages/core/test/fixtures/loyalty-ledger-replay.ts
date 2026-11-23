// The second half of G-15: generated sequences of earn, confirm, hold, confirm
// of a hold, release, clawback, expire and adjust, run through the @fnb/core
// ledger model here and through the SQL functions by
// supabase/tests/244_loyalty_ledger_sequence_replay.sql, which compares the
// balances after every step. The rules are those of ADR-046 (a balance never
// goes below zero) and ADR-047 (a credit is valid through the end of its
// anniversary day and spendable until that instant).
//
// Each sequence has its own synthetic tenant in the database, so an expiry run
// of one sequence never touches another. Three members, at most
// LEDGER_REPLAY_STEPS steps, deterministic from the seed. A step is
//   [minutes since the previous step, kind, member, a, b, accepted, expected...]
// where the expected values are, for each of the three members, the spendable
// stamps and points and the pending stamps and points at the moment of the step
// (app.loyalty_balance(membership, moment)). Kinds and their arguments:
//   0 earn          a = net amount in thousands, b = 1 when written pending
//   1 confirm       a = the ordinal of the earn (among the sequence's earns)
//   2 hold          a = the coupon index (LEDGER_REPLAY_COUPONS)
//   3 confirm hold  a = the ordinal of the hold
//   4 release       a = the ordinal of the hold
//   5 clawback      a = the ordinal of the earn
//   6 expire        (the sequence's tenant)
//   7 adjust        a = stamps, b = points (signed, never both 0)
// No phone, name or other personal datum is in the fixture: members are
// indexes, the database gives them synthetic phones.
import type { Amounts, LedgerRules } from "../../src/rules/loyalty-ledger.js";
import { LoyaltyLedger } from "../../src/rules/loyalty-ledger.js";
import { earnForAmount } from "../../src/rules/loyalty-rules.js";

export const LEDGER_REPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
export const LEDGER_REPLAY_RULES: LedgerRules = {
	stampValidityMonths: 2,
	pointsExpiryMonths: 3,
	timezone: LEDGER_REPLAY_TIMEZONE,
};
export const LEDGER_REPLAY_EARN = {
	stampMinBillAmount: 50_000,
	pointUnitAmount: 10_000,
	pointsPerUnit: 1,
} as const;
/** [stamps, points] of each reward of the catalogue. */
export const LEDGER_REPLAY_COUPONS: readonly (readonly [number, number])[] = [
	[1, 0],
	[0, 5],
	[1, 8],
	[2, 0],
	[0, 12],
];
export const LEDGER_REPLAY_SEQUENCES = 200;
export const LEDGER_REPLAY_STEPS = 20;
export const LEDGER_REPLAY_MEMBERS = 3;
/** The first step of every sequence (local 2026-10-01 09:00). */
export const LEDGER_REPLAY_START = "2026-10-01T02:00:00.000Z";
export const LEDGER_REPLAY_AMOUNTS = [5, 12, 30, 49, 50, 60, 99, 150] as const;

export const KIND = {
	earn: 0,
	confirm: 1,
	hold: 2,
	confirmHold: 3,
	release: 4,
	clawback: 5,
	expire: 6,
	adjust: 7,
} as const;
export type KindName = keyof typeof KIND;

export type ReplayStep = number[];

export interface LedgerReplaySequence {
	readonly steps: readonly ReplayStep[];
	/** Per member: the ledger rows' stamps and points (app.loyalty_balance with no moment). */
	readonly rows: readonly number[];
	/** Ledger rows of the sequence by kind: earn, confirm, clawback, redeem, adjust, expire. */
	readonly counts: readonly number[];
}

export interface LedgerReplayFixture {
	readonly start: string;
	readonly rules: {
		readonly stampValidityMonths: number;
		readonly pointsExpiryMonths: number;
	};
	readonly coupons: readonly (readonly [number, number])[];
	readonly sequences: readonly LedgerReplaySequence[];
}

const MEMBER_IDS = ["m0", "m1", "m2"] as const;
const ROW_KINDS = [
	"earn",
	"confirm",
	"clawback",
	"redeem",
	"adjust",
	"expire",
] as const;
const MINUTE = 60_000;

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

const WEIGHTS: readonly [KindName, number][] = [
	["earn", 6],
	["confirm", 2],
	["hold", 3],
	["confirmHold", 2],
	["release", 2],
	["clawback", 2],
	["expire", 2],
	["adjust", 2],
];

/** Applies the steps of one sequence to a fresh model and returns it with each step's outcome. */
export class LedgerReplayRunner {
	readonly ledger = new LoyaltyLedger(LEDGER_REPLAY_RULES);
	private clock = Date.parse(LEDGER_REPLAY_START);
	private readonly earns: number[] = [];
	private readonly holds: { id: number; coupon: number; member: number }[] = [];

	constructor() {
		for (const member of MEMBER_IDS) {
			this.ledger.join(member);
		}
	}

	get moment(): number {
		return this.clock;
	}

	earnCount(): number {
		return this.earns.length;
	}

	holdCount(): number {
		return this.holds.length;
	}

	/** Whether a member holds a coupon right now (the database refuses a second hold: already_held). */
	holding(member: number, coupon: number): boolean {
		return this.holds.some(
			(hold) =>
				hold.member === member &&
				hold.coupon === coupon &&
				this.ledger.redemptionState(hold.id) === "held",
		);
	}

	pendingEarnOrdinals(): number[] {
		return this.earns
			.map((id, ordinal) => ({ id, ordinal }))
			.filter(({ id }) => this.ledger.entry(id)?.pending === true)
			.map(({ ordinal }) => ordinal);
	}

	/** Runs one step; returns whether it was accepted, as the SQL function answers it. */
	apply(step: readonly number[]): boolean {
		const [minutes = 0, kind = 0, member = 0, a = 0, b = 0] = step;
		this.clock += minutes * MINUTE;
		const at = this.clock;
		const id = MEMBER_IDS[member] ?? "m0";
		switch (kind) {
			case KIND.earn: {
				const amounts: Amounts = earnForAmount(a * 1000, LEDGER_REPLAY_EARN);
				const result = this.ledger.earn(id, amounts, {
					soldAt: at - 5 * MINUTE,
					at,
					pending: b === 1,
				});
				if (result.ok) {
					this.earns.push(result.entryId);
				}
				return result.ok;
			}
			case KIND.confirm: {
				const earn = this.earns[a];
				return earn !== undefined && this.ledger.confirm(earn, at).ok;
			}
			case KIND.hold: {
				const [stamps, points] = LEDGER_REPLAY_COUPONS[a] ?? [0, 0];
				const result = this.ledger.hold(id, { stamps, points }, at);
				if (result.ok) {
					this.holds.push({ id: result.entryId, coupon: a, member });
				}
				return result.ok;
			}
			case KIND.confirmHold: {
				const hold = this.holds[a];
				// app.confirm_redemption confirms a held redemption only
				if (
					hold === undefined ||
					this.ledger.redemptionState(hold.id) !== "held"
				) {
					return false;
				}
				return this.ledger.confirm(hold.id, at).ok;
			}
			case KIND.release: {
				const hold = this.holds[a];
				return hold !== undefined && this.ledger.release(hold.id, at).ok;
			}
			case KIND.clawback: {
				const earn = this.earns[a];
				return earn !== undefined && this.ledger.clawback(earn, at).ok;
			}
			case KIND.expire:
				this.ledger.expire(at);
				return true;
			case KIND.adjust:
				return this.ledger.adjust(
					id,
					{ stamps: a, points: b },
					at,
					"synthetic correction",
				).ok;
			default:
				throw new RangeError(`unknown step kind ${kind}`);
		}
	}

	/** Spendable stamps, points, pending stamps and pending points of every member at the current moment. */
	expected(): number[] {
		return MEMBER_IDS.flatMap((member) => {
			const balance = this.ledger.spendableAt(member, this.clock);
			return [
				balance.stamps,
				balance.points,
				balance.pendingStamps,
				balance.pendingPoints,
			];
		});
	}

	rows(): number[] {
		return MEMBER_IDS.flatMap((member) => {
			const balance = this.ledger.balance(member);
			return [balance.stamps, balance.points];
		});
	}

	counts(): number[] {
		return ROW_KINDS.map(
			(kind) => this.ledger.entries.filter((row) => row.kind === kind).length,
		);
	}
}

function pick<T>(random: () => number, items: readonly T[]): T {
	const item = items[Math.floor(random() * items.length)];
	if (item === undefined) {
		throw new RangeError("pick from an empty list");
	}
	return item;
}

function drawKind(random: () => number): KindName {
	const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
	let roll = random() * total;
	for (const [kind, weight] of WEIGHTS) {
		roll -= weight;
		if (roll < 0) {
			return kind;
		}
	}
	return "earn";
}

function drawMinutes(random: () => number): number {
	const roll = random();
	if (roll < 0.3) {
		return 0;
	}
	if (roll < 0.75) {
		return 60 * (1 + Math.floor(random() * 72));
	}
	// 20 to 45 days, at any minute of the day, so that expiries fall between steps
	return (
		60 * 24 * (20 + Math.floor(random() * 26)) + Math.floor(random() * 1440)
	);
}

/** Draws the next step for the runner's state, or null when the drawn kind has no target. */
function drawStep(
	random: () => number,
	runner: LedgerReplayRunner,
): number[] | null {
	const kind = drawKind(random);
	const member = Math.floor(random() * LEDGER_REPLAY_MEMBERS);
	const minutes = drawMinutes(random);
	switch (kind) {
		case "earn":
			return [
				minutes,
				KIND.earn,
				member,
				pick(random, LEDGER_REPLAY_AMOUNTS),
				random() < 0.3 ? 1 : 0,
			];
		case "confirm": {
			const pending = runner.pendingEarnOrdinals();
			return pending.length === 0
				? null
				: [minutes, KIND.confirm, 0, pick(random, pending), 0];
		}
		case "hold": {
			const coupon = Math.floor(random() * LEDGER_REPLAY_COUPONS.length);
			return runner.holding(member, coupon)
				? null
				: [minutes, KIND.hold, member, coupon, 0];
		}
		case "confirmHold":
		case "release":
			return runner.holdCount() === 0
				? null
				: [
						minutes,
						KIND[kind],
						0,
						Math.floor(random() * runner.holdCount()),
						0,
					];
		case "clawback":
			return runner.earnCount() === 0
				? null
				: [
						minutes,
						KIND.clawback,
						0,
						Math.floor(random() * runner.earnCount()),
						0,
					];
		case "expire":
			return [minutes, KIND.expire, 0, 0, 0];
		case "adjust": {
			const stamps = Math.floor(random() * 7) - 3;
			const points = Math.floor(random() * 41) - 20;
			return stamps === 0 && points === 0
				? null
				: [minutes, KIND.adjust, member, stamps, points];
		}
	}
}

export function buildLedgerReplay(seed = 20261123): LedgerReplayFixture {
	const random = generator(seed);
	const sequences: LedgerReplaySequence[] = [];
	for (let index = 0; index < LEDGER_REPLAY_SEQUENCES; index += 1) {
		const runner = new LedgerReplayRunner();
		const steps: ReplayStep[] = [];
		let attempts = 0;
		while (steps.length < LEDGER_REPLAY_STEPS && attempts < 200) {
			attempts += 1;
			const step = drawStep(random, runner);
			if (step === null) {
				continue;
			}
			const accepted = runner.apply(step);
			steps.push([...step, accepted ? 1 : 0, ...runner.expected()]);
		}
		sequences.push({ steps, rows: runner.rows(), counts: runner.counts() });
	}
	return {
		start: LEDGER_REPLAY_START,
		rules: {
			stampValidityMonths: LEDGER_REPLAY_RULES.stampValidityMonths,
			pointsExpiryMonths: LEDGER_REPLAY_RULES.pointsExpiryMonths,
		},
		coupons: LEDGER_REPLAY_COUPONS,
		sequences,
	};
}

/** Runs a fixture's steps through a fresh model per sequence (the independent check of the unit test). */
export function replaySequence(sequence: LedgerReplaySequence): {
	steps: number[][];
	rows: number[];
	counts: number[];
} {
	const runner = new LedgerReplayRunner();
	const steps = sequence.steps.map((step) => {
		const input = step.slice(0, 5);
		const accepted = runner.apply(input);
		return [...input, accepted ? 1 : 0, ...runner.expected()];
	});
	return { steps, rows: runner.rows(), counts: runner.counts() };
}
