// Nightly liability and breakage (G-16): outstanding confirmed points x point
// value x (1 - breakage), computed in @fnb/core and compared, day by day, with
// loyalty_liability_daily in supabase/tests/236_loyalty_liability_replay.sql.
// ISTQB techniques per block: boundary value analysis (a half cent, the six-month
// maturity of the first expiry, the 12-month observation window, month ends),
// equivalence partitioning (money inputs, breakage sources), state transition
// testing (pending -> confirmed, hold -> released), negative tests (inputs the
// arithmetic refuses), and security (no phone in any output).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	addMonthsUtc,
	computeLiabilityRow,
	expiredByIssueMonth,
	expiryCohortMonth,
	formatCents,
	formatThousandths,
	type LedgerEntry,
	type LedgerRules,
	LoyaltyLedger,
	ledgerBalance,
	observedBreakageMilli,
	pointsLiability,
	pointsLiabilityCents,
} from "../../src/index.js";
import {
	buildLiabilityReplay,
	LIABILITY_JOINED_AT,
	LIABILITY_MEMBER_COUNT,
	LIABILITY_PROGRAMME,
	LIABILITY_WINDOW_DAYS,
	LIABILITY_WINDOW_FIRST,
	type LiabilityReplayFixture,
	LiabilityReplayRunner,
	memberId,
	runLiabilityReplay,
} from "../fixtures/loyalty-liability-replay.js";

const fixturePath = fileURLToPath(
	new URL("../fixtures/loyalty-liability-replay.json", import.meta.url),
);
const sqlTestPath = fileURLToPath(
	new URL(
		"../../../../supabase/tests/236_loyalty_liability_replay.sql",
		import.meta.url,
	),
);

// UPDATE_LOYALTY_REPLAY=1 rewrites the fixture and the copy embedded in the pgTAP
// file (then run biome format on the fixture).
if (process.env.UPDATE_LOYALTY_REPLAY === "1") {
	const json = JSON.stringify(buildLiabilityReplay());
	writeFileSync(fixturePath, `${json}\n`);
	if (existsSync(sqlTestPath)) {
		const sql = readFileSync(sqlTestPath, "utf8");
		writeFileSync(
			sqlTestPath,
			sql.replace(
				/\$liability\$\{.*\}\$liability\$/s,
				() => `$liability$${json}$liability$`,
			),
		);
	}
}

const RULES: LedgerRules = {
	stampValidityMonths: 6,
	pointsExpiryMonths: 12,
	timezone: "Asia/Ho_Chi_Minh",
};
const PROGRAMME = { pointValueAmount: 500, expectedBreakageRate: 0.2 };
const at = (local: string) => Date.parse(`${local}:00+07:00`);

function rowAt(ledger: LoyaltyLedger, asOf: number, members: string[]) {
	return computeLiabilityRow({
		entries: ledger.entries,
		joinedAt: new Map(
			members.map((member) => [member, at("2026-01-01T09:00")]),
		),
		rules: RULES,
		programme: PROGRAMME,
		asOf,
	});
}

function ledgerOf(...members: string[]): LoyaltyLedger {
	return ledgerWith({}, ...members);
}

function ledgerWith(
	options: ConstructorParameters<typeof LoyaltyLedger>[1],
	...members: string[]
): LoyaltyLedger {
	const ledger = new LoyaltyLedger(RULES, options);
	for (const member of members) {
		ledger.join(member);
	}
	return ledger;
}

