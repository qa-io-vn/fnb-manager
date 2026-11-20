import { z } from "zod";
import { isoDate } from "./common.js";

export const LOYALTY_PROGRAMME_STATUSES = [
	"draft",
	"active",
	"paused",
	"ended",
] as const;
export const loyaltyProgrammeStatusSchema = z.enum(LOYALTY_PROGRAMME_STATUSES);
export type LoyaltyProgrammeStatus = z.infer<
	typeof loyaltyProgrammeStatusSchema
>;

export const NOTIFICATION_DECISIONS = [
	"pending",
	"notified",
	"below_threshold",
	"not_required",
] as const;
export const notificationDecisionSchema = z.enum(NOTIFICATION_DECISIONS);
export type NotificationDecision = z.infer<typeof notificationDecisionSchema>;

export interface ParameterRange {
	readonly min: number;
	readonly max: number;
	readonly defaultValue: number;
	readonly integer: boolean;
}

export const LOYALTY_PARAMETER_RANGES = {
	stampsPerCard: { min: 2, max: 20, defaultValue: 8, integer: true },
	stampMinBillAmount: {
		min: 0,
		max: 10_000_000,
		defaultValue: 50_000,
		integer: false,
	},
	welcomeStamps: { min: 0, max: 19, defaultValue: 2, integer: true },
	pointUnitAmount: {
		min: 1_000,
		max: 1_000_000,
		defaultValue: 10_000,
		integer: false,
	},
	pointsPerUnit: { min: 0, max: 100, defaultValue: 1, integer: true },
	stampValidityMonths: { min: 1, max: 36, defaultValue: 6, integer: true },
	pointsExpiryMonths: { min: 1, max: 60, defaultValue: 12, integer: true },
	earningInvoicesPerPhonePerDay: {
		min: 1,
		max: 20,
		defaultValue: 3,
		integer: true,
	},
	checkinWindowBeforeMinutes: {
		min: 0,
		max: 30,
		defaultValue: 2,
		integer: true,
	},
	checkinWindowAfterMinutes: {
		min: 1,
		max: 120,
		defaultValue: 15,
		integer: true,
	},
	checkinCodeTtlSeconds: {
		min: 30,
		max: 600,
		defaultValue: 120,
		integer: true,
	},
	checkinPendingHours: { min: 1, max: 168, defaultValue: 24, integer: true },
	receiptClaimWindowHours: {
		min: 1,
		max: 720,
		defaultValue: 72,
		integer: true,
	},
	receiptClaimsPerPhonePerDay: {
		min: 1,
		max: 20,
		defaultValue: 3,
		integer: true,
	},
	pointValueAmount: {
		min: 0,
		max: 1_000_000,
		defaultValue: 500,
		integer: false,
	},
	expectedBreakageRate: {
		min: 0,
		max: 0.9,
		defaultValue: 0.2,
		integer: false,
	},
} as const satisfies Record<string, ParameterRange>;

export type LoyaltyParameterName = keyof typeof LOYALTY_PARAMETER_RANGES;

function ranged(range: ParameterRange) {
	const base = range.integer ? z.number().int() : z.number().finite();
	return base.min(range.min).max(range.max).default(range.defaultValue);
}

const R = LOYALTY_PARAMETER_RANGES;

export const MAX_EXCLUDED_ORDER_SOURCES = 50;

export const loyaltyParametersSchema = z
	.object({
		stampsPerCard: ranged(R.stampsPerCard),
		stampMinBillAmount: ranged(R.stampMinBillAmount),
		welcomeStamps: ranged(R.welcomeStamps),
		pointUnitAmount: ranged(R.pointUnitAmount),
		pointsPerUnit: ranged(R.pointsPerUnit),
		stampValidityMonths: ranged(R.stampValidityMonths),
		pointsExpiryMonths: ranged(R.pointsExpiryMonths),
		earningInvoicesPerPhonePerDay: ranged(R.earningInvoicesPerPhonePerDay),
		checkinWindowBeforeMinutes: ranged(R.checkinWindowBeforeMinutes),
		checkinWindowAfterMinutes: ranged(R.checkinWindowAfterMinutes),
		checkinCodeTtlSeconds: ranged(R.checkinCodeTtlSeconds),
		checkinPendingHours: ranged(R.checkinPendingHours),
		receiptClaimWindowHours: ranged(R.receiptClaimWindowHours),
		receiptClaimsPerPhonePerDay: ranged(R.receiptClaimsPerPhonePerDay),
		excludedOrderSources: z
			.array(z.string().trim().min(1).max(100))
			.max(MAX_EXCLUDED_ORDER_SOURCES)
			.default([]),
		pointValueAmount: ranged(R.pointValueAmount),
		expectedBreakageRate: ranged(R.expectedBreakageRate),
	})
	.refine((value) => value.welcomeStamps < value.stampsPerCard, {
		message: "welcomeStamps is below stampsPerCard",
		path: ["welcomeStamps"],
	});
