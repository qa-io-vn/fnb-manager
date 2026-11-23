// Property-based, model-based testing of the loyalty ledger (docs/test-gaps.md
// G-15, component level): random sequences of earn, confirm, redeem (hold),
// confirm of a hold, release, clawback, expire and adjust are run through the
// @fnb/core ledger model and the invariants are checked after every step.
//
// ISTQB techniques: model-based testing (the running account kept by explicit
// transitions is compared with the account derived from the ledger rows),
// state transition testing (pending -> confirmed, held -> confirmed or released),
// boundary value analysis (balances and costs near zero, time steps that put an
// expiry on either side of a run), negative testing (refusals must change
// nothing), and security (no phone in any generated output).
//
// Seeds: the run is deterministic. In CI (the CI environment variable) the seed
// is fixed; elsewhere it is random. FC_SEED=<integer> forces one and FC_RUNS=<n>
// sets the number of generated sequences per property (300 by default). A failing
// property prints the seed, the replay command and fast-check's shrunk
// counterexample.
//
// The model implements the rules of ADR-046 (balances never go negative: an
// adjustment is floored at the balance, a clawback takes back at most what is
// left and writes the rest off, a pending earn never expires and its clock
// starts at its confirmation), the same rules as the database since migrations
// 20261123120000 to 20261123140000; the second half of G-15 replays generated
// sequences through the SQL functions (pgtap 244 and the loyalty-ledger-replay
// fixture). The rules before ADR-046 are kept as options of the model
// (uncappedClawbacks, allowNegativeAdjustments) to show that the properties
// catch them.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	accountFromEntries,
	addMonthsUtc,
	clawbackReason,
	type LedgerEntry,
	type LedgerOptions,
	type LedgerRules,
	LoyaltyLedger,
	REDEMPTION_RELEASED,
} from "../../src/index.js";

const CI_SEED = 20261122;
const RULES: LedgerRules = {
	stampValidityMonths: 2,
	pointsExpiryMonths: 3,
	timezone: "Asia/Ho_Chi_Minh",
};
const MEMBERS = ["member-a", "member-b", "member-c"] as const;
const START = Date.parse("2026-10-01T02:00:00Z");
const HOUR = 3_600_000;

function chooseSeed(): number {
	const forced = process.env.FC_SEED;
	if (forced !== undefined && /^-?\d+$/.test(forced)) {
		return Number(forced);
	}
	if (process.env.CI !== undefined && process.env.CI !== "") {
		return CI_SEED;
	}
	return Math.floor(Math.random() * 2 ** 31);
}

const SEED = chooseSeed();
const RUNS =
	Number(process.env.FC_RUNS) > 0 ? Number(process.env.FC_RUNS) : 300;

function assertProperty<T>(
	name: string,
	property: fc.IPropertyWithHooks<T>,
	runs = RUNS,
): void {
	try {
		fc.assert(property, { seed: SEED, numRuns: runs });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`property "${name}" failed with seed ${SEED} (replay: FC_SEED=${SEED} pnpm --filter @fnb/core test loyalty-ledger-properties)\n${detail}`,
		);
	}
}

type OpKind =
	| "earn"
	| "confirm"
	| "hold"
	| "confirmHold"
	| "release"
	| "clawback"
	| "expire"
	| "adjust";

type Op = {
	readonly kind: OpKind;
	readonly member: number;
	readonly stamps: number;
	readonly points: number;
	readonly pending: boolean;
	readonly pick: number;
	readonly hours: number;
};

const hoursArbitrary = fc.oneof(
	{ weight: 3, arbitrary: fc.constant(0) },
	{ weight: 3, arbitrary: fc.integer({ min: 1, max: 72 }) },
	{ weight: 1, arbitrary: fc.integer({ min: 24 * 20, max: 24 * 45 }) },
);

function opArbitrary(kind: OpKind, creditsOnly: boolean): fc.Arbitrary<Op> {
	const debit = kind === "adjust" && !creditsOnly;
	return fc.record({
		kind: fc.constant(kind),
		member: fc.nat(MEMBERS.length - 1),
		stamps: debit ? fc.integer({ min: -3, max: 3 }) : fc.nat(3),
		points: debit ? fc.integer({ min: -25, max: 25 }) : fc.nat(30),
		pending: fc.boolean(),
		pick: fc.nat(1_000),
		hours: hoursArbitrary,
	});
}