describe("pointsLiabilityCents: exact money arithmetic (equivalence partitioning, boundary values)", () => {
	it.each([
		{
			label: "nothing outstanding",
			points: 0,
			value: 500,
			rate: 0.2,
			cents: 0,
		},
		{ label: "one point", points: 1, value: 500, rate: 0.2, cents: 40_000 },
		{
			label: "the 65_loyalty_jobs hand case",
			points: 19,
			value: 500,
			rate: 0.2,
			cents: 760_000,
		},
		{
			label: "cents in the value",
			points: 333,
			value: 123.45,
			rate: 0.25,
			cents: 3_083_164,
		},
		{ label: "no breakage", points: 10, value: 0.01, rate: 0, cents: 10 },
		{
			label: "the largest breakage rate (0.9)",
			points: 1_000,
			value: 500,
			rate: 0.9,
			cents: 5_000_000,
		},
		{ label: "a free point", points: 1_000, value: 0, rate: 0.2, cents: 0 },
		{
			label: "the largest point value",
			points: 1,
			value: 1_000_000,
			rate: 0.2,
			cents: 80_000_000,
		},
		{
			label: "a half cent rounds away from zero",
			points: 1,
			value: 0.05,
			rate: 0.5,
			cents: 3,
		},
		{
			label: "a third decimal of the rate",
			points: 1_000,
			value: 500,
			rate: 0.333,
			cents: 33_350_000,
		},
	])(
		"$label: $points x $value x (1 - $rate) is $cents hundredths",
		({ points, value, rate, cents }) => {
			expect(
				pointsLiabilityCents({
					outstandingPoints: points,
					pointValueAmount: value,
					expectedBreakageRate: rate,
				}),
			).toBe(cents);
		},
	);

	it("moves no half cent where floats would: 1 point x 0.29 x (1 - 0.5) is 0.145, so 0.15", () => {
		// the float product is 0.14499999999999999 and rounds to 0.14
		expect(Math.round(1 * 0.29 * (1 - 0.5) * 100)).toBe(14);
		const input = {
			outstandingPoints: 1,
			pointValueAmount: 0.29,
			expectedBreakageRate: 0.5,
		};
		expect(pointsLiabilityCents(input)).toBe(15);
		expect(pointsLiability(input)).toBe(0.15);
	});

	it("keeps pointsLiability equal to the cents over 100 for the existing cases", () => {
		expect(
			pointsLiability({
				outstandingPoints: 1_000,
				pointValueAmount: 500,
				expectedBreakageRate: 0.2,
			}),
		).toBe(400_000);
		expect(
			pointsLiability({
				outstandingPoints: 333,
				pointValueAmount: 123.45,
				expectedBreakageRate: 0.25,
			}),
		).toBe(30_831.64);
	});

	it("refuses inputs that are not what the columns hold (negative tests)", () => {
		const base = {
			outstandingPoints: 10,
			pointValueAmount: 500,
			expectedBreakageRate: 0.2,
		};
		expect(() =>
			pointsLiabilityCents({ ...base, outstandingPoints: 1.5 }),
		).toThrow(RangeError);
		expect(() =>
			pointsLiabilityCents({ ...base, outstandingPoints: Number.NaN }),
		).toThrow(RangeError);
		expect(() =>
			pointsLiabilityCents({ ...base, pointValueAmount: 0.001 }),
		).toThrow(RangeError);
		expect(() =>
			pointsLiabilityCents({ ...base, expectedBreakageRate: 0.0001 }),
		).toThrow(RangeError);
		expect(() =>
			pointsLiabilityCents({ ...base, expectedBreakageRate: Number.NaN }),
		).toThrow(RangeError);
		expect(() =>
			pointsLiabilityCents({
				outstandingPoints: 1_000_000_000,
				pointValueAmount: 1_000_000,
				expectedBreakageRate: 0,
			}),
		).toThrow(RangeError);
	});

	it("prints money and rates as the numeric columns do", () => {
		expect(formatCents(0)).toBe("0.00");
		expect(formatCents(5)).toBe("0.05");
		expect(formatCents(760_000)).toBe("7600.00");
		expect(formatCents(-2_000)).toBe("-20.00");
		expect(formatCents(-5)).toBe("-0.05");
		expect(formatThousandths(200)).toBe("0.200");
		expect(formatThousandths(63)).toBe("0.063");
		expect(formatThousandths(1_000)).toBe("1.000");
	});
});

describe("observedBreakageMilli: expired over redeemed plus expired (boundary values)", () => {
	it.each([
		{ expired: 30, spent: 120, milli: 250 },
		{ expired: 1, spent: 8, milli: 125 },
		{ expired: 1, spent: 3, milli: 333 },
		{ expired: 2, spent: 3, milli: 667 },
		{ expired: 1, spent: 16, milli: 63 },
		{ expired: 0, spent: 10, milli: 0 },
		{ expired: 5, spent: 5, milli: 1_000 },
		{ expired: 6, spent: 5, milli: 1_000 },
	])(
		"$expired of $spent is $milli thousandths",
		({ expired, spent, milli }) => {
			expect(observedBreakageMilli(expired, spent)).toBe(milli);
		},
	);

	it("needs something redeemed or expired", () => {
		expect(() => observedBreakageMilli(0, 0)).toThrow(RangeError);
		expect(() => observedBreakageMilli(1, -1)).toThrow(RangeError);
	});
});

