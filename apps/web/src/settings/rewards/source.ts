import type { IsoDate } from "../../lib/business-dates";
import {
	type AuditEntry,
	type SettingsWriteCode,
	SettingsWriteError,
} from "../source";

export const REWARD_KINDS = [
	"free_item",
	"percent_off",
	"amount_off",
	"free_upgrade",
] as const;

export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_STATUSES = [
	"draft",
	"approved",
	"active",
	"retired",
] as const;

export type RewardStatus = (typeof REWARD_STATUSES)[number];

export const COUPON_RAILS = [
	"pos_payment_discount",
	"crm_code_pool",
	"crm_callback",
] as const;

export type CouponRail = (typeof COUPON_RAILS)[number];

export const EINVOICE_DISPLAYS = ["discount", "zero_price_line"] as const;

export type EinvoiceDisplay = (typeof EINVOICE_DISPLAYS)[number];

export interface RewardTerms {
	readonly programmeId: string;
	readonly rewardKey: string;
	readonly name: string;
	readonly description: string | null;
	readonly rewardKind: RewardKind;
	readonly rewardPercent: number | null;
	readonly rewardAmount: number | null;
	readonly rewardItemExternalIds: readonly string[] | null;
	readonly excludedItemExternalIds: readonly string[];
	readonly costStamps: number;
	readonly costPoints: number;
	readonly minBillAmount: number;
	readonly validFrom: IsoDate | null;
	readonly validUntil: IsoDate | null;
	readonly validDays: number;
	readonly holdHours: number;
	readonly perMemberLimit: number | null;
	readonly storeIds: readonly string[] | null;
}

export type ApprovalAuthor =
	| { readonly kind: "you" }
	| { readonly kind: "owner" }
	| { readonly kind: "system" }
	| { readonly kind: "unknown" };

export interface RewardApproval {
	readonly at: string;
	readonly by: ApprovalAuthor;
}

export interface RewardRecord extends RewardTerms {
	readonly id: string;
	readonly status: RewardStatus;
	readonly approval: RewardApproval | null;
	readonly createdAt: string;
	readonly audit: AuditEntry | null;
}

export interface RewardChange extends RewardTerms {
	readonly id: string | null;
}

export interface RewardStatusChange {
	readonly id: string;
	readonly status: RewardStatus;
}

export type RewardField = keyof RewardTerms | "status";

export type RewardRefusal =
	| "cap"
	| "amountCap"
	| "minBillRequired"
	| "itemId"
	| "itemOverlap"
	| "retiredFinal"
	| "ownerApproves"
	| "noRail"
	| "noMapping"
	| "keepsMapping"
	| "duplicateKey"
	| "storeScope"
	| "value";

export interface StoreRail {
	readonly storeId: string;
	readonly rail: CouponRail;
	readonly activeFrom: string;
}

export interface RailRewardMapping {
	readonly storeId: string;
	readonly rewardKey: string;
	readonly posDiscountName: string | null;
	readonly posFreeItemExternalId: string | null;
	readonly crmProgrammeExternalId: string | null;
	readonly einvoiceDisplay: EinvoiceDisplay;
}

export interface RewardRails {
	readonly rails: readonly StoreRail[];
	readonly mappings: readonly RailRewardMapping[];
}

export interface DiscountDaysRow {
	readonly itemExternalId: string;
	readonly itemName: string | null;
	readonly priceDiscountDays: number;
	readonly giftDays: number;
	readonly voucherDays: number;
	readonly limitDays: number | null;
	readonly overLimit: boolean;
}

export interface RewardsSource {
	readonly kind: "supabase" | "demo";
	rewards(tenantId: string): Promise<RewardRecord[]>;
	rails(tenantId: string): Promise<RewardRails>;
	discountDays(
		tenantId: string,
		rewardId: string,
		year: number,
	): Promise<DiscountDaysRow[]>;
	saveReward(tenantId: string, change: RewardChange): Promise<RewardRecord>;
	setStatus(
		tenantId: string,
		change: RewardStatusChange,
	): Promise<RewardRecord>;
}

export class RewardWriteError extends SettingsWriteError {
	readonly refusal: RewardRefusal | null;

	constructor(
		code: SettingsWriteCode,
		field: RewardField | null,
		refusal: RewardRefusal | null = null,
	) {
		super(code, field);
		this.name = "RewardWriteError";
		this.refusal = refusal;
	}
}

export function refusalOf(error: unknown): RewardRefusal | null {
	return error instanceof RewardWriteError ? error.refusal : null;
}