const WEIGHTS: Record<OpKind, number> = {
	earn: 6,
	confirm: 2,
	hold: 3,
	confirmHold: 2,
	release: 2,
	clawback: 2,
	expire: 2,
	adjust: 2,
};

/** `creditsOnly`: an adjustment can only credit, so a redemption is the one way to spend. */
function traceArbitrary(
	kinds: readonly OpKind[],
	creditsOnly = false,
): fc.Arbitrary<Op[]> {
	return fc.array(
		fc.oneof(
			...kinds.map((kind) => ({
				weight: WEIGHTS[kind],
				arbitrary: opArbitrary(kind, creditsOnly),
			})),
		),
		{ minLength: 1, maxLength: 45 },
	);
}

const ALL: readonly OpKind[] = [
	"earn",
	"confirm",
	"hold",
	"confirmHold",
	"release",
	"clawback",
	"expire",
	"adjust",
];
const WITHOUT_CLAWBACK = ALL.filter((kind) => kind !== "clawback");
const WITHOUT_EXPIRE = ALL.filter((kind) => kind !== "expire");

interface StepReport {
	readonly op: Op;
	readonly accepted: boolean;
	readonly refusal: string | null;
	/** The moment of the step. */
	readonly at: number;
	/** What each member could spend at that moment just before the step (ADR-047). */
	readonly spendableBefore: ReadonlyMap<
		string,
		{ stamps: number; points: number }
	>;
}

interface RunOutcome {
	readonly ledger: LoyaltyLedger;
	readonly steps: StepReport[];
}

/**
 * Runs a trace, calling `check` after every step with the ledger and the step.
 * A `pick` selects the target of confirm, release or clawback among the entries
 * of the right kind; with none, the step is skipped (and not counted).
 */
function execute(
	trace: readonly Op[],
	options: LedgerOptions = {},
	check: (
		ledger: LoyaltyLedger,
		step: StepReport,
		before: LedgerEntry[],
	) => void = () => {},
): RunOutcome {
	const ledger = new LoyaltyLedger(RULES, options);
	for (const member of MEMBERS) {
		ledger.join(member);
	}
	const steps: StepReport[] = [];
	let clock = START;
	for (const op of trace) {
		clock += op.hours * HOUR;
		const member = MEMBERS[op.member] ?? MEMBERS[0];
		const before = [...ledger.entries];
		const spendableBefore = new Map(
			MEMBERS.map((name) => {
				const balance = ledger.spendableAt(name, clock);
				return [
					name,
					{ stamps: balance.stamps, points: balance.points },
				] as const;
			}),
		);
		let result: { ok: true } | { ok: false; refusal: string } | null = null;
		const pickFrom = (rows: LedgerEntry[]) =>
			rows.length === 0 ? undefined : rows[op.pick % rows.length];
		switch (op.kind) {
			case "earn":
				result = ledger.earn(
					member,
					{ stamps: op.stamps, points: op.points },
					{ soldAt: clock, at: clock, pending: op.pending },
				);
				break;
			case "confirm": {
				const target = pickFrom(
					ledger.entries.filter((row) => row.kind === "earn" && row.pending),
				);
				result = target === undefined ? null : ledger.confirm(target.id, clock);
				break;
			}
			case "hold":
				result = ledger.hold(
					member,
					{ stamps: Math.min(op.stamps, 2), points: op.points },
					clock,
				);
				break;
			case "confirmHold": {
				const target = pickFrom(
					ledger.entries.filter((row) => row.kind === "redeem"),
				);
				result = target === undefined ? null : ledger.confirm(target.id, clock);
				break;
			}
			case "release": {
				const target = pickFrom(
					ledger.entries.filter((row) => row.kind === "redeem"),
				);
				result = target === undefined ? null : ledger.release(target.id, clock);
				break;
			}
			case "clawback": {
				const target = pickFrom(
					ledger.entries.filter((row) => row.kind === "earn"),
				);
				result =
					target === undefined ? null : ledger.clawback(target.id, clock);
				break;
			}
			case "expire":
				ledger.expire(clock);
				result = { ok: true };
				break;
			case "adjust":
				result = ledger.adjust(
					member,
					{ stamps: op.stamps, points: op.points },
					clock,
					"synthetic correction",
				);
				break;
		}
		if (result === null) {
			continue;
		}
		const step: StepReport = {
			op,
			accepted: result.ok,
			refusal: result.ok ? null : result.refusal,
			at: clock,
			spendableBefore,
		};
		steps.push(step);
		check(ledger, step, before);
	}
	return { ledger, steps };
}

