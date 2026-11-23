import type {
	LoyaltyEntryKind,
	LoyaltyParameters,
	LoyaltyProgrammeStatus,
	LoyaltyRefusalReason,
	MatchedPath,
	NotificationDecision,
} from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
import type { PrivacySource } from "../privacy/source";
import {
	type AuditEntry,
	type SettingsWriteCode,
	SettingsWriteError,
} from "../settings/source";

export const PROGRAMME_TEXT_FIELDS = [
	"name",
	"startsOn",
	"endsOn",
	"rewardBudgetAmount",
	"status",
	"notificationDecision",
	"notificationBasis",
	"notificationDecidedOn",
] as const;

export type ProgrammeTextField = (typeof PROGRAMME_TEXT_FIELDS)[number];

export type ProgrammeField = ProgrammeTextField | keyof LoyaltyParameters;

export interface LoyaltyProgrammeRecord {
	readonly id: string;
	readonly name: string;
	readonly startsOn: IsoDate;
	readonly endsOn: IsoDate | null;
	readonly rewardBudgetAmount: number;
	readonly status: LoyaltyProgrammeStatus;
	readonly notificationDecision: NotificationDecision;
	readonly notificationDecidedAt: string | null;
	readonly notificationBasis: string | null;
	readonly parameters: LoyaltyParameters;
	readonly createdAt: string;
	readonly audit: AuditEntry | null;
}

export interface LoyaltyProgrammeChange {
	readonly id: string | null;
	readonly name: string;
	readonly startsOn: IsoDate;
	readonly endsOn: IsoDate | null;
	readonly rewardBudgetAmount: number;
	readonly status: LoyaltyProgrammeStatus;
	readonly notificationDecision: NotificationDecision;
	readonly notificationBasis: string | null;
	readonly notificationDecidedAt: string | null;
	readonly parameters: LoyaltyParameters;
}

export interface StaffPhoneRow {
	readonly id: string;
	readonly phone: string;
	readonly label: string | null;
	readonly createdAt: string;
}

export interface StaffPhoneChange {
	readonly phone: string;
	readonly label: string | null;
}

export const CONFIRMATION_MODES = ["pos_sync", "staff"] as const;

/** What confirms a loyalty earn or redemption at a store (loyalty_store_settings.confirmation). */
export type ConfirmationMode = (typeof CONFIRMATION_MODES)[number];

export const SILENCE_OUTCOMES = ["reverse", "confirm"] as const;

export type SilenceOutcome = (typeof SILENCE_OUTCOMES)[number];

export const BILL_READER_MODES = ["off", "mock"] as const;

export type BillReaderMode = (typeof BILL_READER_MODES)[number];

export const EVIDENCE_LEVELS = [0, 1, 2] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** The owner's knobs of one store's loyalty confirmation, in the units the database keeps. */
export interface LoyaltyStoreKnobs {
	readonly confirmation: ConfirmationMode;
	readonly maxBillAmount: number;
	readonly billEvidenceRequiredLevel: EvidenceLevel;
	readonly billManagerApprovalAbove: number;
	readonly billAmountTolerance: number;
	readonly billUnconfirmedHours: number;
	readonly billSilenceOutcome: SilenceOutcome;
	readonly billStaffShiftCap: number;
	readonly staffAmountPerDay: number;
	readonly storeEarnsPerDay: number;
	readonly staffRedemptionsPerDay: number;
	readonly reverseWindowMinutes: number;
	readonly billAuditSamplePct: number;
	readonly selfClaim: boolean;
	readonly counterCodeTtlSeconds: number;
	readonly autoApproveMaxAmount: number;
	readonly autoApprovePerDay: number;
	readonly billPhotoRetentionDays: number;
	readonly billReaderMode: BillReaderMode;
	readonly shadowReconcile: boolean;
}

export type LoyaltyStoreKnob = keyof LoyaltyStoreKnobs;

/** One row of loyalty_store_settings (never the tenant or the author). */
export interface LoyaltyStoreSettings extends LoyaltyStoreKnobs {
	readonly storeId: string;
	readonly updatedAt: string;
}

/** The knobs to change; set_loyalty_store_settings takes a partial object. */
export type LoyaltyStoreSettingsChange = Partial<LoyaltyStoreKnobs>;

export const BILL_ANOMALY_FLAGS = [
	"peer_outlier",
	"disagreements",
	"disputes",
	"timeouts",
	"one_member",
	"amount_outliers",
	"audit_failed",
	"burst",
] as const;

export type BillAnomalyFlag = (typeof BILL_ANOMALY_FLAGS)[number];

/**
 * One row of bill_anomaly_report: a store's business day and one staff
 * member (null: counter claims approved automatically). Staff names only,
 * never a phone. Flags the browser does not know yet are kept as text.
 */
