import { type PaymentKind, paymentKindSchema } from "@fnb/core";
import {
	addDays,
	DEFAULT_REPORT_SETTINGS,
	E_INVOICE_STATUSES,
	isDefaultReportSettings,
	maxDate,
	POS_FEATURE_STATUSES,
	REPORT_SETTINGS_COLUMNS,
	type ReportSettings,
	type ReportSettingsColumn,
	TRAN_NO_RESET_PERIODS,
} from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../data/paginate";
import {
	type AuditAuthor,
	type AuditEntry,
	auditAuthorOf,
	type CatchUpStatus,
	type CategoryOverrideChange,
	type FeeRateRow,
	type HolidayRow,
	ITEM_TYPE_ROLES,
	type ItemEntry,
	type ItemTypeEntry,
	type KindOverrideChange,
	LEGAL_FORMS,
	type Membership,
	NO_CATCH_UP,
	type PaymentMethodEntry,
	type ReportSettingsState,
	type RoleChange,
	type SettingsSource,
	SettingsWriteError,
	type StoreProfile,
	type StoreProfileChange,
	type TenantProfile,
	type TenantProfileChange,
	yearBounds,
} from "./source";
import {
	type AuditOf,
	clearedByAccount,
	createSupabaseAudits,
	deleteCleared,
	nullableNumeric,
	numeric,
	onlyRow,
	rereadOrNetwork,
	tenantRole,
	written,
	writtenRows,
} from "./supabase-common";
import type { OpeningHours } from "./validation";

export { writeErrorOf } from "./supabase-common";

export const REFRESH_CHUNK_DAYS = 92;

const membershipRow = z.object({
	role: tenantRole,
	store_ids: z.array(z.string()).nullable(),
});

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
	updated_at: z.string(),
	updated_by: z.string().nullable(),
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
	inputs_changed_at: z.string().nullable(),
	pending_from: z.string().nullable(),
	pending_to: z.string().nullable(),
	pending_days: numeric,
	can_refresh: z.boolean(),
});

const language = z.enum(["vi", "en"]);
const paymentKind = paymentKindSchema;

const tenantRow = z.object({
	legal_form: z.enum(LEGAL_FORMS),
	default_language: language,
	profile_updated_at: z.string().nullable(),
	profile_updated_by: z.string().nullable(),
});

const TENANT_SELECT =
	"legal_form,default_language,profile_updated_at,profile_updated_by";

const openingSpan = z.tuple([z.string(), z.string()]);

const storeRow = z.object({
	id: z.string(),
	pos_account_id: z.string(),
	name: z.string(),
	address: z.string().nullable(),
	timezone: z.string(),
	business_day_start_minutes: numeric,
	code: z.string().nullable(),
	opening_hours: z.record(z.string(), z.array(openingSpan)).nullable(),
	seat_count: nullableNumeric,
	opened_on: z.string().nullable(),
	e_invoice_status: z.enum(E_INVOICE_STATUSES),
	tran_no_reset_period: z.enum(TRAN_NO_RESET_PERIODS),
	member_capture_status: z.enum(POS_FEATURE_STATUSES),
	profile_updated_at: z.string().nullable(),
	profile_updated_by: z.string().nullable(),
});

const STORE_SELECT =
	"id,pos_account_id,name,address,timezone,business_day_start_minutes,code,opening_hours,seat_count,opened_on,e_invoice_status,tran_no_reset_period,member_capture_status,profile_updated_at,profile_updated_by";

const STORE_COLUMNS = {
	code: "code",
	openingHours: "opening_hours",
	seatCount: "seat_count",
	openedOn: "opened_on",
	eInvoiceStatus: "e_invoice_status",
	tranNoResetPeriod: "tran_no_reset_period",
	memberCaptureStatus: "member_capture_status",
} as const satisfies Record<keyof StoreProfileChange, string>;

const itemRow = z.object({
	pos_account_id: z.string(),
	external_id: z.string(),
	name: z.string(),
	size_label: z.string().nullable(),
	list_price: nullableNumeric,
	is_modifier: z.boolean(),
	active: z.boolean(),
	item_type_external_id: z.string().nullable(),
});

