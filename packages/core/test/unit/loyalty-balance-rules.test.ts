// The balance rules of ADR-046 (balances never go negative) and ADR-047 (a
// credit is valid through the end of its anniversary day and spendable until
// that instant) in the @fnb/core ledger model, which mirrors
// app.loyalty_apply_adjustment, app.loyalty_write_clawback, app.loyalty_confirm,
// app.loyalty_expire, app.loyalty_credit_expires_at and app.loyalty_balance.
// ISTQB techniques per block: boundary value analysis (balance - 1, balance,
// balance + 1; the expiry to the millisecond, month ends, 29 February, 31 August
// plus six months; the 200-character reason), decision tables (what a clawback
// takes), state transition testing (pending -> confirmed -> clawed back, expired
// -> clawed back), equivalence partitioning (the shapes of a write-off, the hours
// of a sale), negative tests (a refusal writes nothing) and security (counts
// only, never a phone; a date, never a time).
import { describe, expect, it } from "vitest";
import {
	addMonthsToIsoDate,
	addMonthsUtc,
	clawbackReason,
	creditExpiresAt,
	expiringPoints,
	type LedgerRules,
	LoyaltyLedger,
	localIsoDate,
	validThrough,
} from "../../src/index.js";

const RULES: LedgerRules = {
	stampValidityMonths: 6,
	pointsExpiryMonths: 12,
	timezone: "Asia/Ho_Chi_Minh",
};
const at = (local: string) => Date.parse(`${local}:00+07:00`);
const SOLD = at("2026-10-01T10:00");
const PHONE = /(?:\+?84|\b0)[1-9]\d{8,9}\b/;

function ledgerWithMember(options = {}): LoyaltyLedger {
	const ledger = new LoyaltyLedger(RULES, options);
	ledger.join("m1");
	return ledger;
}

function entryId(result: { ok: boolean; entryId?: number }): number {
	if (!result.ok || result.entryId === undefined) {
		throw new Error("expected an accepted operation");
	}
	return result.entryId;
}

function shortText(stamps: number, points: number): string {
	const parts = [
		stamps === 1 ? "1 stamp" : stamps > 1 ? `${stamps} stamps` : null,
		points === 1 ? "1 point" : points > 1 ? `${points} points` : null,
	].filter((part) => part !== null);
	return parts.length === 0
		? "invoice_voided"
		: `invoice_voided; short by ${parts.join(" and ")}`;
}