type NegativeRule = "never" | "afterRedemption" | "afterConsumption";

/**
 * The invariants of one member's ledger. `negative` says when a spendable
 * balance below zero is explained: never; after a clawback that follows a
 * redemption (`pgtap:63_loyalty_earn`); or after a clawback that follows any
 * consumption of the credit: a redemption, an expiry or a manual debit.
 */
function violations(ledger: LoyaltyLedger, negative: NegativeRule): string[] {
	const found: string[] = [];
	for (const member of MEMBERS) {
		const balance = ledger.balance(member);
		const running = ledger.account(member);
		const derived = accountFromEntries(ledger.entries, member);
		if (running === undefined) {
			found.push(`${member}: no account`);
			continue;
		}
		if (JSON.stringify(running) !== JSON.stringify(derived)) {
			found.push(
				`${member}: the running account ${JSON.stringify(running)} differs from the rows ${JSON.stringify(derived)}`,
			);
		}
		for (const unit of ["stamps", "points"] as const) {
			const lhs =
				running.held[unit] + running.spendable[unit] + running.spent[unit];
			const rhs =
				running.earned[unit] - running.reversed[unit] - running.expired[unit];
			if (lhs !== rhs) {
				found.push(
					`${member}: held + spendable + spent = ${lhs} but earned - reversed - expired = ${rhs} (${unit})`,
				);
			}
			if (
				running.pending[unit] < 0 ||
				running.held[unit] < 0 ||
				running.spent[unit] < 0
			) {
				found.push(
					`${member}: a held, spent or pending ${unit} total is negative`,
				);
			}
		}
		if (
			running.spendable.stamps !== balance.stamps ||
			running.spendable.points !== balance.points ||
			running.pending.stamps !== balance.pendingStamps ||
			running.pending.points !== balance.pendingPoints
		) {
			found.push(`${member}: the account and the balance of the rows disagree`);
		}
		if (balance.stamps < 0 || balance.points < 0) {
			if (!negativeIsExplained(ledger.entries, member, negative)) {
				found.push(
					`${member}: spendable ${balance.stamps} stamps and ${balance.points} points are negative and ${negative === "never" ? "no clawback is allowed to explain it" : "no clawback after a consumption explains it"}`,
				);
			}
		}
	}
	return found;
}

function negativeIsExplained(
	entries: readonly LedgerEntry[],
	member: string,
	rule: NegativeRule,
): boolean {
	if (rule === "never") {
		return false;
	}
	const rows = entries.filter((row) => row.member === member);
	// A redemption (pgtap 63); beyond it an expiry or a manual debit, which
	// consume the credit in the same way.
	const consuming = rows.filter(
		(row) =>
			row.kind === "redeem" ||
			(rule === "afterConsumption" &&
				(row.kind === "expire" ||
					(row.kind === "adjust" &&
						row.reason !== REDEMPTION_RELEASED &&
						(row.stampDelta < 0 || row.pointDelta < 0)))),
	);
	return rows.some(
		(claw) =>
			claw.kind === "clawback" &&
			consuming.some((consumption) => consumption.id < claw.id),
	);
}

function failWith(found: string[], step: StepReport): void {
	if (found.length > 0) {
		throw new Error(`${found.join("; ")} after ${JSON.stringify(step.op)}`);
	}
}

