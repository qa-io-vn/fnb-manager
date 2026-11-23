// The loyalty ledger model, one operation at a time (G-15, component level).
// ISTQB techniques per block: state transition testing (pending -> confirmed,
// held -> confirmed or released), boundary value analysis (balance and cost,
// expiry to the millisecond, month ends), equivalence partitioning (the kinds of
// refusal), negative tests (every refusal leaves the ledger unchanged).
import { describe, expect, it } from "vitest";
import {
	accountFromEntries,
	addMonthsUtc,
	creditExpiresAt,
	expiringPoints,
	type LedgerRules,
	LoyaltyLedger,
	REDEMPTION_RELEASED,
} from "../../src/index.js";

const RULES: LedgerRules = {
	stampValidityMonths: 6,
	pointsExpiryMonths: 12,
	timezone: "Asia/Ho_Chi_Minh",
};
const at = (local: string) => Date.parse(`${local}:00+07:00`);

function ledgerWithMember(member = "m1"): LoyaltyLedger {
	const ledger = new LoyaltyLedger(RULES);
	ledger.join(member);
	return ledger;
}

function entryId(result: { ok: boolean; entryId?: number }): number {
	if (!result.ok || result.entryId === undefined) {
		throw new Error("expected an accepted operation");
	}
	return result.entryId;
}

describe("addMonthsUtc: month arithmetic as the database does it (boundary value analysis)", () => {
	const utc = (iso: string) => Date.parse(iso);
	it.each([
		{ from: "2026-10-31T08:00:00Z", months: 12, to: "2027-10-31T08:00:00Z" },
		{ from: "2026-10-31T08:00:00Z", months: 6, to: "2027-04-30T08:00:00Z" },
		{ from: "2026-08-31T08:00:00Z", months: 6, to: "2027-02-28T08:00:00Z" },
		{ from: "2027-08-31T08:00:00Z", months: 6, to: "2028-02-29T08:00:00Z" },
		{ from: "2027-03-31T08:00:00Z", months: -1, to: "2027-02-28T08:00:00Z" },
		{ from: "2027-01-15T08:00:00Z", months: -12, to: "2026-01-15T08:00:00Z" },
		{ from: "2027-12-31T23:59:59Z", months: 2, to: "2028-02-29T23:59:59Z" },
	])("$from + $months months is $to", ({ from, months, to }) => {
		expect(addMonthsUtc(utc(from), months)).toBe(utc(to));
	});
});

describe("state transition testing: an earn waits for its confirm row", () => {
	it("shows pending points apart, then makes them spendable once", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 8 },
				{
					soldAt: at("2026-10-07T12:00"),
					at: at("2026-10-07T12:05"),
					pending: true,
				},
			),
		);
		expect(ledger.balance("m1")).toEqual({
			stamps: 0,
			points: 0,
			pendingStamps: 1,
			pendingPoints: 8,
		});
		const confirm = entryId(ledger.confirm(earn, at("2026-10-07T13:00")));
		expect(ledger.balance("m1")).toEqual({
			stamps: 1,
			points: 8,
			pendingStamps: 0,
			pendingPoints: 0,
		});
		expect(entryId(ledger.confirm(earn, at("2026-10-07T14:00")))).toBe(confirm);
		expect(ledger.entries.filter((row) => row.kind === "confirm")).toHaveLength(
			1,
		);
	});

	it("refuses what is not pending, unknown or reversed, and writes nothing", () => {
		const ledger = ledgerWithMember();
		const settled = entryId(
			ledger.earn("m1", { stamps: 0, points: 3 }, { soldAt: 0, at: 1 }),
		);
		const pending = entryId(
			ledger.earn(
				"m1",
				{ stamps: 0, points: 4 },
				{ soldAt: 0, at: 2, pending: true },
			),
		);
		ledger.clawback(pending, 3);
		const before = ledger.entries.length;
		expect(ledger.confirm(settled, 4)).toEqual({
			ok: false,
			refusal: "not_pending",
		});
		expect(ledger.confirm(99, 4)).toEqual({
			ok: false,
			refusal: "unknown_entry",
		});
		expect(ledger.confirm(pending, 4)).toEqual({
			ok: false,
			refusal: "reversed",
		});
		expect(ledger.entries).toHaveLength(before);
	});

	it("refuses an unknown member and an earn of nothing", () => {
		const ledger = ledgerWithMember();
		expect(
			ledger.earn("nobody", { stamps: 1, points: 1 }, { soldAt: 0, at: 0 }),
		).toEqual({
			ok: false,
			refusal: "unknown_member",
		});
		expect(
			ledger.earn("m1", { stamps: 0, points: 0 }, { soldAt: 0, at: 0 }),
		).toEqual({
			ok: false,
			refusal: "nothing_to_earn",
		});
		expect(ledger.entries).toHaveLength(0);
	});
});

