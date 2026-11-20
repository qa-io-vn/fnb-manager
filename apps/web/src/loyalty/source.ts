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

export interface CustomerSource {
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