export type LoyaltyParameters = z.infer<typeof loyaltyParametersSchema>;

export const DEFAULT_LOYALTY_PARAMETERS: LoyaltyParameters =
	loyaltyParametersSchema.parse({});

export function hasControlCharacter(text: string): boolean {
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
			return true;
		}
	}
	return false;
}

const plainText = (max: number) =>
	z
		.string()
		.trim()
		.min(1)
		.max(max)
		.refine((text) => !hasControlCharacter(text), {
			message: "plain text without control characters",
		});

export const loyaltyProgrammeSchema = z
	.object({
		name: plainText(120),
		startsOn: isoDate,
		endsOn: isoDate.nullable().default(null),
		rewardBudgetAmount: z.number().finite().min(0).default(0),
		status: loyaltyProgrammeStatusSchema.default("draft"),
		notificationDecision: notificationDecisionSchema.default("pending"),
		notificationBasis: plainText(500).nullable().default(null),
		parameters: loyaltyParametersSchema.default(DEFAULT_LOYALTY_PARAMETERS),
	})
	.refine((value) => value.endsOn === null || value.endsOn >= value.startsOn, {
		message: "a programme ends on or after the day it starts",
		path: ["endsOn"],
	})
	.refine(
		(value) =>
			value.notificationDecision !== "not_required" ||
			value.notificationBasis !== null,
		{
			message: "a not_required decision needs its legal basis",
			path: ["notificationBasis"],
		},
	)
	.refine(
		(value) =>
			value.status !== "active" || value.notificationDecision !== "pending",
		{
			message:
				"a programme cannot become active while its notification decision is pending",
			path: ["status"],
		},
	);
export type LoyaltyProgramme = z.infer<typeof loyaltyProgrammeSchema>;

export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
export const e164PhoneSchema = z.string().regex(E164_PATTERN);

export const COUPON_RAILS = [
	"crm_code_pool",
	"crm_callback",
	"pos_payment_discount",
] as const;
export const couponRailKindSchema = z.enum(COUPON_RAILS);
export type CouponRailKind = z.infer<typeof couponRailKindSchema>;

export const EINVOICE_DISPLAYS = ["discount", "zero_price_line"] as const;
export const einvoiceDisplaySchema = z.enum(EINVOICE_DISPLAYS);
export type EinvoiceDisplay = z.infer<typeof einvoiceDisplaySchema>;

export const COUPON_CODE_STATES = [
	"available",
	"assigned",
	"used",
	"quarantined",
	"expired",
] as const;
export const couponCodeStateSchema = z.enum(COUPON_CODE_STATES);
export type CouponCodeState = z.infer<typeof couponCodeStateSchema>;

export const REWARD_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const rewardKeySchema = z.string().regex(REWARD_KEY_PATTERN);

const externalReference = z.string().trim().min(1).max(100);

export const couponRailSchema = z.object({
	storeId: z.uuid(),
	rail: couponRailKindSchema,
	crmProgrammeExternalIds: z.array(externalReference).max(20).default([]),
	callbackIpAllowlist: z.array(z.string().min(1)).max(20).default([]),
	activeFrom: z.iso.datetime({ offset: true }),
});
export type CouponRail = z.infer<typeof couponRailSchema>;