describe("property: spendable stamps and points are never negative (ADR-046; state transition, boundary value)", () => {
	it("for any sequence of earn, confirm, hold, confirm hold, release, clawback, expire and adjust", () => {
		assertProperty(
			"never negative",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step) =>
					failWith(violations(ledger, "never"), step),
				);
			}),
		);
	});

	it("also when adjustments only credit and nothing expires, so a redemption is the one way to spend", () => {
		assertProperty(
			"never negative, credits only",
			fc.property(traceArbitrary(WITHOUT_EXPIRE, true), (trace) => {
				execute(trace, {}, (ledger, step) =>
					failWith(violations(ledger, "never"), step),
				);
			}),
		);
	});

	it("with the clawback of the rules before ADR-046, negative only after a clawback that follows a redemption, an expiry or a manual debit", () => {
		assertProperty(
			"before ADR-046: negative only after clawback following consumption",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, { uncappedClawbacks: true }, (ledger, step) =>
					failWith(violations(ledger, "afterConsumption"), step),
				);
			}),
		);
	});
});

describe("property: what a clawback takes plus what it writes off is the earn (ADR-046, decision table as a property)", () => {
	it("an accepted clawback takes at most the earn, the rest is written on its reason, a pending earn is taken whole", () => {
		assertProperty(
			"clawback write-off",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step, before) => {
					if (step.op.kind !== "clawback" || !step.accepted) {
						return;
					}
					const claw = ledger.entries[ledger.entries.length - 1];
					const earn = ledger.entry(claw?.sourceId ?? -1);
					if (claw?.kind !== "clawback" || earn?.kind !== "earn") {
						throw new Error("a clawback step wrote no clawback of an earn");
					}
					const taken = { stamps: -claw.stampDelta, points: -claw.pointDelta };
					const short = {
						stamps: earn.stampDelta - taken.stamps,
						points: earn.pointDelta - taken.points,
					};
					expect(Math.min(short.stamps, short.points)).toBeGreaterThanOrEqual(
						0,
					);
					expect(claw.reason).toBe(clawbackReason("invoice_voided", short));
					const wasPending =
						earn.pending &&
						!before.some(
							(row) => row.kind === "confirm" && row.sourceId === earn.id,
						);
					if (wasPending) {
						expect(short).toEqual({ stamps: 0, points: 0 });
					}
				});
			}),
		);
	});

	it("an expiry run never touches an earn still pending: the pending lines are the same before and after", () => {
		assertProperty(
			"pending earns never expire",
			fc.property(traceArbitrary(ALL), (trace) => {
				const pendingBefore = new Map<string, [number, number]>();
				execute(trace, {}, (ledger, step) => {
					for (const member of MEMBERS) {
						const balance = ledger.balance(member);
						if (step.op.kind === "expire") {
							expect([balance.pendingStamps, balance.pendingPoints]).toEqual(
								pendingBefore.get(member) ?? [0, 0],
							);
						}
						pendingBefore.set(member, [
							balance.pendingStamps,
							balance.pendingPoints,
						]);
					}
				});
			}),
		);
	});
});

describe("property: spendability follows the instant, not the expire rows (ADR-047)", () => {
	it("what a member may spend at a moment is never negative and never more than the ledger rows hold", () => {
		assertProperty(
			"spendable at the instant within the rows",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step) => {
					for (const member of MEMBERS) {
						const spendable = ledger.spendableAt(member, step.at);
						const rows = ledger.balance(member);
						expect(
							Math.min(spendable.stamps, spendable.points),
						).toBeGreaterThanOrEqual(0);
						expect(spendable.stamps).toBeLessThanOrEqual(rows.stamps);
						expect(spendable.points).toBeLessThanOrEqual(rows.points);
					}
				});
			}),
		);
	});

	it("an expiry run changes nothing a member may spend at its moment: it only writes down what had already ended", () => {
		assertProperty(
			"expiry writes down the instant",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step) => {
					if (step.op.kind !== "expire") {
						return;
					}
					for (const member of MEMBERS) {
						const now = ledger.spendableAt(member, step.at);
						expect({ stamps: now.stamps, points: now.points }).toEqual(
							step.spendableBefore.get(member),
						);
					}
				});
			}),
		);
	});

	it("an accepted hold or manual change moves what the member may spend at its moment by exactly its amounts (no credit that had ended is spent)", () => {
		assertProperty(
			"debits take exactly their amounts at the instant",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step, before) => {
					if (
						!step.accepted ||
						(step.op.kind !== "hold" && step.op.kind !== "adjust")
					) {
						return;
					}
					const written = ledger.entries
						.slice(before.length)
						.filter(
							(row) => row.kind === step.op.kind.replace("hold", "redeem"),
						);
					const row = written[written.length - 1];
					if (row === undefined) {
						throw new Error("an accepted step wrote no row of its kind");
					}
					const prior = step.spendableBefore.get(row.member);
					const now = ledger.spendableAt(row.member, step.at);
					expect(now.stamps - (prior?.stamps ?? 0)).toBe(row.stampDelta);
					expect(now.points - (prior?.points ?? 0)).toBe(row.pointDelta);
				});
			}),
		);
	});
});