describe("ADR-046 (1): the floor of an adjustment (boundary value analysis at balance - 1, balance, balance + 1)", () => {
	it.each([
		{ label: "balance - 1", take: 4, ok: true, left: 1 },
		{ label: "balance", take: 5, ok: true, left: 0 },
		{ label: "balance + 1", take: 6, ok: false, left: 5 },
	])(
		"taking $take of 5 points ($label) is accepted: $ok",
		({ take, ok, left }) => {
			const ledger = ledgerWithMember();
			ledger.earn("m1", { stamps: 0, points: 5 }, { soldAt: SOLD, at: SOLD });
			const rows = ledger.entries.length;
			const result = ledger.adjust(
				"m1",
				{ stamps: 0, points: -take },
				SOLD + 1,
				"correction",
			);
			expect(result.ok).toBe(ok);
			if (!result.ok) {
				expect(result.refusal).toBe("would_go_negative");
				expect(ledger.entries).toHaveLength(rows);
			}
			expect(ledger.balance("m1").points).toBe(left);
		},
	);

	it.each([
		{ take: 1, ok: true, left: 1 },
		{ take: 2, ok: true, left: 0 },
		{ take: 3, ok: false, left: 2 },
	])(
		"taking $take of 2 stamps is accepted: $ok, and the stamps rows follow",
		({ take, ok, left }) => {
			const ledger = ledgerWithMember();
			ledger.earn("m1", { stamps: 2, points: 0 }, { soldAt: SOLD, at: SOLD });
			expect(
				ledger.adjust("m1", { stamps: -take, points: 0 }, SOLD + 1, "fix").ok,
			).toBe(ok);
			expect(ledger.balance("m1").stamps).toBe(left);
			expect(ledger.spendableLots("m1", SOLD + 2)).toHaveLength(left);
		},
	);

	it("checks each kind on its own: crediting stamps does not let a debit of points go below zero", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 0, points: 3 }, { soldAt: SOLD, at: SOLD });
		expect(
			ledger.adjust("m1", { stamps: 2, points: -4 }, SOLD + 1, "swap"),
		).toEqual({ ok: false, refusal: "would_go_negative" });
		expect(
			ledger.adjust("m1", { stamps: 2, points: -3 }, SOLD + 1, "swap").ok,
		).toBe(true);
		expect(ledger.balance("m1")).toMatchObject({ stamps: 2, points: 0 });
	});

	it("negative test: a pending earn is not spendable, so it does not count toward the floor", () => {
		const ledger = ledgerWithMember();
		ledger.earn(
			"m1",
			{ stamps: 1, points: 9 },
			{ soldAt: SOLD, at: SOLD, pending: true },
		);
		expect(
			ledger.adjust("m1", { stamps: -1, points: 0 }, SOLD + 1, "fix"),
		).toEqual({ ok: false, refusal: "would_go_negative" });
		expect(
			ledger.adjust("m1", { stamps: 0, points: -1 }, SOLD + 1, "fix"),
		).toEqual({ ok: false, refusal: "would_go_negative" });
		expect(ledger.entries).toHaveLength(1);
	});

	it("a positive part is never refused, even on a balance that older rows left below zero", () => {
		const ledger = ledgerWithMember({ uncappedClawbacks: true });
		const earn = entryId(
			ledger.earn("m1", { stamps: 0, points: 10 }, { soldAt: SOLD, at: SOLD }),
		);
		ledger.hold("m1", { stamps: 0, points: 10 }, SOLD + 1);
		ledger.clawback(earn, SOLD + 2);
		expect(ledger.balance("m1").points).toBe(-10);
		expect(
			ledger.adjust("m1", { stamps: 0, points: 4 }, SOLD + 3, "goodwill").ok,
		).toBe(true);
		expect(ledger.balance("m1").points).toBe(-6);
		expect(
			ledger.adjust("m1", { stamps: 0, points: -1 }, SOLD + 4, "fix"),
		).toEqual({ ok: false, refusal: "would_go_negative" });
	});

	it("without the floor (the rule before ADR-046) the same debit takes the balance below zero", () => {
		const ledger = ledgerWithMember({ allowNegativeAdjustments: true });
		ledger.earn("m1", { stamps: 0, points: 5 }, { soldAt: SOLD, at: SOLD });
		ledger.adjust("m1", { stamps: 0, points: -6 }, SOLD + 1, "correction");
		expect(ledger.balance("m1").points).toBe(-1);
	});
});