describe("computeLiabilityRow: one night's row from a hand-made ledger", () => {
	it("counts confirmed points only: 12 + 7 of three members is 7,600 (the 65_loyalty_jobs hand case)", () => {
		const ledger = ledgerOf("a", "b", "c");
		const sold = at("2026-11-14T10:00");
		ledger.earn("a", { stamps: 1, points: 12 }, { soldAt: sold, at: sold + 1 });
		ledger.earn("b", { stamps: 1, points: 7 }, { soldAt: sold, at: sold + 2 });
		const waiting = ledger.earn(
			"c",
			{ stamps: 1, points: 10 },
			{ soldAt: sold, at: sold + 3, pending: true },
		);
		const asOf = at("2026-11-15T23:00");
		const before = rowAt(ledger, asOf, ["a", "b", "c"]);
		expect(before).toMatchObject({
			members: 3,
			outstandingPoints: 19,
			outstandingStamps: 2,
			liabilityAmount: "7600.00",
			expectedBreakageRate: "0.200",
			breakageSource: "configured",
			pointValueAmount: "500.00",
		});
		if (!waiting.ok) throw new Error("earn refused");
		ledger.confirm(waiting.entryId, at("2026-11-16T09:00"));
		expect(
			rowAt(ledger, at("2026-11-16T08:59"), ["a", "b", "c"]).outstandingPoints,
		).toBe(19);
		expect(
			rowAt(ledger, at("2026-11-16T09:00"), ["a", "b", "c"]).outstandingPoints,
		).toBe(29);
	});

	it("leaves a negative balance out instead of netting it against the others", () => {
		// Since ADR-046 a clawback stops at zero; a negative balance is one that
		// rows written before it left, so the ledger here is built with the old
		// uncapped clawback and the liability's greatest(0, ...) is the safety net.
		const ledger = ledgerWith({ uncappedClawbacks: true }, "a", "d");
		const sold = at("2026-11-10T10:00");
		ledger.earn("a", { stamps: 0, points: 12 }, { soldAt: sold, at: sold + 1 });
		const earn = ledger.earn(
			"d",
			{ stamps: 0, points: 60 },
			{ soldAt: sold, at: sold + 2 },
		);
		ledger.hold("d", { stamps: 0, points: 40 }, sold + 3);
		if (!earn.ok) throw new Error("earn refused");
		ledger.clawback(earn.entryId, sold + 4);
		expect(ledgerBalance(ledger.entries, "d").points).toBe(-40);
		const row = rowAt(ledger, at("2026-11-11T04:00"), ["a", "d"]);
		expect(row.outstandingPoints).toBe(12);
		expect(row.pointsClawedBack).toBe(60);
	});

	it("counts as clawed back only what a capped clawback took, the write-off not at all (ADR-046)", () => {
		const ledger = ledgerOf("a", "d");
		const sold = at("2026-11-10T10:00");
		ledger.earn("a", { stamps: 0, points: 12 }, { soldAt: sold, at: sold + 1 });
		const earn = ledger.earn(
			"d",
			{ stamps: 0, points: 60 },
			{ soldAt: sold, at: sold + 2 },
		);
		ledger.hold("d", { stamps: 0, points: 40 }, sold + 3);
		if (!earn.ok) throw new Error("earn refused");
		ledger.clawback(earn.entryId, sold + 4);
		expect(ledgerBalance(ledger.entries, "d").points).toBe(0);
		expect(ledger.entries.find((row) => row.kind === "clawback")?.reason).toBe(
			"invoice_voided; short by 40 points",
		);
		const row = rowAt(ledger, at("2026-11-11T04:00"), ["a", "d"]);
		expect(row.outstandingPoints).toBe(12);
		expect(row.pointsClawedBack).toBe(20);
	});

	it("nets a released hold out of the redeemed points and does not count it as issued", () => {
		const ledger = ledgerOf("e");
		const day = at("2026-11-10T09:00");
		ledger.earn("e", { stamps: 0, points: 100 }, { soldAt: day, at: day + 1 });
		const hold = ledger.hold("e", { stamps: 0, points: 40 }, day + 2);
		if (!hold.ok) throw new Error("hold refused");
		const held = rowAt(ledger, at("2026-11-11T04:00"), ["e"]);
		expect(held).toMatchObject({
			outstandingPoints: 60,
			pointsIssued: 100,
			pointsRedeemed: 40,
			deferredRevenueReleasedAmount: "20000.00",
		});
		ledger.release(hold.entryId, day + 4);
		expect(rowAt(ledger, at("2026-11-11T04:00"), ["e"])).toMatchObject({
			outstandingPoints: 100,
			pointsIssued: 100,
			pointsRedeemed: 0,
			deferredRevenueReleasedAmount: "0.00",
		});
	});

	it("counts members joined by the moment only", () => {
		const ledger = ledgerOf("a", "b");
		const joined = new Map([
			["a", at("2026-11-01T09:00")],
			["b", at("2026-11-12T09:00")],
		]);
		const input = {
			entries: ledger.entries,
			rules: RULES,
			programme: PROGRAMME,
			joinedAt: joined,
		};
		expect(
			computeLiabilityRow({ ...input, asOf: at("2026-11-11T23:00") }).members,
		).toBe(1);
		expect(
			computeLiabilityRow({ ...input, asOf: at("2026-11-12T09:00") }).members,
		).toBe(2);
	});

	// G-104 F2 (ADR-048): the flows of a row are those of the closed previous local day, from
	// its first millisecond to the first millisecond of the row's own day, whatever the run hour.
	describe("the flows cover the closed previous local day (boundary value analysis)", () => {
		const midnight = at("2026-11-10T00:00");
		const MS_DAY = 86_400_000;
		const ledger = ledgerOf("a");
		// 2026-11-08 23:59:59.999 (the day before the flow day)
		ledger.earn(
			"a",
			{ stamps: 0, points: 3 },
			{ soldAt: midnight - MS_DAY - 1_000, at: midnight - MS_DAY - 1 },
		);
		// the first and the last millisecond of the flow day 2026-11-09
		ledger.earn(
			"a",
			{ stamps: 0, points: 5 },
			{ soldAt: midnight - MS_DAY, at: midnight - MS_DAY },
		);
		ledger.earn(
			"a",
			{ stamps: 0, points: 7 },
			{ soldAt: midnight - 1_000, at: midnight - 1 },
		);
		// the first millisecond of the row's own day 2026-11-10
		ledger.earn(
			"a",
			{ stamps: 0, points: 9 },
			{ soldAt: midnight, at: midnight },
		);

		it.each([
			{ label: "the first millisecond of the row's day", asOf: midnight },
			{ label: "03:23, the production nightly", asOf: at("2026-11-10T03:23") },
			{ label: "23:59 the same day, a late run", asOf: at("2026-11-10T23:59") },
		])("is the same complete day $label: 5 + 7 = 12 points", ({ asOf }) => {
			expect(rowAt(ledger, asOf, ["a"]).pointsIssued).toBe(12);
		});

		it("starts the day after at the boundary: the 9 points of 2026-11-10 are the flow of 2026-11-11", () => {
			expect(rowAt(ledger, at("2026-11-11T00:00"), ["a"]).pointsIssued).toBe(9);
		});

		it("counts a run at the last millisecond of 2026-11-09 for 2026-11-08 only: the 5 points sold at 2026-11-09 00:00 are not in it", () => {
			expect(rowAt(ledger, midnight - 1, ["a"]).pointsIssued).toBe(3);
		});

		it("keeps the stock at the run's moment while the flows are those of the previous day", () => {
			const row = rowAt(ledger, at("2026-11-10T03:23"), ["a"]);
			expect(row.outstandingPoints).toBe(24);
			expect(row.pointsIssued).toBe(12);
		});

		it("covers the expiry and the clawback of the flow day too, so a row is one consistent day", () => {
			const day = ledgerOf("q");
			const sold = at("2026-11-08T10:00");
			const earn = day.earn(
				"q",
				{ stamps: 0, points: 20 },
				{ soldAt: sold, at: sold + 1 },
			);
			if (!earn.ok) throw new Error("earn refused");
			day.clawback(earn.entryId, at("2026-11-09T11:00"));
			expect(rowAt(day, at("2026-11-10T03:23"), ["q"]).pointsClawedBack).toBe(
				20,
			);
			expect(rowAt(day, at("2026-11-09T23:00"), ["q"]).pointsClawedBack).toBe(
				0,
			);
		});
	});
});

