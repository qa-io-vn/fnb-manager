import type {
	LoyaltyEntryKind,
	LoyaltyParameters,
	LoyaltyProgrammeStatus,
	LoyaltyRefusalReason,
	MatchedPath,
	NotificationDecision,
} from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
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

export interface MemberRow {
	readonly membershipId: string;
	readonly programmeId: string;
	readonly phone: string | null;
	readonly joinedAt: string;
	readonly status: MembershipStatus;
	readonly channel: string;
}

export interface MemberCursor {
	readonly joinedAt: string;
	readonly membershipId: string;
}

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
	readonly phone: string | null;
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

export interface ShiftRow {
	readonly id: string;
	readonly storeId: string;
	readonly externalId: string;
	readonly openedAt: string;
	readonly closedAt: string | null;
}

export interface EarnEvent {
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly matchedPath: MatchedPath | null;
	readonly shiftExternalId: string | null;
	readonly soldAt: string | null;
}

export interface RefusalEvent {
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly reason: LoyaltyRefusalReason;
	readonly shiftExternalId: string | null;
	readonly soldAt: string | null;
}

export interface TimedEvent {
	readonly storeId: string;
	readonly at: string;
}

export interface AnomalyInputs {
	readonly shifts: readonly ShiftRow[];
	readonly earns: readonly EarnEvent[];
	readonly refusals: readonly RefusalEvent[];
	readonly adjustments: readonly TimedEvent[];
	readonly checkinsWithoutInvoice: readonly TimedEvent[];
}

export interface CustomerSource {
	readonly kind: "supabase";
	members(
		tenantId: string,
		after: MemberCursor | null,
		pageSize: number,
	): Promise<MemberPage>;
	lookup(tenantId: string, phone: string): Promise<MemberRow[]>;
	member(membershipId: string): Promise<MemberRow | null>;
	ledger(membershipIds: readonly string[]): Promise<LedgerEntryRow[]>;
	queue(tenantId: string): Promise<QueueItemRow[]>;
	resolveQueueItem(resolution: QueueResolution): Promise<QueueOutcome>;
	anomalies(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<AnomalyInputs>;
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
