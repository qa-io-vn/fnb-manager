import {
	addDays,
	DEFAULT_REPORT_SETTINGS,
	isDefaultReportSettings,
	minDate,
	REPORT_SETTINGS_COLUMNS,
	type ReportSettings,
	type ReportSettingsColumn,
} from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../data/paginate";
import {
	type AuditAuthor,
	type AuditEntry,
	auditAuthorOf,
	type CatchUpStatus,
	ITEM_TYPE_ROLES,
	type ItemTypeEntry,
	type MemberRoleRow,
	type Membership,
	NO_CATCH_UP,
	type ReportSettingsState,
	type RoleChange,
	type SettingsSource,
	SettingsWriteError,
} from "./source";

export const REFRESH_CHUNK_DAYS = 92;

const numeric = z.union([z.number(), z.string()]).transform(Number);

const tenantRole = z.enum(["owner", "manager", "staff", "viewer", "publisher"]);

const membershipRow = z.object({
	role: tenantRole,
	store_ids: z.array(z.string()).nullable(),
});

const memberRoleRow = z.object({ user_id: z.string(), role: tenantRole });

const itemTypeRow = z.object({
	pos_account_id: z.string(),
	external_id: z.string(),
	name: z.string(),
	pos_accounts: z.object({ display_name: z.string() }),
});

const roleRow = z.object({
	pos_account_id: z.string(),
	item_type_external_id: z.string(),
	role: z.enum(ITEM_TYPE_ROLES as [string, ...string[]]),
});

const settingsRow = z.object({
	menu_window_days: numeric,
	menu_popularity_factor: numeric,
	menu_low_sample_items: numeric,
	cash_abs_threshold: numeric,
	cash_rel_threshold: numeric,
	peak_hours: numeric,
	dead_hour_ratio: numeric,
	busy_hour_ratio: numeric,
	promo_pre_weeks: numeric,
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const SETTINGS_SELECT =
	"menu_window_days,menu_popularity_factor,menu_low_sample_items,cash_abs_threshold,cash_rel_threshold,peak_hours,dead_hour_ratio,busy_hour_ratio,promo_pre_weeks,updated_at,updated_by";

const catchUpRow = z.object({
	pending_from: z.string().nullable(),
	pending_to: z.string().nullable(),
	pending_days: numeric,
	can_refresh: z.boolean(),
});

interface PostgrestFailure {
	readonly code?: string;
	readonly message?: string;
	readonly details?: string | null;
}

function constraintOf(error: PostgrestFailure): string | null {
	const text = `${error.message ?? ""} ${error.details ?? ""}`;
	return /constraint "([^"]+)"/.exec(text)?.[1] ?? null;
}

export function writeErrorOf(error: PostgrestFailure): SettingsWriteError {
	switch (error.code) {
		case "42501":
			return new SettingsWriteError("forbidden");
		case "23505":
			return new SettingsWriteError("duplicate", constraintOf(error));
		case "23514":
		case "22023":
			return new SettingsWriteError("invalid", constraintOf(error));
		case "55000":
			return new SettingsWriteError("frozen");
		default:
			if (error.code === undefined || error.code === "") {
				return new SettingsWriteError("network");
			}
			return error.code.startsWith("PGRST3")
				? new SettingsWriteError("forbidden")
				: new SettingsWriteError("invalid");
	}
}