describe("property: held + spendable + spent = earned - reversed - expired (conservation, model-based)", () => {
	it("holds after every step, for stamps and for points, and the running account equals the rows", () => {
		assertProperty(
			"conservation",
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, {}, (ledger, step) =>
					failWith(violations(ledger, "never"), step),
				);
			}),
		);
	});

	it("a confirmed hold moves its cost from held to spent and nothing else changes", () => {
		assertProperty(
			"confirm moves held to spent",
			fc.property(traceArbitrary(ALL), (trace) => {
				const accounts = new Map<
					string,
					ReturnType<LoyaltyLedger["account"]>
				>();
				execute(trace, {}, (ledger, step, before) => {
					if (step.op.kind === "confirmHold" && step.accepted) {
						const fresh = ledger.entries.slice(before.length);
						const confirm = fresh[fresh.length - 1];
						const hold = ledger.entry(confirm?.sourceId ?? -1);
						if (confirm?.kind === "confirm" && hold?.kind === "redeem") {
							const prior = accounts.get(hold.member);
							const now = ledger.account(hold.member);
							expect(now?.spent.points).toBe(
								(prior?.spent.points ?? 0) + -hold.pointDelta,
							);
							expect(now?.held.points).toBe(
								(prior?.held.points ?? 0) - -hold.pointDelta,
							);
							expect(now?.spendable).toEqual(prior?.spendable);
						}
					}
					for (const member of MEMBERS) {
						accounts.set(member, ledger.account(member));
					}
				});
			}),
		);
	});
});

describe("property: a release returns exactly what its hold took (state transition)", () => {
	it("the release row is the opposite of the hold and the balance, the stamps and the lots come back by exactly that", () => {
		assertProperty(
			"release is exact",
			fc.property(traceArbitrary(ALL), (trace) => {
				const lotsBefore = new Map<string, number>();
				const balances = new Map<string, { stamps: number; points: number }>();
				execute(trace, {}, (ledger, step, before) => {
					const fresh = ledger.entries.slice(before.length);
					const release = fresh.find(
						(row) =>
							row.kind === "adjust" && row.reason === REDEMPTION_RELEASED,
					);
					if (step.op.kind === "release" && step.accepted) {
						expect(release).toBeDefined();
						const hold = ledger.entry(release?.sourceId ?? -1);
						expect(hold?.kind).toBe("redeem");
						expect(release?.stampDelta).toBe(0 - (hold?.stampDelta ?? 0));
						expect(release?.pointDelta).toBe(0 - (hold?.pointDelta ?? 0));
						expect(release?.member).toBe(hold?.member);
						const member = hold?.member ?? "";
						const prior = balances.get(member);
						const now = ledger.balance(member);
						expect(now.points - (prior?.points ?? 0)).toBe(
							0 - (hold?.pointDelta ?? 0),
						);
						expect(now.stamps - (prior?.stamps ?? 0)).toBe(
							0 - (hold?.stampDelta ?? 0),
						);
						expect(
							ledger.activeStampLots(member) - (lotsBefore.get(member) ?? 0),
						).toBe(0 - (hold?.stampDelta ?? 0));
						expect(ledger.redemptionState(hold?.id ?? -1)).toBe("released");
					} else {
						expect(release).toBeUndefined();
					}
					for (const member of MEMBERS) {
						const balance = ledger.balance(member);
						balances.set(member, {
							stamps: balance.stamps,
							points: balance.points,
						});
						lotsBefore.set(member, ledger.activeStampLots(member));
					}
				});
			}),
		);
	});
});