describe("boundary value analysis: what a hold may take", () => {
	it.each([
		{ label: "x - 1", cost: 39, ok: true },
		{ label: "x", cost: 40, ok: true },
		{ label: "x + 1", cost: 41, ok: false },
	])(
		"a hold of $cost points on 40 ($label) is accepted: $ok",
		({ cost, ok }) => {
			const ledger = ledgerWithMember();
			ledger.earn("m1", { stamps: 0, points: 40 }, { soldAt: 0, at: 1 });
			const result = ledger.hold("m1", { stamps: 0, points: cost }, 2);
			expect(result.ok).toBe(ok);
			expect(ledger.balance("m1").points).toBe(ok ? 40 - cost : 40);
			if (!result.ok) {
				expect(result.refusal).toBe("insufficient_points");
			}
		},
	);

	it("takes stamps oldest expiry first and stops at a stamp's expiry to the millisecond", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-10-01T10:00");
		ledger.earn("m1", { stamps: 2, points: 0 }, { soldAt: sold, at: sold + 1 });
		// Changed by ADR-047: the stamp ends at the midnight closing its anniversary day.
		const expiry = creditExpiresAt(sold, 6, RULES.timezone);
		expect(ledger.hold("m1", { stamps: 2, points: 0 }, expiry).ok).toBe(false);
		expect(ledger.hold("m1", { stamps: 2, points: 0 }, expiry - 1).ok).toBe(
			true,
		);
	});

	it("refuses a hold that costs nothing or a negative amount", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 5 }, { soldAt: 0, at: 1 });
		expect(ledger.hold("m1", { stamps: 0, points: 0 }, 2)).toEqual({
			ok: false,
			refusal: "no_cost",
		});
		expect(ledger.hold("m1", { stamps: -1, points: 0 }, 2)).toEqual({
			ok: false,
			refusal: "no_cost",
		});
	});
});

describe("state transition testing: a hold is confirmed or released, once", () => {
	function held() {
		const ledger = ledgerWithMember();
		ledger.earn(
			"m1",
			{ stamps: 3, points: 50 },
			{ soldAt: at("2026-10-05T09:00"), at: at("2026-10-05T09:05") },
		);
		const hold = entryId(
			ledger.hold("m1", { stamps: 2, points: 40 }, at("2026-10-06T10:00")),
		);
		return { ledger, hold };
	}

	it("holds at once: the balance drops and the redemption is held until its hold ends", () => {
		const { ledger, hold } = held();
		expect(ledger.balance("m1")).toMatchObject({ stamps: 1, points: 10 });
		expect(ledger.redemptionState(hold)).toBe("held");
		expect(ledger.holdExpiresAt(hold)).toBe(at("2026-10-07T10:00"));
	});

	it("a release returns exactly what its hold took, stamps included", () => {
		const { ledger, hold } = held();
		const release = ledger.entry(
			entryId(ledger.release(hold, at("2026-10-06T12:00"))),
		);
		expect(release).toMatchObject({
			kind: "adjust",
			reason: REDEMPTION_RELEASED,
			sourceId: hold,
			stampDelta: 2,
			pointDelta: 40,
		});
		expect(ledger.balance("m1")).toMatchObject({ stamps: 3, points: 50 });
		expect(ledger.redemptionState(hold)).toBe("released");
		expect(ledger.spendableLots("m1", at("2026-10-06T12:00"))).toHaveLength(3);
	});

	it("a confirmed hold stays spent and cannot be released or confirmed again as a hold", () => {
		const { ledger, hold } = held();
		ledger.confirm(hold, at("2026-10-06T11:00"));
		expect(ledger.redemptionState(hold)).toBe("confirmed");
		const rows = ledger.entries.length;
		expect(ledger.release(hold, at("2026-10-06T12:00"))).toEqual({
			ok: false,
			refusal: "not_held",
		});
		expect(ledger.entries).toHaveLength(rows);
		expect(ledger.balance("m1")).toMatchObject({ stamps: 1, points: 10 });
	});

	it("a released hold cannot be released again, and refusals leave the ledger as it was", () => {
		const { ledger, hold } = held();
		ledger.release(hold, at("2026-10-06T12:00"));
		const rows = ledger.entries.length;
		expect(ledger.release(hold, at("2026-10-06T13:00"))).toEqual({
			ok: false,
			refusal: "not_held",
		});
		expect(ledger.release(404, at("2026-10-06T13:00"))).toEqual({
			ok: false,
			refusal: "unknown_entry",
		});
		expect(ledger.entries).toHaveLength(rows);
	});

	it("a stamp whose own expiry passed while it was held comes back active and is expired by the next run", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-05-19T09:00");
		ledger.earn("m1", { stamps: 1, points: 0 }, { soldAt: sold, at: sold + 1 });
		const hold = entryId(
			ledger.hold("m1", { stamps: 1, points: 0 }, at("2026-11-18T09:00")),
		);
		const release = at("2026-11-20T09:00");
		ledger.release(hold, release);
		expect(ledger.balance("m1").stamps).toBe(1);
		expect(ledger.expire(release + 1)).toEqual({
			memberships: 1,
			stamps: 1,
			points: 0,
		});
		expect(ledger.balance("m1").stamps).toBe(0);
	});
});