describe("ADR-046 (2): decision table of what a clawback takes back", () => {
	// Conditions: the earn is still pending; how much of it the member spent; it
	// already expired. Actions: stamps and points taken, the write-off, the balance.
	it.each([
		{
			rule: "R1 pending: taken whole from the pending balance",
			pending: true,
			spend: 0,
			expireFirst: false,
			taken: [1, 6],
			short: [0, 0],
		},
		{
			rule: "R2 confirmed, all of it left: taken whole",
			pending: false,
			spend: 0,
			expireFirst: false,
			taken: [1, 6],
			short: [0, 0],
		},
		{
			rule: "R3 confirmed, part of it spent: what is left, the rest written off",
			pending: false,
			spend: 4,
			expireFirst: false,
			taken: [1, 2],
			short: [0, 4],
		},
		{
			rule: "R4 confirmed, all of it spent: nothing of the points, all written off",
			pending: false,
			spend: 6,
			expireFirst: false,
			taken: [1, 0],
			short: [0, 6],
		},
		{
			rule: "R5 confirmed and expired: nothing of it, all written off",
			pending: false,
			spend: 0,
			expireFirst: true,
			taken: [0, 0],
			short: [1, 6],
		},
	])("$rule", ({ pending, spend, expireFirst, taken, short }) => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 6 },
				{ soldAt: SOLD, at: SOLD, pending },
			),
		);
		let now = SOLD + 1;
		if (spend > 0) {
			entryId(ledger.hold("m1", { stamps: 0, points: spend }, now));
			now += 1;
		}
		if (expireFirst) {
			now = addMonthsUtc(SOLD, 13);
			ledger.expire(now);
		}
		const claw = ledger.entry(entryId(ledger.clawback(earn, now + 1)));
		expect([0 - (claw?.stampDelta ?? 0), 0 - (claw?.pointDelta ?? 0)]).toEqual(
			taken,
		);
		expect(claw?.reason).toBe(shortText(short[0] ?? 0, short[1] ?? 0));
		expect(ledger.balance("m1")).toEqual({
			stamps: 0,
			points: 0,
			pendingStamps: 0,
			pendingPoints: 0,
		});
	});

	it.each([
		{ label: "earn - 1", other: 5, taken: 5, short: 1 },
		{ label: "earn", other: 6, taken: 6, short: 0 },
		{ label: "earn + 1", other: 7, taken: 6, short: 0 },
	])(
		"boundary values: after spending the earn's own points the member holds $other ($label): $taken taken",
		({ other, taken, short }) => {
			const ledger = ledgerWithMember();
			const earn = entryId(
				ledger.earn("m1", { stamps: 0, points: 6 }, { soldAt: SOLD, at: SOLD }),
			);
			ledger.hold("m1", { stamps: 0, points: 6 }, SOLD + 1);
			ledger.adjust("m1", { stamps: 0, points: other }, SOLD + 2, "credit");
			const claw = ledger.entry(entryId(ledger.clawback(earn, SOLD + 3)));
			expect(0 - (claw?.pointDelta ?? 0)).toBe(taken);
			expect(claw?.reason).toBe(shortText(0, short));
			expect(ledger.balance("m1").points).toBe(other - taken);
		},
	);

	it("takes the earn's own stamps first, then the member's oldest spendable ones", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 0 }, { soldAt: SOLD, at: SOLD });
		const voided = entryId(
			ledger.earn(
				"m1",
				{ stamps: 2, points: 0 },
				{ soldAt: SOLD + 10, at: SOLD + 10 },
			),
		);
		ledger.earn(
			"m1",
			{ stamps: 1, points: 0 },
			{ soldAt: SOLD + 20, at: SOLD + 20 },
		);
		// the hold takes the two oldest stamps, the first earn's and one of the voided earn's
		ledger.hold("m1", { stamps: 2, points: 0 }, SOLD + 30);
		const claw = ledger.entry(entryId(ledger.clawback(voided, SOLD + 40)));
		expect(claw?.stampDelta).toBe(-2);
		expect(ledger.balance("m1").stamps).toBe(0);
		expect(ledger.spendableLots("m1", SOLD + 41)).toHaveLength(0);
		expect(ledger.activeStampLots("m1")).toBe(0);
	});

	it("negative test: a second clawback of the same earn is refused and writes nothing", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: SOLD, at: SOLD }),
		);
		ledger.hold("m1", { stamps: 1, points: 6 }, SOLD + 1);
		ledger.clawback(earn, SOLD + 2);
		const rows = ledger.entries.length;
		expect(ledger.clawback(earn, SOLD + 3)).toEqual({
			ok: false,
			refusal: "already_reversed",
		});
		expect(ledger.entries).toHaveLength(rows);
	});
});

