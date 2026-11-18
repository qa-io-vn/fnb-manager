import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../../data/paginate";
import { SettingsWriteError } from "../source";
import {
	type AuditOf,
	createSupabaseAudits,
	type PostgrestFailure,
	writeErrorOf,
} from "../supabase-common";
import {
	PAIRING_CODE_PATTERN,
	PAIRING_CODE_TTL_MS,
	type PairingCode,
	STAFF_REVENUE_VISIBILITIES,
	STAFF_ROLES,
	STAFF_STATUSES,
	type StaffApp,
	type StaffChange,
	type StaffMember,
	type StaffRevenueVisibility,
	type StaffSettingsSource,
} from "./source";

const rosterRow = z.object({
	id: z.string(),
	display_name: z.string(),
	role: z.enum(STAFF_ROLES),
	store_ids: z.array(z.string()).nullable(),
	status: z.enum(STAFF_STATUSES),
	user_id: z.string().nullable(),
	paired_at: z.string().nullable(),
	phone_hint: z.string().nullable(),
	deactivated_at: z.string().nullable(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

export const ROSTER_SELECT =
	"id,display_name,role,store_ids,status,user_id,paired_at,phone_hint,deactivated_at,updated_at,updated_by";

const identityRow = z.object({ id: z.string(), user_id: z.string() });

export const IDENTITY_SELECT = "id,user_id";

const visibility = z.enum(STAFF_REVENUE_VISIBILITIES);

const visibilityRow = z.object({ staff_revenue_visibility: visibility });

const staffAppRow = z.object({
	brand_id: z.string(),
	external_id: z.string(),
	title: z.string(),
	brands: z.object({ store_ids: z.array(z.string()) }),
});

export const STAFF_APP_SELECT = "brand_id,external_id,title,brands(store_ids)";

function memberOf(
	row: z.output<typeof rosterRow>,
	auditOf: AuditOf,
	pairedUsers: ReadonlySet<string>,
): StaffMember {
	return {
		id: row.id,
		displayName: row.display_name,
		role: row.role,
		storeIds: row.store_ids,
		status: row.status,
		paired:
			row.status === "active" &&
			row.user_id !== null &&
			pairedUsers.has(row.user_id),
		pairedAt: row.paired_at,
		phoneHint: row.phone_hint,
		deactivatedAt: row.deactivated_at,
		audit: auditOf(row.updated_at, row.updated_by),
	};
}

function staffAppOf(row: z.output<typeof staffAppRow>): StaffApp {
	return {
		brandId: row.brand_id,
		miniAppId: row.external_id,
		title: row.title,
		storeIds: row.brands.store_ids,
	};
}

export async function called<Value>(
	schema: z.ZodType<Value>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<Value> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
	return schema.parse(result.data);
}

function staffArguments(change: StaffChange) {
	return {
		p_display_name: change.displayName,
		p_role: change.role,
		p_store_ids: change.storeIds === null ? null : [...change.storeIds],
	};
}

export function createSupabaseStaffSource(
	client: SupabaseClient,
): StaffSettingsSource {
	const audits = createSupabaseAudits(client);
	return {
		kind: "supabase",

		async roster(tenantId): Promise<StaffMember[]> {
			const [rows, identities, auditsOf] = await Promise.all([
				fetchAllPages(rosterRow, (from, to) =>
					client
						.from("staff_roster")
						.select(ROSTER_SELECT)
						.eq("tenant_id", tenantId)
						.order("display_name")
						.order("id")
						.range(from, to),
				),
				fetchAllPages(identityRow, (from, to) =>
					client
						.from("zalo_identities")
						.select(IDENTITY_SELECT)
						.eq("tenant_id", tenantId)
						.order("id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			const pairedUsers = new Set(
				identities.map((identity) => identity.user_id),
			);
			return rows.map((row) => memberOf(row, auditsOf, pairedUsers));
		},

		addStaff(tenantId, change) {
			return called(
				z.string(),
				client.rpc("add_staff", {
					p_tenant_id: tenantId,
					...staffArguments(change),
				}),
			);
		},

		async updateStaff(_tenantId, rosterId, change) {
			await called(
				z.unknown(),
				client.rpc("update_staff", {
					p_roster_id: rosterId,
					...staffArguments(change),
				}),
			);
		},

		async deactivateStaff(_tenantId, rosterId) {
			await called(
				z.unknown(),
				client.rpc("deactivate_staff", { p_roster_id: rosterId }),
			);
		},

		async reactivateStaff(_tenantId, rosterId) {
			await called(
				z.unknown(),
				client.rpc("reactivate_staff", { p_roster_id: rosterId }),
			);
		},

		async staffRevenueVisibility(tenantId): Promise<StaffRevenueVisibility> {
			const [row] = await fetchOnce(
				visibilityRow,
				client
					.from("tenants")
					.select("staff_revenue_visibility")
					.eq("id", tenantId),
			);
			if (row === undefined) throw new Error("tenant not readable");
			return row.staff_revenue_visibility;
		},

		setStaffRevenueVisibility(tenantId, level) {
			return called(
				visibility,
				client.rpc("set_staff_revenue_visibility", {
					p_tenant_id: tenantId,
					p_visibility: level,
				}),
			);
		},

		async staffApps(tenantId): Promise<StaffApp[]> {
			const rows = await fetchOnce(
				staffAppRow,
				client
					.from("mini_apps")
					.select(STAFF_APP_SELECT)
					.eq("tenant_id", tenantId)
					.eq("kind", "staff")
					.order("brand_id"),
			);
			return rows.map(staffAppOf);
		},

		async issuePairingCode(_tenantId, rosterId): Promise<PairingCode> {
			const code = await called(
				z.string().regex(PAIRING_CODE_PATTERN),
				client.rpc("issue_pairing_code", { p_roster_id: rosterId }),
			);
			return {
				rosterId,
				code,
				expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString(),
			};
		},
	};
}