const categoryOverrideRow = z.object({
	pos_account_id: z.string(),
	item_external_id: z.string(),
	item_type_external_id: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const paymentMethodRow = z.object({
	pos_account_id: z.string(),
	external_id: z.string(),
	name: z.string(),
	kind: paymentKind,
	pos_kind: paymentKind,
	pos_accounts: z.object({ display_name: z.string() }),
});

const kindOverrideRow = z.object({
	pos_account_id: z.string(),
	payment_method_external_id: z.string(),
	kind: paymentKind,
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const feeRateRow = z.object({
	id: z.string(),
	store_id: z.string().nullable(),
	payment_method_external_id: z.string(),
	fee_pct: numeric,
	fixed_fee_amount: numeric,
	effective_from: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const FEE_RATE_SELECT =
	"id,store_id,payment_method_external_id,fee_pct,fixed_fee_amount,effective_from,updated_at,updated_by";

const holidayRow = z.object({
	id: z.string(),
	tenant_id: z.string().nullable(),
	country_code: z.string(),
	holiday_date: z.string(),
	name: z.string(),
	kind: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

const HOLIDAY_SELECT =
	"id,tenant_id,country_code,holiday_date,name,kind,updated_at,updated_by";

const countryRow = z.object({ country_code: z.string() });
const idRow = z.object({ id: z.string() });

function tenantProfileOf(
	row: z.output<typeof tenantRow>,
	auditOf: AuditOf,
): TenantProfile {
	return {
		legalForm: row.legal_form,
		defaultLanguage: row.default_language,
		audit: auditOf(row.profile_updated_at, row.profile_updated_by),
	};
}

export function storeProfileOf(
	row: z.output<typeof storeRow>,
	auditOf: AuditOf,
): StoreProfile {
	return {
		storeId: row.id,
		posAccountId: row.pos_account_id,
		name: row.name,
		address: row.address,
		timeZone: row.timezone,
		businessDayStartMinutes: row.business_day_start_minutes,
		code: row.code,
		openingHours: row.opening_hours as OpeningHours | null,
		seatCount: row.seat_count,
		openedOn: row.opened_on,
		eInvoiceStatus: row.e_invoice_status,
		tranNoResetPeriod: row.tran_no_reset_period,
		memberCaptureStatus: row.member_capture_status,
		audit: auditOf(row.profile_updated_at, row.profile_updated_by),
	};
}

export function storeColumnsOf(
	change: StoreProfileChange,
): Record<string, unknown> {
	const columns: Record<string, unknown> = {};
	for (const [key, column] of Object.entries(STORE_COLUMNS)) {
		const value = change[key as keyof StoreProfileChange];
		if (value !== undefined) columns[column] = value;
	}
	return columns;
}

function feeRateOf(
	row: z.output<typeof feeRateRow>,
	auditOf: AuditOf,
): FeeRateRow {
	return {
		id: row.id,
		storeId: row.store_id,
		paymentMethodExternalId: row.payment_method_external_id,
		feePct: row.fee_pct,
		fixedFeeAmount: row.fixed_fee_amount,
		effectiveFrom: row.effective_from,
		audit: auditOf(row.updated_at, row.updated_by),
	};
}

function holidayOf(
	row: z.output<typeof holidayRow>,
	auditOf: AuditOf,
): HolidayRow {
	const custom = row.tenant_id !== null;
	return {
		id: row.id,
		countryCode: row.country_code,
		holidayDate: row.holiday_date,
		name: row.name,
		kind: row.kind,
		custom,
		audit: custom ? auditOf(row.updated_at, row.updated_by) : null,
	};
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
		inputsChangedAt: row.inputs_changed_at,
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
	const newestStart = addDays(status.pendingTo, 1 - REFRESH_CHUNK_DAYS);
	return {
		from: maxDate(newestStart, status.pendingFrom),
		to: status.pendingTo,
	};
}

function keyOf(...parts: readonly string[]): string {
	return parts.join("\u0000");
}

export function createSupabaseSettingsSource(
	client: SupabaseClient,
): SettingsSource {
	const audits = createSupabaseAudits(client);
	const { currentUserId, memberRoles } = audits;

	const catchUpStatus = async (tenantId: string): Promise<CatchUpStatus> =>
		catchUpOf(
			await fetchOnce(
				catchUpRow,
				client.rpc("analytics_catch_up_status", { p_tenant_id: tenantId }),
			),
		);

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

	const storeRows = (tenantId: string, storeId?: string) =>
		fetchAllPages(storeRow, (from, to) => {
			const query = client
				.from("stores")
				.select(STORE_SELECT)
				.eq("tenant_id", tenantId);
			return (storeId === undefined ? query : query.eq("id", storeId))
				.order("name")
				.order("id")
				.range(from, to);
		});

	const tenantCountry = async (tenantId: string): Promise<string> => {
		const [row] = await rereadOrNetwork(
			countryRow,
			client.from("tenants").select("country_code").eq("id", tenantId),
		);
		if (row === undefined) throw new SettingsWriteError("forbidden");
		return row.country_code;
	};

	const tenantProfile = async (tenantId: string): Promise<TenantProfile> => {
		const [rows, auditsOf] = await Promise.all([
			fetchOnce(
				tenantRow,
				client.from("tenants").select(TENANT_SELECT).eq("id", tenantId),
			),
			audits.auditsFor(tenantId),
		]);
		const row = rows[0];
		if (row === undefined) throw new Error("the tenant is not visible");
		return tenantProfileOf(row, auditsOf);
	};

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

		tenantProfile,

		async updateTenantProfile(
			tenantId,
			change: TenantProfileChange,
		): Promise<TenantProfile> {
			if (Object.values(change).every((value) => value === undefined)) {
				return tenantProfile(tenantId);
			}
			const columns: Record<string, unknown> = {};
			if (change.legalForm !== undefined) {
				columns.legal_form = change.legalForm;
			}
			if (change.defaultLanguage !== undefined) {
				columns.default_language = change.defaultLanguage;
			}
			const row = onlyRow(
				await writtenRows(
					tenantRow,
					client
						.from("tenants")
						.update(columns)
						.eq("id", tenantId)
						.select(TENANT_SELECT),
				),
			);
			return tenantProfileOf(row, await audits.auditsFor(tenantId));
		},

		async storeProfiles(tenantId): Promise<StoreProfile[]> {
			const [rows, auditsOf] = await Promise.all([
				storeRows(tenantId),
				audits.auditsFor(tenantId),
			]);
			return rows.map((row) => storeProfileOf(row, auditsOf));
		},

		async updateStoreProfile(
			tenantId,
			storeId,
			change: StoreProfileChange,
		): Promise<StoreProfile> {
			const columns = storeColumnsOf(change);
			if (Object.keys(columns).length === 0) {
				const [auditsOf, [current]] = await Promise.all([
					audits.auditsFor(tenantId),
					storeRows(tenantId, storeId),
				]);
				if (current === undefined) throw new SettingsWriteError("forbidden");
				return storeProfileOf(current, auditsOf);
			}
			const row = onlyRow(
				await writtenRows(
					storeRow,
					client
						.from("stores")
						.update(columns)
						.eq("tenant_id", tenantId)
						.eq("id", storeId)
						.select(STORE_SELECT),
				),
			);
			return storeProfileOf(row, await audits.auditsFor(tenantId));
		},

		async itemTypes(tenantId): Promise<ItemTypeEntry[]> {
			const [types, roles, auditsOf] = await Promise.all([
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
						.select(
							"pos_account_id,item_type_external_id,role,updated_at,updated_by",
						)
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("item_type_external_id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			const roleOf = new Map(
				roles.map((row) => [
					`${row.pos_account_id}|${row.item_type_external_id}`,
					row,
				]),
			);
			return types.map((row) => {
				const role = roleOf.get(`${row.pos_account_id}|${row.external_id}`);
				return {
					posAccountId: row.pos_account_id,
					posAccountName: row.pos_accounts.display_name,
					itemTypeExternalId: row.external_id,
					name: row.name,
					role: (role?.role ?? null) as ItemTypeEntry["role"],
					audit:
						role === undefined
							? null
							: auditsOf(role.updated_at, role.updated_by),
				};
			});
		},

		async saveRoles(tenantId, changes: readonly RoleChange[]) {
			const assigned = changes.flatMap((change) =>
				change.role === null
					? []
					: [
							{
								tenant_id: tenantId,
								pos_account_id: change.posAccountId,
								item_type_external_id: change.itemTypeExternalId,
								role: change.role,
							},
						],
			);
			if (assigned.length > 0) {
				await written(
					client.from("item_type_roles").upsert(assigned, {
						onConflict: "pos_account_id,item_type_external_id",
					}),
				);
			}
			await deleteCleared(
				client,
				"item_type_roles",
				"item_type_external_id",
				tenantId,
				clearedByAccount(
					changes,
					(change) => change.itemTypeExternalId,
					(change) => change.role === null,
				),
			);
		},

		async items(tenantId): Promise<ItemEntry[]> {
			const [items, overrides, auditsOf] = await Promise.all([
				fetchAllPages(itemRow, (from, to) =>
					client
						.from("items")
						.select(
							"pos_account_id,external_id,name,size_label,list_price,is_modifier,active,item_type_external_id",
						)
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("external_id")
						.range(from, to),
				),
				fetchAllPages(categoryOverrideRow, (from, to) =>
					client
						.from("item_category_overrides")
						.select(
							"pos_account_id,item_external_id,item_type_external_id,updated_at,updated_by",
						)
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("item_external_id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			const overrideOf = new Map(
				overrides.map((row) => [
					keyOf(row.pos_account_id, row.item_external_id),
					row,
				]),
			);
			const listed = items.map((row): ItemEntry => {
				const key = keyOf(row.pos_account_id, row.external_id);
				const override = overrideOf.get(key);
				overrideOf.delete(key);
				return {
					posAccountId: row.pos_account_id,
					itemExternalId: row.external_id,
					name: row.name,
					sizeLabel: row.size_label,
					listPrice: row.list_price,
					isModifier: row.is_modifier,
					active: row.active,
					inCatalogue: true,
					posItemTypeExternalId: row.item_type_external_id,
					overrideItemTypeExternalId: override?.item_type_external_id ?? null,
					audit:
						override === undefined
							? null
							: auditsOf(override.updated_at, override.updated_by),
				};
			});
			const unlisted = [...overrideOf.values()].map(
				(override): ItemEntry => ({
					posAccountId: override.pos_account_id,
					itemExternalId: override.item_external_id,
					name: override.item_external_id,
					sizeLabel: null,
					listPrice: null,
					isModifier: false,
					active: false,
					inCatalogue: false,
					posItemTypeExternalId: null,
					overrideItemTypeExternalId: override.item_type_external_id,
					audit: auditsOf(override.updated_at, override.updated_by),
				}),
			);
			return [...listed, ...unlisted];
		},

		async saveCategoryOverrides(
			tenantId,
			changes: readonly CategoryOverrideChange[],
		) {
			const assigned = changes.flatMap((change) =>
				change.itemTypeExternalId === null
					? []
					: [
							{
								tenant_id: tenantId,
								pos_account_id: change.posAccountId,
								item_external_id: change.itemExternalId,
								item_type_external_id: change.itemTypeExternalId,
							},
						],
			);
			if (assigned.length > 0) {
				await written(
					client.from("item_category_overrides").upsert(assigned, {
						onConflict: "pos_account_id,item_external_id",
					}),
				);
			}
			await deleteCleared(
				client,
				"item_category_overrides",
				"item_external_id",
				tenantId,
				clearedByAccount(
					changes,
					(change) => change.itemExternalId,
					(change) => change.itemTypeExternalId === null,
				),
			);
		},

		async paymentMethods(tenantId): Promise<PaymentMethodEntry[]> {
			const [methods, overrides, auditsOf] = await Promise.all([
				fetchAllPages(paymentMethodRow, (from, to) =>
					client
						.from("payment_methods")
						.select(
							"pos_account_id,external_id,name,kind,pos_kind,pos_accounts!inner(display_name)",
						)
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("external_id")
						.range(from, to),
				),
				fetchAllPages(kindOverrideRow, (from, to) =>
					client
						.from("payment_kind_overrides")
						.select(
							"pos_account_id,payment_method_external_id,kind,updated_at,updated_by",
						)
						.eq("tenant_id", tenantId)
						.order("pos_account_id")
						.order("payment_method_external_id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			const overrideOf = new Map(
				overrides.map((row) => [
					keyOf(row.pos_account_id, row.payment_method_external_id),
					row,
				]),
			);
			return methods.map((row) => {
				const override = overrideOf.get(
					keyOf(row.pos_account_id, row.external_id),
				);
				const overrideKind: PaymentKind | null = override?.kind ?? null;
				return {
					posAccountId: row.pos_account_id,
					posAccountName: row.pos_accounts.display_name,
					externalId: row.external_id,
					name: row.name,
					posKind: row.pos_kind,
					overrideKind,
					kind: overrideKind ?? row.kind,
					audit:
						override === undefined
							? null
							: auditsOf(override.updated_at, override.updated_by),
				};
			});
		},

		async saveKindOverrides(tenantId, changes: readonly KindOverrideChange[]) {
			const assigned = changes.flatMap((change) =>
				change.kind === null
					? []
					: [
							{
								tenant_id: tenantId,
								pos_account_id: change.posAccountId,
								payment_method_external_id: change.paymentMethodExternalId,
								kind: change.kind,
							},
						],
			);
			if (assigned.length > 0) {
				await written(
					client.from("payment_kind_overrides").upsert(assigned, {
						onConflict: "pos_account_id,payment_method_external_id",
					}),
				);
			}
			await deleteCleared(
				client,
				"payment_kind_overrides",
				"payment_method_external_id",
				tenantId,
				clearedByAccount(
					changes,
					(change) => change.paymentMethodExternalId,
					(change) => change.kind === null,
				),
			);
		},

		async feeRates(tenantId): Promise<FeeRateRow[]> {
			const [rows, auditsOf] = await Promise.all([
				fetchAllPages(feeRateRow, (from, to) =>
					client
						.from("payment_fee_rates")
						.select(FEE_RATE_SELECT)
						.eq("tenant_id", tenantId)
						.order("payment_method_external_id")
						.order("store_id", { nullsFirst: true })
						.order("effective_from")
						.order("id")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map((row) => feeRateOf(row, auditsOf));
		},

		async saveFeeRates(tenantId, rows): Promise<FeeRateRow[]> {
			if (rows.length === 0) return [];
			const saved = await writtenRows(
				feeRateRow,
				client
					.from("payment_fee_rates")
					.upsert(
						rows.map((row) => ({
							tenant_id: tenantId,
							store_id: row.storeId,
							payment_method_external_id: row.paymentMethodExternalId,
							fee_pct: row.feePct,
							fixed_fee_amount: row.fixedFeeAmount,
							effective_from: row.effectiveFrom,
						})),
						{
							onConflict:
								"tenant_id,store_id,payment_method_external_id,effective_from",
						},
					)
					.select(FEE_RATE_SELECT),
			);
			const auditsOf = await audits.auditsFor(tenantId);
			return saved.map((row) => feeRateOf(row, auditsOf));
		},

		async holidays(tenantId, year): Promise<HolidayRow[]> {
			const { from, to } = yearBounds(year);
			const [country, auditsOf] = await Promise.all([
				tenantCountry(tenantId),
				audits.auditsFor(tenantId),
			]);
			const [global, custom] = await Promise.all([
				fetchAllPages(holidayRow, (start, end) =>
					client
						.from("holidays")
						.select(HOLIDAY_SELECT)
						.is("tenant_id", null)
						.eq("country_code", country)
						.gte("holiday_date", from)
						.lte("holiday_date", to)
						.order("holiday_date")
						.order("id")
						.range(start, end),
				),
				fetchAllPages(holidayRow, (start, end) =>
					client
						.from("holidays")
						.select(HOLIDAY_SELECT)
						.eq("tenant_id", tenantId)
						.eq("country_code", country)
						.gte("holiday_date", from)
						.lte("holiday_date", to)
						.order("holiday_date")
						.order("id")
						.range(start, end),
				),
			]);
			return [...global, ...custom]
				.map((row) => holidayOf(row, auditsOf))
				.sort(
					(left, right) =>
						left.holidayDate.localeCompare(right.holidayDate) ||
						Number(left.custom) - Number(right.custom) ||
						left.id.localeCompare(right.id),
				);
		},

		async addHoliday(tenantId, change): Promise<HolidayRow> {
			const country = await tenantCountry(tenantId);
			const row = onlyRow(
				await writtenRows(
					holidayRow,
					client
						.from("holidays")
						.insert({
							tenant_id: tenantId,
							country_code: country,
							holiday_date: change.holidayDate,
							name: change.name,
							kind: "custom",
						})
						.select(HOLIDAY_SELECT),
				),
			);
			return holidayOf(row, await audits.auditsFor(tenantId));
		},

		async deleteHoliday(tenantId, id) {
			const removed = await writtenRows(
				idRow,
				client
					.from("holidays")
					.delete()
					.eq("tenant_id", tenantId)
					.eq("id", id)
					.select("id"),
			);
			if (removed.length > 0) return;
			const remaining = await rereadOrNetwork(
				idRow,
				client
					.from("holidays")
					.select("id")
					.eq("tenant_id", tenantId)
					.eq("id", id),
			);
			if (remaining.length > 0) throw new SettingsWriteError("forbidden");
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