describe("boundary value analysis: when the observed breakage replaces the configured one", () => {
	it("uses the configured rate until six months to the millisecond, then 30 / (30 + 90)", () => {
		const members = ["a", "b"];
		const ledger = ledgerOf(...members);
		const old = at("2025-04-01T10:00");
		ledger.earn("a", { stamps: 0, points: 30 }, { soldAt: old, at: old + 1 });
		const later = at("2026-01-01T10:00");
		ledger.earn(
			"b",
			{ stamps: 0, points: 370 },
			{ soldAt: later, at: later + 1 },
		);
		// the programme's first expiry: 30 points on the run of 2026-04-02 04:00 local
		const firstExpiry = at("2026-04-02T04:00");
		expect(ledger.expire(firstExpiry).points).toBe(30);
		const maturity = addMonthsUtc(firstExpiry, 6);
		const hold = ledger.hold(
			"b",
			{ stamps: 0, points: 90 },
			at("2026-11-01T10:00"),
		);
		if (!hold.ok) throw new Error("hold refused");
		ledger.confirm(hold.entryId, at("2026-11-01T11:00"));
		expect(rowAt(ledger, maturity - 1, members)).toMatchObject({
			breakageSource: "configured",
			expectedBreakageRate: "0.200",
		});
		expect(rowAt(ledger, maturity, members)).toMatchObject({
			breakageSource: "observed",
			expectedBreakageRate: "1.000",
		});
		expect(rowAt(ledger, at("2026-11-15T23:00"), members)).toMatchObject({
			outstandingPoints: 280,
			breakageSource: "observed",
			expectedBreakageRate: "0.250",
			liabilityAmount: "105000.00",
		});
	});

	it("looks back 12 months: an expiry exactly 12 months old no longer counts, one a millisecond younger does", () => {
		const ledger = ledgerOf("a");
		const sold = at("2025-04-01T10:00");
		ledger.earn("a", { stamps: 0, points: 30 }, { soldAt: sold, at: sold + 1 });
		const expiredAt = at("2026-04-02T04:00");
		expect(ledger.expire(expiredAt).points).toBe(30);
		ledger.earn(
			"a",
			{ stamps: 0, points: 70 },
			{ soldAt: at("2026-06-01T10:00"), at: at("2026-06-01T10:00") + 1 },
		);
		const exactlyTwelveMonths = addMonthsUtc(expiredAt, 12);
		const noSpent = rowAt(ledger, exactlyTwelveMonths, ["a"]);
		expect(noSpent).toMatchObject({
			breakageSource: "configured",
			expectedBreakageRate: "0.200",
		});
		const inside = rowAt(ledger, exactlyTwelveMonths - 1, ["a"]);
		expect(inside).toMatchObject({
			breakageSource: "observed",
			expectedBreakageRate: "1.000",
		});
	});
});