describe("ADR-046 (3): state transitions of an earn (pending -> confirmed -> clawed back; expired -> clawed back)", () => {
	it("a pending earn never expires while pending; its clock starts at its confirmation", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 6 },
				{ soldAt: SOLD, at: SOLD, pending: true },
			),
		);
		const late = addMonthsUtc(SOLD, 13);
		expect(ledger.expire(late)).toEqual({
			memberships: 0,
			stamps: 0,
			points: 0,
		});
		expect(expiringPoints(ledger.entries, "m1", late)).toBe(0);
		expect(ledger.balance("m1")).toEqual({
			stamps: 0,
			points: 0,
			pendingStamps: 1,
			pendingPoints: 6,
		});
		const confirmedAt = late + 1_000;
		const confirm = ledger.entry(entryId(ledger.confirm(earn, confirmedAt)));
		const pointEnd = confirm?.expiresAt ?? 0;
		const stampEnd = ledger.spendableLots("m1", confirmedAt)[0]?.expiresAt ?? 0;
		expect(pointEnd).toBeGreaterThan(
			addMonthsUtc(confirmedAt, 12) - 86_400_000,
		);
		expect(stampEnd).toBeGreaterThan(addMonthsUtc(confirmedAt, 6) - 86_400_000);
		expect(ledger.expire(stampEnd - 1).stamps).toBe(0);
		expect(ledger.expire(stampEnd).stamps).toBe(1);
		expect(expiringPoints(ledger.entries, "m1", pointEnd - 1)).toBe(0);
		expect(expiringPoints(ledger.entries, "m1", pointEnd)).toBe(6);
	});

	it("pending -> confirmed -> clawed back: taken whole while the member still has it", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 6 },
				{ soldAt: SOLD, at: SOLD, pending: true },
			),
		);
		ledger.confirm(earn, SOLD + 1);
		const claw = ledger.entry(entryId(ledger.clawback(earn, SOLD + 2)));
		expect(claw).toMatchObject({
			stampDelta: -1,
			pointDelta: -6,
			reason: "invoice_voided",
		});
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 0 });
	});

	it("pending -> clawed back: the pending line goes, the spendable balance is untouched", () => {
		const ledger = ledgerWithMember();
		ledger.adjust("m1", { stamps: 0, points: 3 }, SOLD, "credit");
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 6 },
				{ soldAt: SOLD, at: SOLD + 1, pending: true },
			),
		);
		ledger.clawback(earn, SOLD + 2);
		expect(ledger.balance("m1")).toEqual({
			stamps: 0,
			points: 3,
			pendingStamps: 0,
			pendingPoints: 0,
		});
		expect(ledger.confirm(earn, SOLD + 3)).toEqual({
			ok: false,
			refusal: "reversed",
		});
	});

	it("expired -> clawed back: takes nothing, the other credits stay and the balance stays at or above zero", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: SOLD, at: SOLD }),
		);
		ledger.adjust(
			"m1",
			{ stamps: 0, points: 10 },
			addMonthsUtc(SOLD, 11),
			"credit",
		);
		const run = addMonthsUtc(SOLD, 13);
		expect(ledger.expire(run)).toMatchObject({ stamps: 1, points: 6 });
		const claw = ledger.entry(entryId(ledger.clawback(earn, run + 1)));
		expect(claw).toMatchObject({
			stampDelta: 0,
			pointDelta: 0,
			reason: "invoice_voided; short by 1 stamp and 6 points",
		});
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 10 });
	});
});

describe("clawbackReason: the write-off written on the row (equivalence partitions, the 200-character boundary)", () => {
	it.each([
		{ short: { stamps: 0, points: 0 }, text: "invoice_voided" },
		{
			short: { stamps: 1, points: 0 },
			text: "invoice_voided; short by 1 stamp",
		},
		{
			short: { stamps: 2, points: 0 },
			text: "invoice_voided; short by 2 stamps",
		},
		{
			short: { stamps: 0, points: 1 },
			text: "invoice_voided; short by 1 point",
		},
		{
			short: { stamps: 3, points: 40 },
			text: "invoice_voided; short by 3 stamps and 40 points",
		},
	])("$text", ({ short, text }) => {
		expect(clawbackReason("invoice_voided", short)).toBe(text);
	});

	it.each([
		{ length: 180, written: 199 },
		{ length: 181, written: 200 },
		{ length: 182, written: 200 },
		{ length: 200, written: 200 },
	])(
		"a reason of $length characters gives $written: the whole stays within 200",
		({ length, written }) => {
			const text = clawbackReason("r".repeat(length), { stamps: 0, points: 5 });
			expect(text).toHaveLength(written);
			expect(text.endsWith("; short by 5 points")).toBe(true);
		},
	);

	it("security: carries counts only, never a phone or a name", () => {
		const written = clawbackReason("bill_disputed", {
			stamps: 9,
			points: 99_999,
		});
		expect(written).toBe("bill_disputed; short by 9 stamps and 99999 points");
		expect(written).not.toMatch(PHONE);
	});
});