describe("state transition testing: a clawback reverses an earn once", () => {
	it("writes the opposite deltas and closes the earn's stamps", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn("m1", { stamps: 1, points: 6 }, { soldAt: 0, at: 1 }),
		);
		const claw = ledger.entry(entryId(ledger.clawback(earn, 2)));
		expect(claw).toMatchObject({
			kind: "clawback",
			stampDelta: -1,
			pointDelta: -6,
			sourceId: earn,
		});
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 0 });
		expect(ledger.clawback(earn, 3)).toEqual({
			ok: false,
			refusal: "already_reversed",
		});
		expect(ledger.clawback(99, 3)).toEqual({
			ok: false,
			refusal: "unknown_entry",
		});
	});

	it("after a redemption the clawback takes back what is left and writes off the rest (ADR-046)", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn("m1", { stamps: 0, points: 60 }, { soldAt: 0, at: 1 }),
		);
		ledger.hold("m1", { stamps: 0, points: 40 }, 2);
		const claw = ledger.entry(entryId(ledger.clawback(earn, 3)));
		expect(claw).toMatchObject({
			pointDelta: -20,
			reason: "invoice_voided; short by 40 points",
		});
		expect(ledger.balance("m1").points).toBe(0);
	});

	it("before ADR-046 (uncapped clawbacks) the same case left -40", () => {
		const ledger = new LoyaltyLedger(RULES, { uncappedClawbacks: true });
		ledger.join("m1");
		const earn = entryId(
			ledger.earn("m1", { stamps: 0, points: 60 }, { soldAt: 0, at: 1 }),
		);
		ledger.hold("m1", { stamps: 0, points: 40 }, 2);
		ledger.clawback(earn, 3);
		expect(ledger.balance("m1").points).toBe(-40);
	});

	it("a clawback of an earn still pending nets to nothing in the balance", () => {
		const ledger = ledgerWithMember();
		const earn = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 6 },
				{ soldAt: 0, at: 1, pending: true },
			),
		);
		ledger.clawback(earn, 2);
		expect(ledger.balance("m1")).toEqual({
			stamps: 0,
			points: 0,
			pendingStamps: 0,
			pendingPoints: 0,
		});
	});
});

describe("adjustments", () => {
	it("credits points that expire after twelve months and stamps that expire after six", () => {
		const ledger = ledgerWithMember();
		const adjust = ledger.entry(
			entryId(
				ledger.adjust(
					"m1",
					{ stamps: 1, points: 25 },
					at("2027-10-21T15:00"),
					"goodwill credit",
				),
			),
		);
		// Changed by ADR-047: valid through 21 October, ending at the midnight that closes it (was 15:00).
		expect(adjust?.expiresAt).toBe(at("2028-10-22T00:00"));
		expect(
			ledger.spendableLots("m1", at("2027-10-21T15:00"))[0]?.expiresAt,
		).toBe(at("2028-04-22T00:00"));
	});

	it("refuses a debit beyond the balance, and takes one that fits", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 1, points: 10 }, { soldAt: 0, at: 1 });
		expect(
			ledger.adjust("m1", { stamps: 0, points: -11 }, 2, "correction"),
		).toEqual({
			ok: false,
			refusal: "would_go_negative",
		});
		expect(
			ledger.adjust("m1", { stamps: -2, points: 0 }, 2, "correction"),
		).toEqual({
			ok: false,
			refusal: "would_go_negative",
		});
		expect(ledger.adjust("m1", { stamps: 0, points: 0 }, 2, "nothing")).toEqual(
			{
				ok: false,
				refusal: "nothing_to_adjust",
			},
		);
		expect(
			ledger.adjust("m1", { stamps: -1, points: -10 }, 2, "correction").ok,
		).toBe(true);
		expect(ledger.balance("m1")).toMatchObject({ stamps: 0, points: 0 });
	});

	it("takes a balance below zero only when asked to, as app.loyalty_apply_adjustment does", () => {
		const ledger = new LoyaltyLedger(RULES, { allowNegativeAdjustments: true });
		ledger.join("m1");
		ledger.earn("m1", { stamps: 1, points: 3 }, { soldAt: 0, at: 1 });
		ledger.adjust("m1", { stamps: -4, points: -10 }, 2, "correction");
		expect(ledger.balance("m1")).toMatchObject({ stamps: -3, points: -7 });
	});
});

