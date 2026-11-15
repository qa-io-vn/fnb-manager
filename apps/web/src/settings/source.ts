import type { IsoDate, ReportSettings } from "@fnb/reports";

export type TenantRole = "owner" | "manager" | "staff" | "viewer" | "publisher";

export type ItemTypeRole = "drink" | "topping" | "food" | "snack" | "other";

export const ITEM_TYPE_ROLES: readonly ItemTypeRole[] = [
	"drink",
	"topping",
	"food",
	"snack",
	"other",
];

export interface Membership {
	readonly role: TenantRole;
	readonly storeIds: readonly string[] | null;
}

export interface ItemTypeEntry {
	readonly posAccountId: string;
	readonly posAccountName: string;
	readonly itemTypeExternalId: string;
	readonly name: string;
	readonly role: ItemTypeRole | null;
}

export interface RoleChange {
	readonly posAccountId: string;
	readonly itemTypeExternalId: string;
	readonly role: ItemTypeRole;
}

export type AuditAuthor =
	| { readonly kind: "you" }
	| { readonly kind: "member"; readonly role: TenantRole }
	| { readonly kind: "unknown" };

export interface AuditEntry {
	readonly changedAt: string;
	readonly author: AuditAuthor;
}

export interface MemberRoleRow {
	readonly userId: string;
	readonly role: TenantRole;
}

export function auditAuthorOf(
	updatedBy: string | null,
	currentUserId: string | null,
	members: readonly MemberRoleRow[],
): AuditAuthor {
	if (updatedBy === null) return { kind: "unknown" };
	if (updatedBy === currentUserId) return { kind: "you" };
	const member = members.find((row) => row.userId === updatedBy);
	return member === undefined
		? { kind: "unknown" }
		: { kind: "member", role: member.role };
}

export interface ReportSettingsState {
	readonly settings: ReportSettings;
	readonly hasRow: boolean;
	readonly audit: AuditEntry | null;
}

export interface CatchUpStatus {
	readonly pendingFrom: IsoDate | null;
	readonly pendingTo: IsoDate | null;
	readonly pendingDays: number;
	readonly canRefresh: boolean;
}

export interface SettingsSource {
	readonly kind: "supabase" | "demo";
	membership(tenantId: string): Promise<Membership | null>;
	itemTypes(tenantId: string): Promise<ItemTypeEntry[]>;
	saveRoles(tenantId: string, changes: readonly RoleChange[]): Promise<void>;
	reportSettings(tenantId: string): Promise<ReportSettingsState>;
	saveReportSettings(
		tenantId: string,
		changes: Partial<ReportSettings>,
	): Promise<void>;
	catchUpStatus(tenantId: string): Promise<CatchUpStatus>;
	refreshChunk(tenantId: string): Promise<CatchUpStatus>;
}

export type SettingsWriteCode =
	| "forbidden"
	| "duplicate"
	| "invalid"
	| "frozen"
	| "network";

export class SettingsWriteError extends Error {
	readonly code: SettingsWriteCode;
	readonly constraint: string | null;

	constructor(code: SettingsWriteCode, constraint: string | null = null) {
		super(`settings write refused: ${code}`);
		this.name = "SettingsWriteError";
		this.code = code;
		this.constraint = constraint;
	}
}

export const NO_CATCH_UP: CatchUpStatus = {
	pendingFrom: null,
	pendingTo: null,
	pendingDays: 0,
	canRefresh: false,
};