export const couponRailRewardSchema = z
	.object({
		storeId: z.uuid(),
		rewardKey: rewardKeySchema,
		posDiscountName: z.string().trim().min(1).max(200).nullable().default(null),
		posFreeItemExternalId: externalReference.nullable().default(null),
		crmProgrammeExternalId: externalReference.nullable().default(null),
		einvoiceDisplay: einvoiceDisplaySchema,
		active: z.boolean().default(true),
	})
	.refine(
		(value) =>
			value.posDiscountName !== null ||
			value.posFreeItemExternalId !== null ||
			value.crmProgrammeExternalId !== null,
		{ message: "a mapping names the POS side of the reward" },
	)
	.refine(
		(value) =>
			value.einvoiceDisplay !== "zero_price_line" ||
			value.posFreeItemExternalId !== null,
		{
			message: "a 0-price line needs the free item",
			path: ["posFreeItemExternalId"],
		},
	);
export type CouponRailReward = z.infer<typeof couponRailRewardSchema>;

export const LOYALTY_ENTRY_KINDS = [
	"earn",
	"confirm",
	"clawback",
	"redeem",
	"adjust",
	"expire",
] as const;
export const loyaltyEntryKindSchema = z.enum(LOYALTY_ENTRY_KINDS);
export type LoyaltyEntryKind = z.infer<typeof loyaltyEntryKindSchema>;

export const MATCHED_PATHS = ["A", "B", "C", "D", "E"] as const;
export const matchedPathSchema = z.enum(MATCHED_PATHS);
export type MatchedPath = z.infer<typeof matchedPathSchema>;

export const LOYALTY_REFUSAL_REASONS = [
	"below_minimum",
	"daily_cap",
	"excluded_phone",
	"excluded_source",
	"already_earned",
	"invoice_not_completed",
	"programme_inactive",
	"membership_inactive",
] as const;
export const loyaltyRefusalReasonSchema = z.enum(LOYALTY_REFUSAL_REASONS);
export type LoyaltyRefusalReason = z.infer<typeof loyaltyRefusalReasonSchema>;

const INVOICE_KINDS: readonly LoyaltyEntryKind[] = [
	"earn",
	"confirm",
	"clawback",
];
const NON_POSITIVE_KINDS: readonly LoyaltyEntryKind[] = [
	"clawback",
	"redeem",
	"expire",
];

export const loyaltyLedgerEntrySchema = z
	.object({
		entryKind: loyaltyEntryKindSchema,
		stampDelta: z.number().int().default(0),
		pointDelta: z.number().int().default(0),
		valueAmount: z.number().finite().default(0),
		invoiceId: z.uuid().nullable().default(null),
		matchedPath: matchedPathSchema.nullable().default(null),
		pending: z.boolean().default(false),
		sourceEntryId: z.uuid().nullable().default(null),
		reason: z.string().trim().min(1).max(200).nullable().default(null),
	})
	.refine(
		(entry) =>
			!INVOICE_KINDS.includes(entry.entryKind) || entry.invoiceId !== null,
		{ message: "earn, confirm and clawback rows name their invoice" },
	)
	.refine(
		(entry) => (entry.entryKind === "earn") === (entry.matchedPath !== null),
		{ message: "an earn, and only an earn, records its matched path" },
	)
	.refine(
		(entry) =>
			!["confirm", "clawback"].includes(entry.entryKind) ||
			entry.sourceEntryId !== null,
		{ message: "a confirm or clawback names the row it refers to" },
	)
	.refine(
		(entry) =>
			!["adjust", "clawback"].includes(entry.entryKind) ||
			entry.reason !== null,
		{ message: "an adjustment or clawback states its reason" },
	)
	.refine(
		(entry) => !entry.pending || ["earn", "redeem"].includes(entry.entryKind),
		{ message: "only an earn or a redemption waits for confirmation" },
	)
	.refine(
		(entry) =>
			entry.entryKind !== "earn" ||
			(entry.stampDelta >= 0 && entry.pointDelta >= 0),
		{ message: "an earn never takes stamps or points away" },
	)
	.refine(
		(entry) =>
			entry.entryKind !== "confirm" ||
			(entry.stampDelta === 0 && entry.pointDelta === 0),
		{ message: "a confirm row moves nothing" },
	)
	.refine(
		(entry) =>
			!NON_POSITIVE_KINDS.includes(entry.entryKind) ||
			(entry.stampDelta <= 0 && entry.pointDelta <= 0),
		{ message: "a clawback, redemption or expiry never adds" },
	);
export type LoyaltyLedgerEntry = z.infer<typeof loyaltyLedgerEntrySchema>;
