// Loyalty earn rules designed with explicit ISTQB black-box techniques
// (boundary value analysis, decision tables). Each description names its
// technique; the SQL side of the same rules is in supabase/tests/130_* to 135_*.
import { describe, expect, it } from "vitest";
import {
	computeExpectedLedger,
	DEFAULT_LOYALTY_PARAMETERS,
	type EarnParameters,
	earnForAmount,
	LOYALTY_PARAMETER_RANGES,
	type LoyaltyParameterName,
	type LoyaltyRefusalReason,
	loyaltyParametersSchema,
	type ReplayInvoice,
} from "../../src/index.js";

const PARAMETERS: EarnParameters = {
	stampMinBillAmount: 50_000,
	pointUnitAmount: 10_000,
	pointsPerUnit: 1,
	welcomeStamps: 0,
	earningInvoicesPerPhonePerDay: 3,
	excludedOrderSources: ["GrabFood"],
};

// Synthetic phones, built so no full number appears in the source.
const MEMBER = `+84${"900000101"}`;
const STAFF = `+84${"900000102"}`;

function sale(
	index: number,
	overrides: Partial<ReplayInvoice> = {},
): ReplayInvoice {
	return {
		externalId: `bva-${String(index).padStart(3, "0")}`,
		businessDate: "2026-11-10",
		soldAt: new Date(
			Date.parse("2026-11-10T02:00:00.000Z") + index * 60_000,
		).toISOString(),
		netAmount: 60_000,
		phone: MEMBER,
		source: "Tại quán",
		status: "completed",
		voidedLater: false,
		...overrides,
	};
}

describe("boundary value analysis: the minimum bill for a stamp (stamp_min_bill_amount = 50,000)", () => {
	it.each([
		{ label: "x - 1", amount: 49_999, stamps: 0, points: 4 },
		{ label: "x", amount: 50_000, stamps: 1, points: 5 },
		{ label: "x + 1", amount: 50_001, stamps: 1, points: 5 },
	])(
		"BVA $label ($amount) earns $stamps stamp(s) and $points point(s)",
		({ amount, stamps, points }) => {
			expect(earnForAmount(amount, PARAMETERS)).toEqual({ stamps, points });
		},
	);

	it("BVA x - 1 is still an earn of points, counted as below_minimum in the replay", () => {
		const ledger = computeExpectedLedger({
			parameters: PARAMETERS,
			members: [MEMBER],
			staffPhones: [],
			invoices: [sale(1, { netAmount: 49_999 })],
		});
		expect(ledger.earns).toBe(1);
		expect(ledger.stamps).toBe(0);
		expect(ledger.points).toBe(4);
		expect(ledger.refusals.below_minimum).toBe(1);
	});
});

describe("boundary value analysis: one point per started 10,000 (point_unit_amount)", () => {
	it.each([
		{ label: "x - 1", amount: 9_999, points: 0 },
		{ label: "x", amount: 10_000, points: 1 },
		{ label: "x + 1", amount: 10_001, points: 1 },
		{ label: "2x - 1", amount: 19_999, points: 1 },
		{ label: "2x", amount: 20_000, points: 2 },
	])("BVA $label ($amount) earns $points point(s)", ({ amount, points }) => {
		expect(earnForAmount(amount, PARAMETERS).points).toBe(points);
	});

	it("BVA x - 1 below both the stamp and the point boundary is no earn at all and does not use the daily cap", () => {
		const ledger = computeExpectedLedger({
			parameters: PARAMETERS,
			members: [MEMBER],
			staffPhones: [],
			invoices: [sale(1, { netAmount: 9_999 }), sale(2), sale(3), sale(4)],
		});
		expect(ledger.earns).toBe(3);
		expect(ledger.refusals.daily_cap).toBe(0);
		expect(ledger.refusals.below_minimum).toBe(1);
	});
});

