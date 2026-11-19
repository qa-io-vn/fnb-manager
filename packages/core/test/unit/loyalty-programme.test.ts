import { describe, expect, it } from "vitest";
import {
	couponRailRewardSchema,
	couponRailSchema,
	DEFAULT_LOYALTY_PARAMETERS,
	LOYALTY_ENTRY_KINDS,
	LOYALTY_PARAMETER_RANGES,
	LOYALTY_REFUSAL_REASONS,
	loyaltyLedgerEntrySchema,
	loyaltyParametersSchema,
	loyaltyProgrammeSchema,
	NOTIFICATION_DECISIONS,
} from "../../src/index.js";

const invoiceId = "77777777-7777-4777-8777-000000000001";
const entryId = "66666666-6666-4666-8666-000000000001";
const storeId = "ffffffff-ffff-4fff-8fff-000000000001";

describe("loyalty programme parameters", () => {
	it("default to the recommended mechanic, as the database does", () => {
		expect(DEFAULT_LOYALTY_PARAMETERS).toEqual({
			stampsPerCard: 8,
			stampMinBillAmount: 50_000,
			welcomeStamps: 2,
			pointUnitAmount: 10_000,
			pointsPerUnit: 1,
			stampValidityMonths: 6,
			pointsExpiryMonths: 12,
			earningInvoicesPerPhonePerDay: 3,
			checkinWindowBeforeMinutes: 2,
			checkinWindowAfterMinutes: 15,
			checkinCodeTtlSeconds: 120,
			checkinPendingHours: 24,
			receiptClaimWindowHours: 72,
			receiptClaimsPerPhonePerDay: 3,
			excludedOrderSources: [],
			pointValueAmount: 500,
			expectedBreakageRate: 0.2,
		});
	});

	it.each(Object.entries(LOYALTY_PARAMETER_RANGES))(
		"accepts %s at both ends of its range and refuses it outside",
		(name, range) => {
			const at = (value: number) =>
				loyaltyParametersSchema.safeParse({
					[name]: value,
					...(name === "stampsPerCard" ? { welcomeStamps: 1 } : {}),
					...(name === "welcomeStamps" ? { stampsPerCard: 20 } : {}),
				}).success;
			expect(at(range.min)).toBe(true);
			expect(at(range.max)).toBe(true);
			expect(at(range.min - (range.integer ? 1 : 0.001))).toBe(false);
			expect(at(range.max + (range.integer ? 1 : 0.001))).toBe(false);
		},
	);

	it("keeps the welcome stamps below a full card", () => {
		expect(
			loyaltyParametersSchema.safeParse({ stampsPerCard: 8, welcomeStamps: 8 })
				.success,
		).toBe(false);
		expect(
			loyaltyParametersSchema.safeParse({ stampsPerCard: 8, welcomeStamps: 7 })
				.success,
		).toBe(true);
	});

	it("trims excluded order sources and refuses blank ones or more than 50", () => {
		expect(
			loyaltyParametersSchema.parse({
				excludedOrderSources: [" delivery-app "],
			}).excludedOrderSources,
		).toEqual(["delivery-app"]);
		expect(
			loyaltyParametersSchema.safeParse({ excludedOrderSources: [" "] })
				.success,
		).toBe(false);
		expect(
			loyaltyParametersSchema.safeParse({
				excludedOrderSources: Array.from({ length: 51 }, (_, n) => `s${n}`),
			}).success,
		).toBe(false);
	});
});