describe("property: a refused operation changes nothing (negative testing)", () => {
	it("leaves every row and every account as they were", () => {
		assertProperty(
			"refusals change nothing",
			fc.property(traceArbitrary(ALL), (trace) => {
				const fresh = new LoyaltyLedger(RULES);
				for (const member of MEMBERS) {
					fresh.join(member);
				}
				let snapshot = JSON.stringify(accountsOf(fresh));
				execute(trace, {}, (ledger, step, before) => {
					if (!step.accepted) {
						expect(ledger.entries.length).toBe(before.length);
						expect(JSON.stringify(accountsOf(ledger))).toBe(snapshot);
					}
					snapshot = JSON.stringify(accountsOf(ledger));
				});
			}),
		);
	});

	it("an expire run twice at the same moment expires nothing the second time", () => {
		assertProperty(
			"expire is idempotent",
			fc.property(
				traceArbitrary(ALL),
				fc.integer({ min: 0, max: 24 * 120 }),
				(trace, extra) => {
					const { ledger } = execute(trace);
					const last = ledger.entries.reduce(
						(latest, row) => Math.max(latest, row.occurredAt),
						START,
					);
					const at = last + extra * HOUR;
					ledger.expire(at);
					expect(ledger.expire(at)).toEqual({
						memberships: 0,
						stamps: 0,
						points: 0,
					});
				},
			),
		);
	});
});

function accountsOf(ledger: LoyaltyLedger) {
	return MEMBERS.map((member) => ledger.account(member));
}

describe("the properties are not vacuous (the checks have teeth)", () => {
	it("generates every operation kind, accepted and refused, clawbacks that write off and pending earns that outlive an expiry run", () => {
		const accepted = new Map<OpKind, number>();
		const refused = new Map<OpKind, number>();
		let writeOffs = 0;
		let expiredStamps = 0;
		let expiredPoints = 0;
		let pendingThroughExpiry = 0;
		const samples = fc.sample(traceArbitrary(ALL), {
			seed: CI_SEED,
			numRuns: 400,
		});
		for (const trace of samples) {
			const { ledger, steps } = execute(trace);
			for (const step of steps) {
				const book = step.accepted ? accepted : refused;
				book.set(step.op.kind, (book.get(step.op.kind) ?? 0) + 1);
			}
			for (const row of ledger.entries) {
				if (row.kind === "clawback" && row.reason?.includes("; short by")) {
					writeOffs += 1;
				}
				if (row.kind === "expire") {
					expiredStamps += 0 - row.stampDelta;
					expiredPoints += 0 - row.pointDelta;
					if (
						ledger.entries.some(
							(earn) =>
								earn.kind === "earn" &&
								earn.pending &&
								earn.member === row.member &&
								earn.occurredAt < row.occurredAt &&
								!ledger.entries.some(
									(other) =>
										(other.kind === "confirm" || other.kind === "clawback") &&
										other.sourceId === earn.id &&
										other.occurredAt <= row.occurredAt,
								),
						)
					) {
						pendingThroughExpiry += 1;
					}
				}
			}
		}
		for (const kind of ALL) {
			expect(accepted.get(kind) ?? 0, `accepted ${kind}`).toBeGreaterThan(0);
		}
		for (const kind of [
			"confirm",
			"hold",
			"release",
			"clawback",
			"adjust",
		] as const) {
			expect(refused.get(kind) ?? 0, `refused ${kind}`).toBeGreaterThan(0);
		}
		expect(writeOffs).toBeGreaterThan(0);
		expect(expiredStamps).toBeGreaterThan(0);
		expect(expiredPoints).toBeGreaterThan(0);
		expect(pendingThroughExpiry).toBeGreaterThan(0);
	});

	it("finds a negative balance with the uncapped clawback of the rules before ADR-046", () => {
		const result = fc.check(
			fc.property(traceArbitrary(ALL), (trace) => {
				execute(trace, { uncappedClawbacks: true }, (ledger, step) =>
					failWith(violations(ledger, "never"), step),
				);
			}),
			{ seed: CI_SEED, numRuns: 500 },
		);
		expect(result.failed).toBe(true);
	});

	it("finds a negative balance when a negative adjustment has no floor, as app.loyalty_apply_adjustment had none before ADR-046", () => {
		const result = fc.check(
			fc.property(traceArbitrary(WITHOUT_CLAWBACK), (trace) => {
				execute(trace, { allowNegativeAdjustments: true }, (ledger, step) =>
					failWith(violations(ledger, "never"), step),
				);
			}),
			{ seed: CI_SEED, numRuns: 500 },
		);
		expect(result.failed).toBe(true);
	});

	it("flags a corrupted ledger: a release that returns one point too few, a hold never deducted, a clawback with the wrong sign", () => {
		const build = () => {
			const ledger = new LoyaltyLedger(RULES);
			for (const member of MEMBERS) {
				ledger.join(member);
			}
			const earn = ledger.earn(
				"member-a",
				{ stamps: 1, points: 20 },
				{ soldAt: START, at: START },
			);
			const hold = ledger.hold(
				"member-a",
				{ stamps: 1, points: 10 },
				START + HOUR,
			);
			if (!earn.ok || !hold.ok) {
				throw new Error("fixture refused");
			}
			ledger.release(hold.entryId, START + 2 * HOUR);
			ledger.hold("member-b", { stamps: 0, points: 1 }, START + 3 * HOUR);
			ledger.earn(
				"member-c",
				{ stamps: 0, points: 5 },
				{ soldAt: START, at: START + 4 * HOUR },
			);
			return { ledger, earn: earn.entryId, hold: hold.entryId };
		};
		type Mutable = { -readonly [K in keyof LedgerEntry]: LedgerEntry[K] };
		expect(violations(build().ledger, "never")).toEqual([]);

		const shortRelease = build();
		const release = shortRelease.ledger.entries.find(
			(row) => row.reason === REDEMPTION_RELEASED,
		) as Mutable;
		release.pointDelta -= 1;
		expect(violations(shortRelease.ledger, "never")).not.toEqual([]);

		const freeHold = build();
		const hold = freeHold.ledger.entry(freeHold.hold) as Mutable;
		hold.pointDelta = 0;
		expect(violations(freeHold.ledger, "never")).not.toEqual([]);

		const wrongSign = build();
		wrongSign.ledger.clawback(wrongSign.earn, START + 5 * HOUR);
		const claw = wrongSign.ledger.entries.find(
			(row) => row.kind === "clawback",
		) as Mutable;
		claw.pointDelta = Math.abs(claw.pointDelta);
		expect(violations(wrongSign.ledger, "never")).not.toEqual([]);
	});
});