describe("expiry: first in first out, net of what was spent, held and reversed", () => {
	it("expires only credits past their expiry, never the same points twice", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-10-01T10:00");
		ledger.earn(
			"m1",
			{ stamps: 0, points: 10 },
			{ soldAt: sold, at: sold + 1 },
		);
		ledger.earn(
			"m1",
			{ stamps: 0, points: 20 },
			{ soldAt: sold + 86_400_000, at: sold + 86_400_001 },
		);
		// Changed by ADR-047: the credit ends at the midnight closing its anniversary day.
		const first = creditExpiresAt(sold, 12, RULES.timezone);
		expect(ledger.expire(first - 1)).toEqual({
			memberships: 0,
			stamps: 0,
			points: 0,
		});
		expect(ledger.expire(first)).toEqual({
			memberships: 1,
			stamps: 0,
			points: 10,
		});
		expect(ledger.expire(first)).toEqual({
			memberships: 0,
			stamps: 0,
			points: 0,
		});
		expect(ledger.expire(first + 86_400_000)).toEqual({
			memberships: 1,
			stamps: 0,
			points: 20,
		});
		expect(ledger.balance("m1").points).toBe(0);
	});

	it("counts what was spent against the oldest credits first", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-10-01T10:00");
		ledger.earn(
			"m1",
			{ stamps: 0, points: 10 },
			{ soldAt: sold, at: sold + 1 },
		);
		ledger.earn(
			"m1",
			{ stamps: 0, points: 10 },
			{ soldAt: sold + 86_400_000, at: sold + 86_400_001 },
		);
		ledger.hold("m1", { stamps: 0, points: 10 }, sold + 2 * 86_400_000);
		// Changed by ADR-047: the credit ends at the midnight closing its anniversary day.
		const first = creditExpiresAt(sold, 12, RULES.timezone);
		expect(expiringPoints(ledger.entries, "m1", first)).toBe(0);
		expect(expiringPoints(ledger.entries, "m1", first + 86_400_000)).toBe(10);
	});

	it("leaves out an earn still waiting for its confirm row and the points a clawback took back", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-10-01T10:00");
		ledger.earn(
			"m1",
			{ stamps: 1, points: 10 },
			{ soldAt: sold, at: sold + 1, pending: true },
		);
		const settled = entryId(
			ledger.earn(
				"m1",
				{ stamps: 0, points: 7 },
				{ soldAt: sold, at: sold + 2 },
			),
		);
		ledger.clawback(settled, sold + 3);
		const later = creditExpiresAt(sold, 12, RULES.timezone) + 1;
		expect(ledger.expire(later)).toEqual({
			memberships: 0,
			stamps: 0,
			points: 0,
		});
		expect(ledger.balance("m1").points).toBe(0);
	});

	it("refuses an operation dated before an earlier one", () => {
		const ledger = ledgerWithMember();
		ledger.earn("m1", { stamps: 0, points: 1 }, { soldAt: 0, at: 100 });
		expect(() => ledger.expire(99)).toThrow(RangeError);
		expect(() => ledger.expire(Number.NaN)).toThrow(RangeError);
	});
});

describe("the running account agrees with the ledger rows", () => {
	it("after every kind of operation", () => {
		const ledger = ledgerWithMember();
		const sold = at("2026-10-01T10:00");
		const a = entryId(
			ledger.earn(
				"m1",
				{ stamps: 2, points: 30 },
				{ soldAt: sold, at: sold + 1 },
			),
		);
		const b = entryId(
			ledger.earn(
				"m1",
				{ stamps: 1, points: 12 },
				{ soldAt: sold, at: sold + 2, pending: true },
			),
		);
		const hold1 = entryId(
			ledger.hold("m1", { stamps: 1, points: 20 }, sold + 3),
		);
		const hold2 = entryId(
			ledger.hold("m1", { stamps: 0, points: 5 }, sold + 4),
		);
		ledger.confirm(hold1, sold + 5);
		ledger.release(hold2, sold + 6);
		ledger.confirm(b, sold + 7);
		ledger.clawback(a, sold + 8);
		ledger.adjust("m1", { stamps: 0, points: 4 }, sold + 9, "credit");
		ledger.expire(addMonthsUtc(sold, 13));
		const account = ledger.account("m1");
		expect(account).toEqual(accountFromEntries(ledger.entries, "m1"));
		const balance = ledger.balance("m1");
		expect(account?.spendable).toEqual({
			stamps: balance.stamps,
			points: balance.points,
		});
	});

	it("is undefined for a member who never joined", () => {
		expect(ledgerWithMember().account("nobody")).toBeUndefined();
	});
});