describe("ADR-047: creditExpiresAt, the end of the anniversary day (boundary value analysis, equivalence partitioning of the sale's hour)", () => {
	const TZ = RULES.timezone;
	it.each([
		{
			sold: "2026-05-19T02:00",
			months: 6,
			ends: "2026-11-20T00:00",
			through: "2026-11-19",
		},
		{
			sold: "2026-05-19T09:00",
			months: 6,
			ends: "2026-11-20T00:00",
			through: "2026-11-19",
		},
		{
			sold: "2026-05-19T23:30",
			months: 6,
			ends: "2026-11-20T00:00",
			through: "2026-11-19",
		},
		{
			sold: "2026-05-20T00:30",
			months: 6,
			ends: "2026-11-21T00:00",
			through: "2026-11-20",
		},
		{
			sold: "2026-11-19T00:00",
			months: 12,
			ends: "2027-11-20T00:00",
			through: "2027-11-19",
		},
		{
			sold: "2026-08-31T12:00",
			months: 6,
			ends: "2027-03-01T00:00",
			through: "2027-02-28",
		},
		{
			sold: "2027-08-31T12:00",
			months: 6,
			ends: "2028-03-01T00:00",
			through: "2028-02-29",
		},
		{
			sold: "2028-02-29T12:00",
			months: 12,
			ends: "2029-03-01T00:00",
			through: "2029-02-28",
		},
		{
			sold: "2026-10-31T23:45",
			months: 12,
			ends: "2027-11-01T00:00",
			through: "2027-10-31",
		},
		{
			sold: "2026-12-31T23:59",
			months: 1,
			ends: "2027-02-01T00:00",
			through: "2027-01-31",
		},
		{
			sold: "2027-01-31T08:00",
			months: 1,
			ends: "2027-03-01T00:00",
			through: "2027-02-28",
		},
	])(
		"a credit of $sold plus $months months is valid through $through and ends at $ends",
		({ sold, months, ends, through }) => {
			const expiresAt = creditExpiresAt(at(sold), months, TZ);
			expect(expiresAt).toBe(at(ends));
			expect(validThrough(expiresAt, TZ)).toBe(through);
			expect(localIsoDate(expiresAt - 1, TZ)).toBe(through);
			expect(localIsoDate(expiresAt, TZ) > through).toBe(true);
		},
	);

	it("three sales of the same day, at 02:00, 09:00 and 23:30, expire together", () => {
		const ends = ["02:00", "09:00", "23:30"].map((time) =>
			creditExpiresAt(at(`2026-05-19T${time}`), 12, TZ),
		);
		expect(new Set(ends).size).toBe(1);
	});

	it("never ends earlier than the moment of the sale plus the months, and at most a day later", () => {
		for (const time of ["00:00", "00:30", "06:59", "07:00", "12:00", "23:59"]) {
			const sold = at(`2026-03-15T${time}`);
			const end = creditExpiresAt(sold, 6, TZ);
			expect(end).toBeGreaterThan(addMonthsUtc(sold, 6));
			expect(end - addMonthsUtc(sold, 6)).toBeLessThanOrEqual(86_400_000);
		}
	});

	it.each([
		{ from: "2026-08-31", months: 6, to: "2027-02-28" },
		{ from: "2027-08-31", months: 6, to: "2028-02-29" },
		{ from: "2028-02-29", months: 12, to: "2029-02-28" },
		{ from: "2028-02-29", months: 48, to: "2032-02-29" },
		{ from: "2027-03-31", months: -1, to: "2027-02-28" },
		{ from: "2026-12-15", months: 1, to: "2027-01-15" },
	])(
		"addMonthsToIsoDate($from, $months) is $to, as PostgreSQL adds months to a date",
		({ from, months, to }) => {
			expect(addMonthsToIsoDate(from, months)).toBe(to);
		},
	);

	it("security: the wallet's date is a date, never a time", () => {
		expect(
			validThrough(creditExpiresAt(at("2026-11-19T14:23"), 12, TZ), TZ),
		).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("ADR-047: a credit is spendable while the moment is before its expires_at", () => {
	const sold = at("2026-05-19T09:00");
	const midnight = at("2026-11-20T00:00");

	it("boundary values: one millisecond before the midnight it is spendable, at the midnight it is not, though no expire row exists yet", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: sold, at: sold });
		expect(ledger.spendableAt("m1", midnight - 1).stamps).toBe(1);
		expect(ledger.spendableLots("m1", midnight - 1)).toHaveLength(1);
		expect(ledger.spendableAt("m1", midnight).stamps).toBe(0);
		expect(ledger.spendableLots("m1", midnight)).toHaveLength(0);
		expect(ledger.balance("m1").stamps).toBe(1);
		expect(ledger.entries.some((row) => row.kind === "expire")).toBe(false);
	});

	it("the midnight-to-nightly-run window: the run at 04:00 only writes down what had already ended", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: sold, at: sold });
		const run = at("2026-11-20T04:00");
		expect(ledger.spendableAt("m1", run)).toMatchObject({
			stamps: 0,
			points: 6,
		});
		expect(ledger.expire(run)).toEqual({
			memberships: 1,
			stamps: 1,
			points: 0,
		});
		expect(ledger.spendableAt("m1", run)).toMatchObject({
			stamps: 0,
			points: 6,
		});
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 6 });
	});

	it("negative test: a hold in the window is refused for the ended stamp and writes nothing", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: sold, at: sold });
		const rows = ledger.entries.length;
		expect(
			ledger.hold("m1", { stamps: 1, points: 0 }, midnight + 60_000),
		).toEqual({
			ok: false,
			refusal: "insufficient_stamps",
		});
		expect(ledger.entries).toHaveLength(rows);
	});

	it("a hold in the window spends the credit that is still valid, never the one that ended: the ended points get their expire row first", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 0, points: 10 }, { soldAt: sold, at: sold });
		const later = at("2026-06-10T09:00");
		ledger.earn("m1", { stamps: 0, points: 10 }, { soldAt: later, at: later });
		const window = at("2027-05-20T01:00");
		expect(ledger.spendableAt("m1", window).points).toBe(10);
		expect(ledger.hold("m1", { stamps: 0, points: 11 }, window)).toEqual({
			ok: false,
			refusal: "insufficient_points",
		});
		expect(ledger.hold("m1", { stamps: 0, points: 10 }, window).ok).toBe(true);
		const kinds = ledger.entries
			.slice(-2)
			.map((row) => `${row.kind}:${row.pointDelta}`);
		expect(kinds).toEqual(["expire:-10", "redeem:-10"]);
		expect(ledger.spendableAt("m1", window).points).toBe(0);
		// the second credit was spent: nothing is left to expire at its own end
		expect(ledger.expire(at("2027-06-11T04:00"))).toMatchObject({ points: 0 });
		expect(ledger.balance("m1").points).toBe(0);
	});

	it("a manual debit in the window does the same, and removes only stamps still valid", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 10 }, { soldAt: sold, at: sold });
		const later = at("2026-06-10T09:00");
		ledger.earn("m1", { stamps: 1, points: 10 }, { soldAt: later, at: later });
		const window = at("2026-11-20T01:00");
		expect(
			ledger.adjust("m1", { stamps: -2, points: 0 }, window, "fix"),
		).toEqual({ ok: false, refusal: "would_go_negative" });
		expect(
			ledger.adjust("m1", { stamps: -1, points: 0 }, window, "fix").ok,
		).toBe(true);
		expect(
			ledger.entries.slice(-2).map((row) => `${row.kind}:${row.stampDelta}`),
		).toEqual(["expire:-1", "adjust:-1"]);
		expect(ledger.balance("m1").stamps).toBe(0);
		expect(ledger.activeStampLots("m1")).toBe(0);
	});

	it("a clawback in the window takes nothing of a credit that ended and leaves it to the run", () => {
		const ledger = ledgerWithMember();
		const earn = ledger.earn(
			"m1",
			{ stamps: 1, points: 6 },
			{ soldAt: sold, at: sold },
		);
		if (!earn.ok) throw new Error("earn refused");
		const claw = ledger.entry(
			(ledger.clawback(earn.entryId, midnight + 60_000) as { entryId: number })
				.entryId,
		);
		expect(claw).toMatchObject({
			stampDelta: 0,
			pointDelta: -6,
			reason: "invoice_voided; short by 1 stamp",
		});
		expect(ledger.expire(at("2026-11-20T04:00"))).toMatchObject({ stamps: 1 });
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 0 });
	});

	it("a pending earn's clock starts at the end of the day of its confirmation", () => {
		const ledger = ledgerWithMember();
		const earn = ledger.earn(
			"m1",
			{ stamps: 1, points: 6 },
			{ soldAt: sold, at: sold, pending: true },
		);
		if (!earn.ok) throw new Error("earn refused");
		const confirmedAt = at("2026-05-21T15:00");
		const confirm = ledger.entry(
			(ledger.confirm(earn.entryId, confirmedAt) as { entryId: number })
				.entryId,
		);
		expect(confirm?.expiresAt).toBe(at("2027-05-22T00:00"));
		expect(ledger.spendableLots("m1", confirmedAt)[0]?.expiresAt).toBe(
			at("2026-11-22T00:00"),
		);
	});
});