describe("boundary value analysis: the daily cap of earning invoices (earning_invoices_per_phone_per_day = 3)", () => {
	it.each([
		{ label: "x - 1", invoices: 2, earns: 2, capped: 0 },
		{ label: "x", invoices: 3, earns: 3, capped: 0 },
		{ label: "x + 1", invoices: 4, earns: 3, capped: 1 },
	])(
		"BVA $label: $invoices invoices on one business day earn $earns and refuse $capped",
		({ invoices, earns, capped }) => {
			const ledger = computeExpectedLedger({
				parameters: PARAMETERS,
				members: [MEMBER],
				staffPhones: [],
				invoices: Array.from({ length: invoices }, (_, index) =>
					sale(index + 1),
				),
			});
			expect(ledger.earns).toBe(earns);
			expect(ledger.refusals.daily_cap).toBe(capped);
		},
	);

	it("BVA x + 1 on the next business day earns again: the cap is per business date, not per 24 hours", () => {
		const ledger = computeExpectedLedger({
			parameters: PARAMETERS,
			members: [MEMBER],
			staffPhones: [],
			invoices: [
				sale(1),
				sale(2),
				sale(3),
				sale(4, { businessDate: "2026-11-11" }),
			],
		});
		expect(ledger.earns).toBe(4);
		expect(ledger.refusals.daily_cap).toBe(0);
	});

	it("a clawed-back earn frees its place from the moment the clawback is written (the SQL rule, G-42)", () => {
		const ledger = computeExpectedLedger({
			parameters: PARAMETERS,
			members: [MEMBER],
			staffPhones: [],
			invoices: [
				sale(1),
				sale(2, {
					voidedLater: true,
					voidedAt: new Date(
						Date.parse("2026-11-10T02:00:00.000Z") + 3.5 * 60_000,
					).toISOString(),
				}),
				sale(3),
				sale(4),
				sale(5),
				sale(6),
			],
		});
		// The void is written between sale 3 and sale 4: sale 4 is the third earn
		// again, sale 5 is x + 1 again.
		expect(ledger.earns).toBe(4);
		expect(ledger.clawbacks).toBe(1);
		expect(ledger.refusals.daily_cap).toBe(2);
	});

	it("an earn voided after the later sales were decided still counted for them", () => {
		const ledger = computeExpectedLedger({
			parameters: PARAMETERS,
			members: [MEMBER],
			staffPhones: [],
			invoices: [sale(1, { voidedLater: true }), sale(2), sale(3), sale(4)],
		});
		expect(ledger.earns).toBe(3);
		expect(ledger.clawbacks).toBe(1);
		expect(ledger.refusals.daily_cap).toBe(1);
	});
});

// Decision table for earn eligibility. Conditions: C1 the net amount reaches
// the minimum bill, C2 the phone is a staff phone, C3 the order source is
// excluded, C4 the phone already earned the daily cap that business day.
// The TypeScript replay has no programme status (it replays an active
// programme), so condition C5 "programme active" is covered with all 32
// rules by supabase/tests/132_loyalty_earn_decision_table.sql.
// Actions follow the refusal order of app.loyalty_earn: excluded_source,
// then excluded_phone, then daily_cap, then an earn (below_minimum noted
// when no stamp is earned).
interface DecisionRule {
	readonly minimumBill: boolean;
	readonly staffPhone: boolean;
	readonly excludedSource: boolean;
	readonly dailyCapReached: boolean;
}

function expectedAction(rule: DecisionRule): {
	refusal: LoyaltyRefusalReason | null;
	stamps: number;
	points: number;
} {
	if (rule.excludedSource) {
		return { refusal: "excluded_source", stamps: 0, points: 0 };
	}
	if (rule.staffPhone) {
		return { refusal: "excluded_phone", stamps: 0, points: 0 };
	}
	if (rule.dailyCapReached) {
		return { refusal: "daily_cap", stamps: 0, points: 0 };
	}
	return rule.minimumBill
		? { refusal: null, stamps: 1, points: 6 }
		: { refusal: "below_minimum", stamps: 0, points: 4 };
}

const DECISION_TABLE: DecisionRule[] = [];
for (let mask = 0; mask < 16; mask += 1) {
	DECISION_TABLE.push({
		minimumBill: (mask & 1) !== 0,
		staffPhone: (mask & 2) !== 0,
		excludedSource: (mask & 4) !== 0,
		dailyCapReached: (mask & 8) !== 0,
	});
}

const yn = (value: boolean) => (value ? "Y" : "N");