describe("loyalty programme", () => {
	const base = { name: "Synthetic programme", startsOn: "2026-12-01" };

	it("lists the notification decisions", () => {
		expect(NOTIFICATION_DECISIONS).toEqual([
			"pending",
			"notified",
			"below_threshold",
			"not_required",
		]);
	});

	it("starts as a draft with the decision pending", () => {
		const programme = loyaltyProgrammeSchema.parse(base);
		expect(programme.status).toBe("draft");
		expect(programme.notificationDecision).toBe("pending");
		expect(programme.endsOn).toBeNull();
	});

	it("cannot be active while the notification decision is pending", () => {
		expect(
			loyaltyProgrammeSchema.safeParse({ ...base, status: "active" }).success,
		).toBe(false);
		expect(
			loyaltyProgrammeSchema.safeParse({
				...base,
				status: "active",
				notificationDecision: "below_threshold",
			}).success,
		).toBe(true);
	});

	it("needs a legal basis for not_required", () => {
		expect(
			loyaltyProgrammeSchema.safeParse({
				...base,
				notificationDecision: "not_required",
			}).success,
		).toBe(false);
		expect(
			loyaltyProgrammeSchema.safeParse({
				...base,
				notificationDecision: "not_required",
				notificationBasis: "Purchase-based programme",
			}).success,
		).toBe(true);
	});

	it("ends on or after its start and keeps a plain name", () => {
		expect(
			loyaltyProgrammeSchema.safeParse({ ...base, endsOn: "2026-11-30" })
				.success,
		).toBe(false);
		expect(
			loyaltyProgrammeSchema.safeParse({ ...base, endsOn: "2026-12-01" })
				.success,
		).toBe(true);
		expect(
			loyaltyProgrammeSchema.safeParse({ ...base, name: "a\u0007b" }).success,
		).toBe(false);
		expect(
			loyaltyProgrammeSchema.safeParse({ ...base, name: " " }).success,
		).toBe(false);
	});
});

describe("coupon rails", () => {
	it("names one of the three rails", () => {
		expect(
			couponRailSchema.safeParse({
				storeId,
				rail: "pos_payment_discount",
				activeFrom: "2026-11-01T00:00:00+07:00",
			}).success,
		).toBe(true);
		expect(
			couponRailSchema.safeParse({
				storeId,
				rail: "manual",
				activeFrom: "2026-11-01T00:00:00+07:00",
			}).success,
		).toBe(false);
	});

	it("maps a reward to the POS side and an e-invoice display", () => {
		expect(
			couponRailRewardSchema.safeParse({
				storeId,
				rewardKey: "free-drink",
				einvoiceDisplay: "discount",
			}).success,
		).toBe(false);
		expect(
			couponRailRewardSchema.safeParse({
				storeId,
				rewardKey: "free-drink",
				posDiscountName: "Synthetic",
				einvoiceDisplay: "zero_price_line",
			}).success,
		).toBe(false);
		expect(
			couponRailRewardSchema.safeParse({
				storeId,
				rewardKey: "free-drink",
				posFreeItemExternalId: "item-1",
				einvoiceDisplay: "zero_price_line",
			}).success,
		).toBe(true);
		expect(
			couponRailRewardSchema.safeParse({
				storeId,
				rewardKey: "Free Drink",
				posDiscountName: "x",
				einvoiceDisplay: "discount",
			}).success,
		).toBe(false);
	});
});

describe("ledger entries", () => {
	it("lists the entry kinds and refusal reasons", () => {
		expect(LOYALTY_ENTRY_KINDS).toEqual([
			"earn",
			"confirm",
			"clawback",
			"redeem",
			"adjust",
			"expire",
		]);
		expect(LOYALTY_REFUSAL_REASONS).toContain("daily_cap");
		expect(LOYALTY_REFUSAL_REASONS).toContain("excluded_phone");
	});

	it("needs an invoice and a path for an earn", () => {
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "earn",
				stampDelta: 1,
				matchedPath: "A",
			}).success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "earn",
				stampDelta: 1,
				invoiceId,
			}).success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "earn",
				stampDelta: 1,
				invoiceId,
				matchedPath: "A",
			}).success,
		).toBe(true);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "earn",
				stampDelta: -1,
				invoiceId,
				matchedPath: "A",
			}).success,
		).toBe(false);
	});

	it("needs the reversed row for a clawback and a reason for an adjustment", () => {
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "clawback",
				stampDelta: -1,
				invoiceId,
				reason: "voided",
			}).success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "clawback",
				stampDelta: -1,
				invoiceId,
				reason: "voided",
				sourceEntryId: entryId,
			}).success,
		).toBe(true);
		expect(
			loyaltyLedgerEntrySchema.safeParse({ entryKind: "adjust", stampDelta: 2 })
				.success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "adjust",
				stampDelta: 2,
				reason: "welcome",
			}).success,
		).toBe(true);
	});

	it("keeps confirm rows empty and pending only on earns and redemptions", () => {
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "confirm",
				invoiceId,
				sourceEntryId: entryId,
				pointDelta: 1,
			}).success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "expire",
				stampDelta: -1,
				pending: true,
			}).success,
		).toBe(false);
		expect(
			loyaltyLedgerEntrySchema.safeParse({
				entryKind: "redeem",
				stampDelta: -8,
				pending: true,
			}).success,
		).toBe(true);
	});
});