export interface BillAnomalyRow {
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly staffUserId: string | null;
	readonly staffName: string | null;
	readonly bills: number;
	readonly billsTotal: number;
	readonly level0: number;
	readonly level2: number;
	readonly confirmed: number;
	readonly queued: number;
	readonly disagreements: number;
	readonly disputes: number;
	readonly timedOut: number;
	readonly reversals: number;
	readonly auditsFailed: number;
	readonly redemptionsConfirmed: number;
	readonly topMemberShare: number | null;
	readonly amountOutliers: number;
	readonly maxBillsInHour: number | null;
	readonly peerMedianBills: number | null;
	readonly flags: readonly string[];
}

export interface LoyaltySource {
	readonly kind: "supabase" | "demo";
	programmes(tenantId: string): Promise<LoyaltyProgrammeRecord[]>;
	saveProgramme(
		tenantId: string,
		change: LoyaltyProgrammeChange,
	): Promise<LoyaltyProgrammeRecord>;
	staffPhones(tenantId: string): Promise<StaffPhoneRow[]>;
	addStaffPhone(
		tenantId: string,
		change: StaffPhoneChange,
	): Promise<StaffPhoneRow>;
	removeStaffPhone(tenantId: string, id: string): Promise<void>;
	/** The confirmation settings of the given stores the caller may read (RLS leaves the others out). */
	storeSettings(
		tenantId: string,
		storeIds: readonly string[],
	): Promise<LoyaltyStoreSettings[]>;
	/** An owner of the store changes some knobs; returns the whole row. */
	saveStoreSettings(
		tenantId: string,
		storeId: string,
		change: LoyaltyStoreSettingsChange,
	): Promise<LoyaltyStoreSettings>;
	/** bill_anomaly_report for owners and managers; other stores are left out silently. */
	billAnomalies(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<BillAnomalyRow[]>;
}

export const MEMBERSHIP_STATUSES = ["active", "suspended", "closed"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * A member's balance as the database computes it (loyalty_members_page,
 * loyalty_member_lookup): over the ledger rows of the stores in the caller's
 * scope and the rows without a store, so a manager limited to some stores
 * may see less than the member's whole balance.
 */
export interface Balance {
	readonly stamps: number;
	readonly points: number;
	readonly pendingStamps: number;
	readonly pendingPoints: number;
	readonly lastVisit: IsoDate | null;
}

export interface MemberRow {
	readonly membershipId: string;
	readonly tenantId: string;
	readonly programmeId: string;
	/** Always masked by the database: four and three dots and the last three digits. */
	readonly phoneMasked: string | null;
	/** The E.164 phone, only in an owner's lookup result; null everywhere else. */
	readonly phoneFull: string | null;
	readonly joinedAt: string;
	readonly status: MembershipStatus;
	readonly channel: string;
	readonly balance: Balance;
}

/** The page_key of the last row of a page, opaque to the browser. */
export type MemberCursor = string;

export interface MemberPage {
	readonly rows: readonly MemberRow[];
	readonly next: MemberCursor | null;
}

export interface InvoiceReference {
	readonly id: string;
	readonly externalId: string;
	readonly receiptNo: string | null;
	readonly businessDate: IsoDate;
	readonly soldAt: string;
	readonly netAmount: number;
	readonly shiftExternalId: string | null;
}

export interface LedgerEntryRow {
	readonly id: string;
	readonly membershipId: string;
	readonly storeId: string | null;
	readonly entryKind: LoyaltyEntryKind;
	readonly stampDelta: number;
	readonly pointDelta: number;
	readonly valueAmount: number;
	readonly invoice: InvoiceReference | null;
	readonly businessDate: IsoDate | null;
	readonly matchedPath: MatchedPath | null;
	readonly pending: boolean;
	readonly sourceEntryId: string | null;
	readonly reason: string | null;
	readonly occurredAt: string;
	readonly expiresAt: string | null;
}

export const QUEUE_STATES = ["open", "resolved", "dismissed"] as const;

export type QueueState = (typeof QUEUE_STATES)[number];

export const QUEUE_REASONS = ["two_candidates", "duplicate_receipt"] as const;

export type QueueReason = (typeof QUEUE_REASONS)[number];

export interface QueueItemRow {
	readonly id: string;
	readonly storeId: string;
	readonly membershipId: string;
	readonly phoneMasked: string | null;
	readonly matchedPath: "B" | "C";
	readonly reason: QueueReason;
	readonly state: QueueState;
	readonly createdAt: string;
	readonly resolvedAt: string | null;
	readonly resolvedBy: string | null;
	readonly chosenInvoiceId: string | null;
	readonly resolutionReason: string | null;
	readonly entryId: string | null;
	readonly checkin: {
		readonly recordedAt: string | null;
		readonly amount: number | null;
	} | null;
	readonly claim: {
		readonly receiptNo: string;
		readonly amount: number;
		readonly businessDate: IsoDate;
	} | null;
	readonly candidateIds: readonly string[];
	readonly candidates: readonly InvoiceReference[];
}

/**
 * The path D items of the manager queue (G-100): where the vouchers and the POS discounts of the redemption fallback
 * rails disagree. No member, no candidates; the page only lists them.
 */
export const RECONCILIATION_REASONS = [
	"verified_without_invoice",
	"discount_without_redemption",
	"amount_mismatch",
] as const;

export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number];

