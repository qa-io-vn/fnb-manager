import type { SettingsWriteCode } from "../settings/source";

export const REQUEST_TYPES = [
	"access",
	"correction",
	"deletion",
	"export",
	"objection",
	"withdraw_consent",
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = [
	"received",
	"in_progress",
	"completed",
	"rejected",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const CONSENT_PURPOSES = ["loyalty", "marketing", "staff_ops"] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Purposes an owner or manager may revoke from the page. */
export const REVOCABLE_PURPOSES: readonly ConsentPurpose[] = [
	"loyalty",
	"marketing",
];

export type DueState = "done" | "overdue" | "due_soon" | "on_track";

export const DUE_SOON_DAYS = 3;

export interface ConsentRow {
	readonly id: string;
	readonly purpose: ConsentPurpose;
	readonly channel: string;
	readonly policyVersion: string;
	readonly grantedAt: string;
	readonly revokedAt: string | null;
	readonly active: boolean;
}

/**
 * One customer found by phone: counts and totals only, with the masked phone.
 * The customer id is what a request is attached to; the full phone never
 * reaches the browser.
 */
export interface SubjectSummary {
	readonly customerId: string;
	readonly tenantId: string;
	readonly name: string | null;
	readonly phoneMasked: string;
	readonly firstSeenAt: string;
	readonly memberships: number;
	readonly ledgerEntries: number;
	readonly stampTotal: number;
	readonly pointTotal: number;
	readonly consents: readonly ConsentRow[];
	readonly messages: number;
	readonly openRequests: number;
}

export interface DataRequestRow {
	readonly id: string;
	readonly subjectType: "customer" | "staff";
	readonly subjectId: string | null;
	readonly contact: string;
	readonly requestType: RequestType;
	readonly receivedAt: string;
	readonly usesProcessor: boolean;
	readonly firstResponseDueAt: string;
	readonly completionDueAt: string;
	readonly status: RequestStatus;
	readonly respondedAt: string | null;
	readonly completedAt: string | null;
	readonly notes: string | null;
}

export interface NewRequest {
	readonly requestType: RequestType;
	readonly subjectId: string | null;
	readonly contact: string;
	readonly usesProcessor: boolean;
	readonly notes: string | null;
}

export interface RequestClosure {
	readonly requestId: string;
	readonly status: "completed" | "rejected";
	readonly notes: string | null;
}

export interface DueRow {
	readonly requestId: string;
	readonly requestType: RequestType;
	readonly firstResponseState: DueState;
	readonly completionState: DueState;
}

export const EXPORT_TABLES = [
	"invoices",
	"memberships",
	"loyalty_ledger",
	"stamps",
	"receipt_claims",
	"redemptions",
	"consent_records",
	"messages",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export interface SubjectExport {
	readonly counts: Readonly<Record<ExportTable, number>>;
	/** The JSON as the database built it, handed over privately as a file. */
	readonly json: string;
}

export const DELETION_TABLES = [
	"memberships",
	"loyalty_ledger",
	"stamps",
	"redemptions",
	"receipt_claims",
	"pending_checkins",
	"loyalty_queue",
	"loyalty_refusals",
	"loyalty_requests",
	"coupon_codes_quarantined",
	"redemption_invoices_settled",
	"consent_records",
	"outbound_messages_redacted",
	"invoices_unlinked",
	"customer_logins",
	"auth_users",
	"customers",
] as const;

export type DeletionTable = (typeof DELETION_TABLES)[number];

export interface DeletionResult {
	readonly alreadyDone: boolean;
	readonly counts: Readonly<Record<DeletionTable, number>>;
	readonly respondedOnTime: boolean;
	readonly completedOnTime: boolean;
}

export interface CorrectionResult {
	readonly changed: boolean;
	readonly status: RequestStatus;
}

export interface PrivacySource {
	/** The phone goes in a POST body; owners and managers with every store only. */
	lookupSubjects(phone: string): Promise<SubjectSummary[]>;
	requests(tenantId: string): Promise<DataRequestRow[]>;
	dueSoon(days: number): Promise<DueRow[]>;
	recordRequest(tenantId: string, change: NewRequest): Promise<DataRequestRow>;
	closeRequest(closure: RequestClosure): Promise<void>;
	exportSubject(requestId: string): Promise<SubjectExport>;
	correctName(requestId: string, name: string): Promise<CorrectionResult>;
	deletionPreview(requestId: string): Promise<DeletionPreview>;
	deleteSubject(requestId: string): Promise<DeletionResult>;
	revokeConsent(consentId: string): Promise<void>;
}

export type PrivacyErrorCode = SettingsWriteCode;

export const PREVIEW_TABLES = [
	"memberships",
	"loyalty_ledger",
	"stamps",
	"redemptions",
	"receipt_claims",
	"consent_records",
	"outbound_messages",
	"invoices_unlinked",
] as const;

export type PreviewTable = (typeof PREVIEW_TABLES)[number];

export type DeletionPreview = Readonly<Record<PreviewTable, number>>;