describe("breakage by issue month and the month boundary of the expiry run", () => {
	it("reports expired points under the month of the run less the expiry period", () => {
		expect(expiryCohortMonth(at("2027-10-31T04:00"), RULES)).toBe("2026-10");
		expect(expiryCohortMonth(at("2027-11-01T04:00"), RULES)).toBe("2026-11");
		expect(expiryCohortMonth(at("2027-11-01T00:00"), RULES)).toBe("2026-11");
		expect(expiryCohortMonth(at("2027-10-31T23:59"), RULES)).toBe("2026-10");
	});

	// G-104 F1 (ADR-048): an expiry is reported under the month its credit was issued, found by
	// first in first out, not under the month of the run less the expiry period.
	it("reports a credit sold on the last day of a month after the nightly hour under its own month, although its expiry runs next month", () => {
		const ledger = ledgerOf("a", "b");
		const early = at("2026-10-30T15:00");
		const late = at("2026-10-31T15:00");
		ledger.earn(
			"a",
			{ stamps: 0, points: 10 },
			{ soldAt: early, at: early + 1 },
		);
		ledger.earn("b", { stamps: 0, points: 4 }, { soldAt: late, at: late + 1 });
		ledger.expire(at("2027-10-31T04:00"));
		ledger.expire(at("2027-11-01T04:00"));
		const row = rowAt(ledger, at("2027-11-01T05:00"), ["a", "b"]);
		expect(row.breakageByCohort).toEqual([
			{ month: "2026-10", issued: 14, expired: 14 },
		]);
	});

	describe("first in first out trace of an expiry (equivalence partitioning of the member's history)", () => {
		const first = at("2026-10-20T10:00");
		const second = at("2026-11-20T10:00");
		const run = at("2027-11-22T04:00");
		function twoCredits() {
			const ledger = ledgerOf("a");
			ledger.earn(
				"a",
				{ stamps: 0, points: 10 },
				{ soldAt: first, at: first + 1 },
			);
			ledger.earn(
				"a",
				{ stamps: 0, points: 10 },
				{ soldAt: second, at: second + 1 },
			);
			return ledger;
		}
		const cohorts = (ledger: LoyaltyLedger) =>
			rowAt(ledger, run + 3_600_000, ["a"]).breakageByCohort;

		it("charges a spent point to the oldest credit: 4 spent, 16 expired = 6 of October and 10 of November", () => {
			const ledger = twoCredits();
			const hold = ledger.hold(
				"a",
				{ stamps: 0, points: 4 },
				at("2027-01-05T10:00"),
			);
			if (!hold.ok) throw new Error("hold refused");
			ledger.confirm(hold.entryId, at("2027-01-05T11:00"));
			expect(ledger.expire(run).points).toBe(16);
			expect(cohorts(ledger)).toEqual([
				{ month: "2026-10", issued: 10, expired: 6 },
				{ month: "2026-11", issued: 10, expired: 10 },
			]);
		});

		it("leaves the oldest cohort whole when more than its points were spent: 14 spent, 6 expired, all of November", () => {
			const ledger = twoCredits();
			const hold = ledger.hold(
				"a",
				{ stamps: 0, points: 14 },
				at("2027-01-05T10:00"),
			);
			if (!hold.ok) throw new Error("hold refused");
			ledger.confirm(hold.entryId, at("2027-01-05T11:00"));
			expect(ledger.expire(run).points).toBe(6);
			expect(cohorts(ledger)).toEqual([
				{ month: "2026-10", issued: 10, expired: 0 },
				{ month: "2026-11", issued: 10, expired: 6 },
			]);
		});

		it("leaves nothing to a fully spent history: 20 spent, nothing expired", () => {
			const ledger = twoCredits();
			const hold = ledger.hold(
				"a",
				{ stamps: 0, points: 20 },
				at("2027-01-05T10:00"),
			);
			if (!hold.ok) throw new Error("hold refused");
			ledger.confirm(hold.entryId, at("2027-01-05T11:00"));
			expect(ledger.expire(run).points).toBe(0);
			expect(cohorts(ledger)).toEqual([
				{ month: "2026-10", issued: 10, expired: 0 },
				{ month: "2026-11", issued: 10, expired: 0 },
			]);
		});

		it("traces two runs one after the other: the first takes October, the second November", () => {
			const ledger = twoCredits();
			ledger.expire(at("2027-10-21T04:00"));
			ledger.expire(at("2027-11-21T04:00"));
			expect(
				rowAt(ledger, at("2027-11-21T05:00"), ["a"]).breakageByCohort,
			).toEqual([
				{ month: "2026-10", issued: 10, expired: 10 },
				{ month: "2026-11", issued: 10, expired: 10 },
			]);
		});

		it("skips a credit that was clawed back before the run", () => {
			const ledger = ledgerOf("a");
			const octoberEarn = ledger.earn(
				"a",
				{ stamps: 0, points: 10 },
				{ soldAt: first, at: first + 1 },
			);
			ledger.earn(
				"a",
				{ stamps: 0, points: 10 },
				{ soldAt: second, at: second + 1 },
			);
			if (!octoberEarn.ok) throw new Error("earn refused");
			ledger.clawback(octoberEarn.entryId, at("2026-12-01T10:00"));
			expect(ledger.expire(run).points).toBe(10);
			expect(cohorts(ledger)).toEqual([
				{ month: "2026-10", issued: 10, expired: 0 },
				{ month: "2026-11", issued: 10, expired: 10 },
			]);
		});

		it("totals the cohorts' expired points to the expired flow of the run", () => {
			const ledger = twoCredits();
			const hold = ledger.hold(
				"a",
				{ stamps: 0, points: 7 },
				at("2027-01-05T10:00"),
			);
			if (!hold.ok) throw new Error("hold refused");
			ledger.confirm(hold.entryId, at("2027-01-05T11:00"));
			const expired = ledger.expire(run).points;
			const total = cohorts(ledger).reduce((sum, c) => sum + c.expired, 0);
			expect(total).toBe(expired);
		});
	});

	describe("an expiry that cannot be traced to a credit falls back to the run month less the expiry period (negative and boundary cases)", () => {
		const entry = (
			over: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind">,
		): LedgerEntry => ({
			member: "a",
			stampDelta: 0,
			pointDelta: 0,
			pending: false,
			sourceId: null,
			reason: null,
			expiresAt: null,
			occurredAt: 0,
			...over,
		});

		it("reports an opening balance without an expiry date under the fallback month", () => {
			const entries = [
				entry({
					id: 1,
					kind: "adjust",
					pointDelta: 400,
					reason: "opening",
					occurredAt: at("2025-01-02T09:00"),
				}),
				entry({
					id: 2,
					kind: "expire",
					pointDelta: -30,
					reason: "expired",
					occurredAt: at("2026-04-01T00:00"),
				}),
			];
			expect([
				...expiredByIssueMonth(entries, RULES, at("2026-11-15T23:00")),
			]).toEqual([["2025-04", 30]]);
		});

		it("splits a row between the credits it can trace and the fallback when the credits shrank afterwards", () => {
			const entries = [
				entry({
					id: 1,
					kind: "earn",
					pointDelta: 4,
					expiresAt: at("2027-10-30T15:00"),
					occurredAt: at("2026-10-30T15:00"),
				}),
				entry({
					id: 2,
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: at("2027-11-01T04:00"),
				}),
			];
			expect([
				...expiredByIssueMonth(entries, RULES, at("2027-11-02T00:00")),
			]).toEqual([
				["2026-10", 4],
				["2026-11", 6],
			]);
		});

		it("ignores expiry rows without points and rows after the moment", () => {
			const entries = [
				entry({
					id: 1,
					kind: "expire",
					stampDelta: -2,
					occurredAt: at("2027-01-01T04:00"),
				}),
				entry({
					id: 2,
					kind: "expire",
					pointDelta: -5,
					occurredAt: at("2027-11-01T04:00"),
				}),
			];
			expect(
				expiredByIssueMonth(entries, RULES, at("2027-10-31T23:59")).size,
			).toBe(0);
		});

		// Review of G-104 (2026-11-23): each case below fails under one mutation of
		// expiredByIssueMonth that the tests above let through (the mutation is named).
		const run = at("2027-03-15T04:00");

		it("negative test: a clawback written after the expiry run does not shrink that run's trace (mutation: count every clawback)", () => {
			const entries = [
				entry({
					id: 1,
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-01-11T00:00"),
					occurredAt: at("2026-01-10T10:00"),
				}),
				entry({
					id: 2,
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-02-11T00:00"),
					occurredAt: at("2026-02-10T10:00"),
				}),
				entry({
					id: 3,
					member: "a",
					kind: "redeem",
					pointDelta: -10,
					occurredAt: at("2026-03-01T10:00"),
				}),
				entry({
					id: 4,
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
				entry({
					id: 5,
					kind: "clawback",
					pointDelta: -10,
					sourceId: 2,
					reason: "invoice_voided",
					occurredAt: run + 3_600_000,
				}),
			];
			expect([...expiredByIssueMonth(entries, RULES, run + 7_200_000)]).toEqual(
				[["2026-02", 10]],
			);
		});

		it("two members expiring in the same run are each traced to their own credits (mutation: line up every member's credits)", () => {
			const entries = [
				entry({
					id: 1,
					member: "a",
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-01-11T00:00"),
					occurredAt: at("2026-01-10T10:00"),
				}),
				entry({
					id: 2,
					member: "b",
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-03-11T00:00"),
					occurredAt: at("2026-03-10T10:00"),
				}),
				entry({
					id: 3,
					member: "a",
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
				entry({
					id: 4,
					member: "b",
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
			];
			expect([...expiredByIssueMonth(entries, RULES, run)]).toEqual([
				["2026-01", 10],
				["2026-03", 10],
			]);
		});

		it("lines credits up by expiry, not by issue: an adjust credit ending before an older earn is consumed first (mutation: order by issue)", () => {
			const entries = [
				entry({
					id: 1,
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-01-11T00:00"),
					occurredAt: at("2026-01-10T10:00"),
				}),
				entry({
					id: 2,
					kind: "adjust",
					pointDelta: 10,
					reason: "goodwill",
					expiresAt: at("2026-12-02T00:00"),
					occurredAt: at("2026-02-01T10:00"),
				}),
				entry({
					id: 3,
					kind: "redeem",
					pointDelta: -10,
					occurredAt: at("2026-03-01T10:00"),
				}),
				entry({
					id: 4,
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
			];
			expect([...expiredByIssueMonth(entries, RULES, run)]).toEqual([
				["2026-01", 10],
			]);
		});

		it.each([
			{ label: "at the run", ends: run, traced: true },
			{ label: "one millisecond after the run", ends: run + 1, traced: false },
		])(
			"boundary values: a credit ending $label is traced: $traced (mutation: expiresAt < the run)",
			({ ends, traced }) => {
				const entries = [
					entry({
						id: 1,
						kind: "adjust",
						pointDelta: 10,
						reason: "goodwill",
						expiresAt: ends,
						occurredAt: at("2026-01-10T10:00"),
					}),
					entry({
						id: 2,
						kind: "expire",
						pointDelta: -10,
						reason: "expired",
						occurredAt: run,
					}),
				];
				expect([...expiredByIssueMonth(entries, RULES, run)]).toEqual(
					traced ? [["2026-01", 10]] : [["2026-03", 10]],
				);
			},
		);

		it("negative test: a pending earn past its sale's expiry is not lined up, it never expires (ADR-046; mutation: line up unconfirmed earns)", () => {
			const entries = [
				entry({
					id: 1,
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-01-11T00:00"),
					occurredAt: at("2026-01-10T10:00"),
				}),
				entry({
					id: 2,
					kind: "earn",
					pointDelta: 10,
					pending: true,
					expiresAt: at("2027-02-11T00:00"),
					occurredAt: at("2026-02-10T10:00"),
				}),
				entry({
					id: 3,
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
			];
			expect([...expiredByIssueMonth(entries, RULES, run)]).toEqual([
				["2026-01", 10],
			]);
		});

		it("a confirmed pending earn is lined up by its confirm row's expiry, not the earn's (ADR-046; mutation: read the earn's expiry)", () => {
			const entries = [
				entry({
					id: 1,
					kind: "earn",
					pointDelta: 10,
					expiresAt: at("2027-01-11T00:00"),
					occurredAt: at("2026-01-10T10:00"),
				}),
				entry({
					id: 2,
					kind: "earn",
					pointDelta: 10,
					pending: true,
					expiresAt: at("2027-02-11T00:00"),
					occurredAt: at("2026-02-10T10:00"),
				}),
				entry({
					id: 3,
					kind: "confirm",
					sourceId: 2,
					expiresAt: at("2027-06-02T00:00"),
					occurredAt: at("2026-06-01T10:00"),
				}),
				entry({
					id: 4,
					kind: "expire",
					pointDelta: -10,
					reason: "expired",
					occurredAt: run,
				}),
			];
			expect([...expiredByIssueMonth(entries, RULES, run)]).toEqual([
				["2026-01", 10],
			]);
		});
	});

	it("lists a month once with its issued and expired points, in month order", () => {
		const ledger = ledgerOf("a");
		const t1 = at("2026-04-20T10:00");
		const t2 = at("2026-10-20T10:00");
		ledger.earn("a", { stamps: 0, points: 24 }, { soldAt: t1, at: t1 + 1 });
		ledger.earn("a", { stamps: 0, points: 8 }, { soldAt: t2, at: t2 + 1 });
		ledger.expire(at("2027-04-21T04:00"));
		expect(
			rowAt(ledger, at("2027-04-21T05:00"), ["a"]).breakageByCohort,
		).toEqual([
			{ month: "2026-04", issued: 24, expired: 24 },
			{ month: "2026-10", issued: 8, expired: 0 },
		]);
	});
});

describe("the 30-day liability replay (CI integration against supabase/tests/236_loyalty_liability_replay.sql)", () => {
	const fixture = JSON.parse(
		readFileSync(fixturePath, "utf8"),
	) as LiabilityReplayFixture;
	const windowDates = Array.from(
		{ length: LIABILITY_WINDOW_DAYS },
		(_, index) =>
			new Date(
				Date.parse(`${LIABILITY_WINDOW_FIRST}T00:00:00Z`) + index * 86_400_000,
			)
				.toISOString()
				.slice(0, 10),
	);

	it("is the generator's scenario", () => {
		expect(fixture).toEqual(buildLiabilityReplay());
		expect(fixture.joinedAt).toBe(LIABILITY_JOINED_AT);
		expect(fixture.phones).toHaveLength(LIABILITY_MEMBER_COUNT);
		expect(fixture.phones.every((phone) => /^09000008\d{2}$/.test(phone))).toBe(
			true,
		);
	});

	it("holds the independent calculation: the operations run through the model give every stored row", () => {
		expect(runLiabilityReplay(fixture.ops)).toEqual({
			rows: fixture.rows,
			closing: fixture.closing,
		});
	});

	it("has one nightly row for each of 30 consecutive local days, after two earlier runs", () => {
		expect(fixture.rows).toHaveLength(LIABILITY_WINDOW_DAYS + 2);
		expect(fixture.rows.slice(2).map((row) => row.asOfDate)).toEqual(
			windowDates,
		);
		expect(fixture.rows.slice(0, 2).map((row) => row.asOfDate)).toEqual([
			"2027-04-21",
			"2027-05-16",
		]);
		expect(fixture.closing.map((row) => row.asOfDate)).toEqual(
			windowDates.slice(0, -1),
		);
	});

	it("crosses one expiry-month boundary: the October 2026 cohort ends and the November one starts to expire", () => {
		const byDate = new Map(fixture.rows.map((row) => [row.asOfDate, row]));
		const expiredOf = (date: string, month: string) =>
			byDate
				.get(date)
				?.breakageByCohort.find((cohort) => cohort.month === month)?.expired ??
			0;
		expect(expiredOf("2027-10-31", "2026-10")).toBeGreaterThan(0);
		expect(expiredOf("2027-10-31", "2026-11")).toBe(0);
		// G-104 F1: the run of 2027-11-01 04:00 expires credits sold on 31 October 2026 after 04:00,
		// so it grows the October cohort and does not touch November's
		expect(expiredOf("2027-11-01", "2026-10")).toBeGreaterThan(
			expiredOf("2027-10-31", "2026-10"),
		);
		expect(expiredOf("2027-11-01", "2026-11")).toBe(0);
		// the November cohort starts to expire with the first credit sold on 1 November
		// whose year is up, a later run of the window
		const firstNovember = [...byDate.keys()]
			.sort()
			.find((date) => expiredOf(date, "2026-11") > 0);
		expect(firstNovember).toBeDefined();
		expect((firstNovember as string) > "2027-11-01").toBe(true);
		// the October cohort is still not fully expired: part of it was spent or is still waiting
		const october = byDate
			.get("2027-11-15")
			?.breakageByCohort.find((cohort) => cohort.month === "2026-10");
		expect(october?.expired).toBeLessThan(october?.issued ?? 0);
	});

	it("switches from the configured to the observed breakage exactly six months after the first expiry", () => {
		const sources = fixture.rows
			.slice(2)
			.map((row) => `${row.asOfDate}:${row.breakageSource}`);
		expect(sources.slice(0, 4)).toEqual([
			"2027-10-17:configured",
			"2027-10-18:configured",
			"2027-10-19:configured",
			"2027-10-20:configured",
		]);
		expect(sources[4]).toBe("2027-10-21:observed");
		expect(
			fixture.rows.slice(6).every((row) => row.breakageSource === "observed"),
		).toBe(true);
		expect(
			fixture.rows
				.slice(0, 6)
				.every((row) => row.expectedBreakageRate === "0.200"),
		).toBe(true);
	});

	it("exercises every flow, and the member whose voided earn was spent ends at zero with a write-off (ADR-046)", () => {
		const all = [...fixture.rows, ...fixture.closing];
		expect(all.some((row) => row.pointsIssued > 0)).toBe(true);
		expect(all.some((row) => row.pointsRedeemed > 0)).toBe(true);
		expect(all.some((row) => row.pointsRedeemed < 0)).toBe(true);
		expect(all.some((row) => row.pointsExpired > 0)).toBe(true);
		expect(all.some((row) => row.pointsClawedBack > 0)).toBe(true);
		const runner = new LiabilityReplayRunner();
		for (const op of fixture.ops) runner.apply(op);
		const balances = Array.from(
			{ length: LIABILITY_MEMBER_COUNT },
			(_, index) =>
				ledgerBalance(runner.ledger.entries, memberId(index)).points,
		);
		expect(balances.filter((points) => points < 0)).toEqual([]);
		// Member 11: 45 points earned, a cake of 40 confirmed, the last earn of 15
		// voided: the clawback takes the 5 left and writes off 10.
		expect(balances[11]).toBe(0);
		const writeOff = runner.ledger.entries.find(
			(row) => row.kind === "clawback" && row.member === memberId(11),
		);
		expect(writeOff).toMatchObject({
			pointDelta: -5,
			reason: "invoice_voided; short by 10 points",
		});
		const kinds = new Set(fixture.ops.map((op) => op.kind));
		for (const kind of [
			"earn",
			"confirm",
			"void",
			"hold",
			"confirm_hold",
			"release",
			"adjust",
			"nightly",
			"liability",
		]) {
			expect(kinds.has(kind as never)).toBe(true);
		}
	});

	it("derives each stored liability from the row's own points, rate and value, exactly", () => {
		for (const row of [...fixture.rows, ...fixture.closing]) {
			const expected = formatCents(
				pointsLiabilityCents({
					outstandingPoints: row.outstandingPoints,
					pointValueAmount: LIABILITY_PROGRAMME.pointValueAmount,
					expectedBreakageRate: Number(row.expectedBreakageRate),
				}),
			);
			expect(row.liabilityAmount).toBe(expected);
			expect(row.members).toBe(LIABILITY_MEMBER_COUNT);
		}
	});

	it("is embedded verbatim in the pgTAP replay", () => {
		expect(existsSync(sqlTestPath)).toBe(true);
		const sql = readFileSync(sqlTestPath, "utf8");
		const match = /\$liability\$(\{.*\})\$liability\$/s.exec(sql);
		expect(match?.[1]).toBeDefined();
		expect(JSON.parse(match?.[1] ?? "null")).toEqual(fixture);
	});

	it("puts no phone in any computed row (security)", () => {
		const text = JSON.stringify([fixture.rows, fixture.closing]);
		expect(text).not.toMatch(/(?:\+?84|\b0)[1-9]\d{8,9}\b/);
		for (const phone of fixture.phones) {
			expect(text).not.toContain(phone);
		}
	});
});
