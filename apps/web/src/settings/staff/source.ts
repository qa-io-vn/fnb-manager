import type { AuditEntry } from "../source";

export const STAFF_ROLES = ["staff", "manager"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_STATUSES = ["invited", "active", "inactive"] as const;

export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_REVENUE_VISIBILITIES = [
	"all",
	"store_totals",
	"none",
] as const;

export type StaffRevenueVisibility =
	(typeof STAFF_REVENUE_VISIBILITIES)[number];

export const DEFAULT_STAFF_REVENUE_VISIBILITY: StaffRevenueVisibility = "all";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const PAIRING_CODE_PATTERN = /^[0-9]{6}$/;

export interface StaffChange {
	readonly displayName: string;
	readonly role: StaffRole;
	readonly storeIds: readonly string[] | null;
}

export interface StaffMember extends StaffChange {
	readonly id: string;
	readonly status: StaffStatus;
	readonly paired: boolean;
	readonly pairedAt: string | null;
	readonly phoneHint: string | null;
	readonly deactivatedAt: string | null;
	readonly audit: AuditEntry | null;
}

export interface StaffApp {
	readonly brandId: string;
	readonly miniAppId: string;
	readonly title: string;
	readonly storeIds: readonly string[];
}

export interface PairingCode {
	readonly rosterId: string;
	readonly code: string;
	readonly expiresAt: string;
}

export interface StaffSettingsSource {
	readonly kind: "supabase" | "demo";
	roster(tenantId: string): Promise<StaffMember[]>;
	addStaff(tenantId: string, change: StaffChange): Promise<string>;
	updateStaff(
		tenantId: string,
		rosterId: string,
		change: StaffChange,
	): Promise<void>;
	deactivateStaff(tenantId: string, rosterId: string): Promise<void>;
	reactivateStaff(tenantId: string, rosterId: string): Promise<void>;
	staffRevenueVisibility(tenantId: string): Promise<StaffRevenueVisibility>;
	setStaffRevenueVisibility(
		tenantId: string,
		visibility: StaffRevenueVisibility,
	): Promise<StaffRevenueVisibility>;
	staffApps(tenantId: string): Promise<StaffApp[]>;
	issuePairingCode(tenantId: string, rosterId: string): Promise<PairingCode>;
}