async function written(
	request: PromiseLike<{ error: PostgrestFailure | null }>,
): Promise<void> {
	let result: { error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
}

async function writtenRows<Row>(
	schema: z.ZodType<Row>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<Row[]> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
	return z.array(schema).parse(result.data ?? []);
}

export type ReportSettingsColumns = { readonly tenant_id: string } & Readonly<
	Partial<Record<ReportSettingsColumn, number>>
>;

const SETTING_KEYS = Object.keys(
	REPORT_SETTINGS_COLUMNS,
) as (keyof ReportSettings)[];

export function settingsColumnsOf(
	tenantId: string,
	changes: Partial<ReportSettings>,
): ReportSettingsColumns {
	const columns: Partial<Record<ReportSettingsColumn, number>> = {};
	for (const key of SETTING_KEYS) {
		const value = changes[key];
		if (value !== undefined) columns[REPORT_SETTINGS_COLUMNS[key]] = value;
	}
	return { tenant_id: tenantId, ...columns };
}

function thresholdsOf(row: z.output<typeof settingsRow>): ReportSettings {
	return {
		menuWindowDays: row.menu_window_days,
		menuPopularityFactor: row.menu_popularity_factor,
		menuLowSampleItems: row.menu_low_sample_items,
		cashAbsThreshold: row.cash_abs_threshold,
		cashRelThreshold: row.cash_rel_threshold,
		peakHours: row.peak_hours,
		deadHourRatio: row.dead_hour_ratio,
		busyHourRatio: row.busy_hour_ratio,
		promoPreWeeks: row.promo_pre_weeks,
	};
}

function catchUpOf(
	rows: readonly z.output<typeof catchUpRow>[],
): CatchUpStatus {
	const row = rows[0];
	if (row === undefined) return NO_CATCH_UP;
	return {
		pendingFrom: row.pending_from,
		pendingTo: row.pending_to,
		pendingDays: row.pending_days,
		canRefresh: row.can_refresh,
	};
}

export function refreshWindow(
	status: CatchUpStatus,
): { from: string; to: string } | null {
	if (status.pendingFrom === null || status.pendingTo === null) return null;
	const end = addDays(status.pendingFrom, REFRESH_CHUNK_DAYS - 1);
	return {
		from: status.pendingFrom,
		to: minDate(end, status.pendingTo),
	};
}

export function createSupabaseSettingsSource(
	client: SupabaseClient,
): SettingsSource {
	const currentUserId = async (): Promise<string> => {
		const { data, error } = await client.auth.getUser();
		const userId = data.user?.id;
		if (error || userId === undefined) {
			throw new Error(error?.message ?? "not signed in");
		}
		return userId;
	};

	const catchUpStatus = async (tenantId: string): Promise<CatchUpStatus> =>
		catchUpOf(
			await fetchOnce(
				catchUpRow,
				client.rpc("analytics_catch_up_status", { p_tenant_id: tenantId }),
			),
		);

	const memberRoles = async (tenantId: string): Promise<MemberRoleRow[]> => {
		const rows = await fetchAllPages(memberRoleRow, (from, to) =>
			client
				.from("tenant_members")
				.select("user_id,role")
				.eq("tenant_id", tenantId)
				.order("user_id")
				.range(from, to),
		);
		return rows.map((row) => ({ userId: row.user_id, role: row.role }));
	};

	const authorOf = async (
		tenantId: string,
		updatedBy: string,
	): Promise<AuditAuthor> => {
		const userId = await currentUserId();
		const members = updatedBy === userId ? [] : await memberRoles(tenantId);
		return auditAuthorOf(updatedBy, userId, members);
	};

	const auditOf = async (
		tenantId: string,
		changedAt: string,
		updatedBy: string | null,
	): Promise<AuditEntry> => ({
		changedAt,
		author:
			updatedBy === null
				? { kind: "unknown" }
				: await authorOf(tenantId, updatedBy).catch(
						(): AuditAuthor => ({ kind: "unknown" }),
					),
	});

	return {
		kind: "supabase",

		async membership(tenantId): Promise<Membership | null> {
			const userId = await currentUserId();
			const rows = await fetchOnce(
				membershipRow,
				client
					.from("tenant_members")
					.select("role,store_ids")
					.eq("tenant_id", tenantId)
					.eq("user_id", userId),
			);
			const row = rows[0];
			return row === undefined
				? null
				: { role: row.role, storeIds: row.store_ids };
		},

		async itemTypes(tenantId): Promise<ItemTypeEntry[]> {
			const [types, roles] = await Promise.all([
				fetchAllPages(itemTypeRow, (from, to) =>
					client
						.from("item_types")
						.select(
							"pos_account_id,external_id,name,pos_accounts!inner(display_name)",
						)
						.eq("tenant_id", tenantId)
						.eq("active", true)
						.order("pos_account_id")
						.order("external_id")
						.range(from, to),
				),
				fetchAllPages(roleRow, (from, to) =>
					client
						.from("item_type_roles")
						.select("pos_account_id,item_type_external_id,role")
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("item_type_external_id")
						.range(from, to),
				),
			]);
			const roleOf = new Map(
				roles.map((row) => [
					`${row.pos_account_id}|${row.item_type_external_id}`,
					row.role as ItemTypeEntry["role"],
				]),
			);
			return types.map((row) => ({
				posAccountId: row.pos_account_id,
				posAccountName: row.pos_accounts.display_name,
				itemTypeExternalId: row.external_id,
				name: row.name,
				role: roleOf.get(`${row.pos_account_id}|${row.external_id}`) ?? null,
			}));
		},

		async saveRoles(tenantId, changes: readonly RoleChange[]) {
			if (changes.length === 0) return;
			await written(
				client.from("item_type_roles").upsert(
					changes.map((change) => ({
						tenant_id: tenantId,
						pos_account_id: change.posAccountId,
						item_type_external_id: change.itemTypeExternalId,
						role: change.role,
					})),
					{ onConflict: "pos_account_id,item_type_external_id" },
				),
			);
		},

		async reportSettings(tenantId): Promise<ReportSettingsState> {
			const rows = await fetchOnce(
				settingsRow,
				client
					.from("report_settings")
					.select(SETTINGS_SELECT)
					.eq("tenant_id", tenantId),
			);
			const row = rows[0];
			if (row === undefined) {
				return {
					settings: DEFAULT_REPORT_SETTINGS,
					hasRow: false,
					audit: null,
				};
			}
			return {
				hasRow: true,
				audit: await auditOf(tenantId, row.updated_at, row.updated_by),
				settings: thresholdsOf(row),
			};
		},

		async saveReportSettings(tenantId, changes) {
			const rows = await writtenRows(
				settingsRow,
				client
					.from("report_settings")
					.upsert(settingsColumnsOf(tenantId, changes), {
						onConflict: "tenant_id",
					})
					.select(SETTINGS_SELECT),
			);
			const saved = rows[0];
			if (
				saved === undefined ||
				!isDefaultReportSettings(thresholdsOf(saved))
			) {
				return;
			}
			const defaultRowOnly = SETTING_KEYS.reduce(
				(query, key) =>
					query.eq(REPORT_SETTINGS_COLUMNS[key], DEFAULT_REPORT_SETTINGS[key]),
				client.from("report_settings").delete().eq("tenant_id", tenantId),
			);
			await written(defaultRowOnly).catch(() => undefined);
		},

		catchUpStatus,

		async refreshChunk(tenantId): Promise<CatchUpStatus> {
			const status = await catchUpStatus(tenantId);
			const window = refreshWindow(status);
			if (window === null || !status.canRefresh) return status;
			await written(
				client.rpc("refresh_my_analytics", {
					p_from: window.from,
					p_to: window.to,
					p_tenant: tenantId,
				}),
			);
			return catchUpStatus(tenantId);
		},
	};
}