export interface ReconciliationItemRow {
	readonly id: string;
	readonly storeId: string;
	readonly reason: ReconciliationReason;
	readonly state: QueueState;
	readonly createdAt: string;
	readonly resolvedAt: string | null;
	/** The POS discount entry name: the reward's entry for a redemption, else the bill's discount name. Never a code. */
	readonly entryName: string | null;
	/** The receipt number of the invoice the item is about, when it is about one. */
	readonly receiptNo: string | null;
	readonly soldAt: string | null;
}

export interface QueueResolution {
	readonly itemId: string;
	readonly choice: string | null;
	readonly reason: string;
}

export interface QueueOutcome {
	readonly state: "resolved" | "dismissed";
	readonly entryId: string | null;
	readonly refusal: LoyaltyRefusalReason | null;
}

/**
 * One row of loyalty_shift_anomalies: the counts of a store's shift (Ca n,
 * null for events outside every shift) on a business date. Never a cashier
 * name or the POS shift label.
 */
export interface ShiftAnomaly {
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly shiftNumber: number | null;
	readonly earns: number;
	readonly refusals: Readonly<Partial<Record<LoyaltyRefusalReason, number>>>;
	readonly refusalsTotal: number;
	readonly adjustments: number;
	readonly checkinsWithoutInvoice: number;
}

export interface CustomerMetrics {
	readonly invoices: number;
	readonly identifiedInvoices: number;
	readonly captureRate: number | null;
	readonly customers: number;
	readonly repeatCustomers: number;
	readonly repeatRate: number | null;
	readonly activeCustomers30d: number;
	readonly visitFrequency30d: number | null;
	readonly activeCustomers90d: number;
	readonly visitFrequency90d: number | null;
	readonly outstandingPoints: number | null;
	readonly liability: number | null;
	readonly breakageRate: number | null;
	readonly memberRevenue: number;
	readonly rewardsRedeemedValue: number | null;
	readonly rewardCostRate: number | null;
	readonly memberCustomers: number;
	readonly comparisonCustomers: number;
	readonly memberVisitFrequency: number | null;
	readonly comparisonVisitFrequency: number | null;
	readonly uplift: number | null;
	readonly upliftComparison: string;
}

export const RFM_SEGMENTS = [
	"champions",
	"loyal",
	"new",
	"promising",
	"at_risk",
	"hibernating",
	"lost",
] as const;

export type RfmSegment = (typeof RFM_SEGMENTS)[number];

export interface RfmSegmentRow {
	readonly segment: RfmSegment;
	readonly customers: number;
	readonly share: number;
}

export interface CohortRetentionRow {
	readonly cohortMonth: IsoDate;
	readonly monthOffset: number;
	readonly cohortSize: number;
	readonly retained: number;
	readonly retention: number | null;
}

export interface CustomerSource {
	/** Aggregates only: no phone, name or customer id comes back. */
	metrics(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<CustomerMetrics>;
	rfm(storeIds: readonly string[], asOf: IsoDate): Promise<RfmSegmentRow[]>;
	cohorts(
		storeIds: readonly string[],
		firstMonth: IsoDate,
		months: number,
		asOf: IsoDate,
	): Promise<CohortRetentionRow[]>;
	readonly privacy: PrivacySource;
	readonly kind: "supabase";
	/** The tenant's members, masked, newest first; storeIds are the tenant's stores in the caller's scope. */
	members(
		storeIds: readonly string[],
		after: MemberCursor | null,
		pageSize: number,
	): Promise<MemberPage>;
	/** Sent in a POST body; the full phone comes back for an owner only. */
	lookup(tenantId: string, phone: string): Promise<MemberRow[]>;
	member(
		storeIds: readonly string[],
		membershipId: string,
	): Promise<MemberRow | null>;
	ledger(membershipIds: readonly string[]): Promise<LedgerEntryRow[]>;
	queue(tenantId: string): Promise<QueueItemRow[]>;
	reconciliation(tenantId: string): Promise<ReconciliationItemRow[]>;
	resolveQueueItem(resolution: QueueResolution): Promise<QueueOutcome>;
	anomalies(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<ShiftAnomaly[]>;
}

export class LoyaltyWriteError extends SettingsWriteError {
	readonly field: ProgrammeField | null;
	readonly hold: boolean;

	constructor(
		code: SettingsWriteCode,
		field: ProgrammeField | null,
		hold = false,
	) {
		super(code, field);
		this.name = "LoyaltyWriteError";
		this.field = field;
		this.hold = hold;
	}
}