describe("security: no phone appears in any generated output", () => {
	const PHONE = /(?:\+?84|\b0)[1-9]\d{8,9}\b/;

	it("rows, accounts, balances and failure messages carry opaque member ids and counts only", () => {
		assertProperty(
			"no phone in output",
			fc.property(traceArbitrary(ALL), (trace) => {
				const { ledger, steps } = execute(trace);
				const text = JSON.stringify({
					entries: ledger.entries,
					accounts: accountsOf(ledger),
					balances: MEMBERS.map((member) => ledger.balance(member)),
					steps,
					trace,
					violations: violations(ledger, "never"),
				});
				expect(text).not.toMatch(PHONE);
			}),
		);
	});

	it("an operation never takes a phone: a member id is the only identity the model reads", () => {
		const ledger = new LoyaltyLedger(RULES);
		const phone = `0${"900000"}${"123"}`;
		ledger.join("member-a");
		expect(
			ledger.earn(
				phone,
				{ stamps: 1, points: 1 },
				{ soldAt: START, at: START },
			),
		).toEqual({
			ok: false,
			refusal: "unknown_member",
		});
		expect(ledger.entries).toHaveLength(0);
	});
});

describe("the seed", () => {
	it("is an integer, fixed in CI and reported on failure", () => {
		expect(Number.isInteger(SEED)).toBe(true);
		if (
			process.env.CI !== undefined &&
			process.env.CI !== "" &&
			process.env.FC_SEED === undefined
		) {
			expect(SEED).toBe(CI_SEED);
		}
		expect(addMonthsUtc(START, 3)).toBeGreaterThan(START);
	});

	it("is printed with the replay command when a property fails", () => {
		let message = "";
		try {
			assertProperty(
				"always false",
				fc.property(fc.nat(), () => {
					throw new Error("synthetic failure");
				}),
				5,
			);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain(`seed ${SEED}`);
		expect(message).toContain(`FC_SEED=${SEED}`);
	});
});