describe("decision table: earn eligibility (C1 minimum bill, C2 staff phone, C3 excluded source, C4 daily cap reached)", () => {
	it("covers every one of the 16 combinations exactly once", () => {
		const keys = new Set(
			DECISION_TABLE.map((rule) =>
				[
					rule.minimumBill,
					rule.staffPhone,
					rule.excludedSource,
					rule.dailyCapReached,
				].join(),
			),
		);
		expect(keys.size).toBe(16);
	});

	it.each(
		DECISION_TABLE.map((rule, index) => ({
			...rule,
			rule: index + 1,
			key: `C1=${yn(rule.minimumBill)} C2=${yn(rule.staffPhone)} C3=${yn(rule.excludedSource)} C4=${yn(rule.dailyCapReached)}`,
		})),
	)("decision table rule $rule ($key)", (rule) => {
		const phone = rule.staffPhone ? STAFF : MEMBER;
		const earlier = rule.dailyCapReached
			? [1, 2, 3].map((index) => sale(index, { phone }))
			: [];
		const tested = sale(10, {
			phone,
			netAmount: rule.minimumBill ? 60_000 : 45_000,
			source: rule.excludedSource ? " grabfood " : "Tại quán",
		});
		const replay = (invoices: ReplayInvoice[]) =>
			computeExpectedLedger({
				parameters: PARAMETERS,
				members: [phone],
				staffPhones: rule.staffPhone ? [STAFF] : [],
				invoices,
			});
		const before = replay(earlier);
		const after = replay([...earlier, tested]);
		const action = expectedAction(rule);
		const delta = (key: "stamps" | "points" | "earns") =>
			(after.members[phone]?.[key] ?? 0) - (before.members[phone]?.[key] ?? 0);
		expect(delta("stamps")).toBe(action.stamps);
		expect(delta("points")).toBe(action.points);
		expect(delta("earns")).toBe(
			action.refusal === null || action.refusal === "below_minimum" ? 1 : 0,
		);
		const refused = Object.fromEntries(
			Object.entries(after.refusals)
				.map(([reason, count]) => [
					reason,
					count - before.refusals[reason as LoyaltyRefusalReason],
				])
				.filter(([, count]) => count !== 0),
		);
		expect(refused).toEqual(
			action.refusal === null ? {} : { [action.refusal]: 1 },
		);
	});
});

describe("boundary value analysis: the programme parameter ranges the settings page accepts", () => {
	const cases: { name: LoyaltyParameterName; label: string }[] = [
		{ name: "earningInvoicesPerPhonePerDay", label: "daily cap" },
		{ name: "checkinWindowBeforeMinutes", label: "check-in window before" },
		{ name: "checkinWindowAfterMinutes", label: "check-in window after" },
		{ name: "checkinCodeTtlSeconds", label: "check-in code TTL" },
		{ name: "receiptClaimWindowHours", label: "receipt claim window" },
		{ name: "receiptClaimsPerPhonePerDay", label: "receipt claims per day" },
		{ name: "stampsPerCard", label: "stamps per card" },
	];

	function parse(name: LoyaltyParameterName, value: number) {
		const base = { ...DEFAULT_LOYALTY_PARAMETERS, welcomeStamps: 0 };
		return loyaltyParametersSchema.safeParse({ ...base, [name]: value });
	}

	it.each(cases)(
		"BVA on the $label: min - 1 refused, min and min + 1 accepted, max - 1 and max accepted, max + 1 refused",
		({ name }) => {
			const { min, max } = LOYALTY_PARAMETER_RANGES[name];
			expect(parse(name, min - 1).success).toBe(false);
			expect(parse(name, min).success).toBe(true);
			expect(parse(name, min + 1).success).toBe(true);
			expect(parse(name, max - 1).success).toBe(true);
			expect(parse(name, max).success).toBe(true);
			expect(parse(name, max + 1).success).toBe(false);
		},
	);

	it("BVA on the defaults the SQL boundaries use: cap 3, window -2/+15 minutes, TTL 120 s, claims 72 h, 8 stamps per card", () => {
		expect(DEFAULT_LOYALTY_PARAMETERS).toMatchObject({
			earningInvoicesPerPhonePerDay: 3,
			checkinWindowBeforeMinutes: 2,
			checkinWindowAfterMinutes: 15,
			checkinCodeTtlSeconds: 120,
			receiptClaimWindowHours: 72,
			stampsPerCard: 8,
			stampMinBillAmount: 50_000,
		});
	});

	it.each([
		{ label: "stamps per card - 1", welcome: 7, accepted: true },
		{ label: "stamps per card", welcome: 8, accepted: false },
		{ label: "stamps per card + 1", welcome: 9, accepted: false },
	])(
		"BVA on the welcome stamps against a card of 8: $label ($welcome) accepted=$accepted",
		({ welcome, accepted }) => {
			const parsed = loyaltyParametersSchema.safeParse({
				...DEFAULT_LOYALTY_PARAMETERS,
				stampsPerCard: 8,
				welcomeStamps: welcome,
			});
			expect(parsed.success).toBe(accepted);
		},
	);
});
