import {
	LOYALTY_ENTRY_KINDS,
	LOYALTY_PROGRAMME_STATUSES,
	LOYALTY_REFUSAL_REASONS,
	type LoyaltyParameters,
	type LoyaltyRefusalReason,
	MATCHED_PATHS,
	NOTIFICATION_DECISIONS,
} from "@fnb/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllByKey, fetchOnce, type QueryResult } from "../data/paginate";
import { createSupabasePrivacySource } from "../privacy/supabase-privacy-source";
import { SettingsWriteError } from "../settings/source";
import {
	createSupabaseAudits,
	nullableNumeric,
	numeric,
	onlyRow,
	type PostgrestFailure,
	writeErrorOf,
} from "../settings/supabase-common";
import { PARAMETER_COLUMNS, refusedProgrammeField } from "./programme-columns";
import {
	BILL_READER_MODES,
	type BillAnomalyRow,
	CONFIRMATION_MODES,
	type CustomerSource,
	type InvoiceReference,
	type LedgerEntryRow,
	type LoyaltyProgrammeChange,
	type LoyaltyProgrammeRecord,
	type LoyaltySource,
	type LoyaltyStoreSettings,
	LoyaltyWriteError,
	MEMBERSHIP_STATUSES,
	type MemberRow,
	QUEUE_REASONS,
	QUEUE_STATES,
	type QueueItemRow,
	RECONCILIATION_REASONS,
	RFM_SEGMENTS,
	type ShiftAnomaly,
	SILENCE_OUTCOMES,
	type StaffPhoneRow,
} from "./source";
import {
	STORE_SETTING_COLUMNS,
	storeSettingsPayload,
} from "./store-settings-columns";

export const ID_CHUNK = 100;
export const READ_PAGE = 1_000;
export const CLOSED_QUEUE_ITEMS = 100;
/** loyalty_shift_anomalies takes at most 50 stores per call, like every report function. */
export const REPORT_STORE_CHUNK = 50;

const PARAMETER_SELECT = Object.values(PARAMETER_COLUMNS).join(",");

export const PROGRAMME_SELECT = `id,name,starts_on,ends_on,reward_budget_amount,status,notification_decision,notification_decided_at,notification_basis,created_at,updated_at,updated_by,${PARAMETER_SELECT}`;

const programmeRow = z.object({
	id: z.string(),
	name: z.string(),
	starts_on: z.string(),
	ends_on: z.string().nullable(),
	reward_budget_amount: numeric,
	status: z.enum(LOYALTY_PROGRAMME_STATUSES),
	notification_decision: z.enum(NOTIFICATION_DECISIONS),
	notification_decided_at: z.string().nullable(),
	notification_basis: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
	stamps_per_card: numeric,
	stamp_min_bill_amount: numeric,
	welcome_stamps: numeric,
	point_unit_amount: numeric,
	points_per_unit: numeric,
	stamp_validity_months: numeric,
	points_expiry_months: numeric,
	earning_invoices_per_phone_per_day: numeric,
	checkin_window_before_minutes: numeric,
	checkin_window_after_minutes: numeric,
	checkin_code_ttl_seconds: numeric,
	checkin_pending_hours: numeric,
	receipt_claim_window_hours: numeric,
	receipt_claims_per_phone_per_day: numeric,
	excluded_order_sources: z.array(z.string()),
	point_value_amount: numeric,
	expected_breakage_rate: numeric,
});

type ProgrammeRow = z.infer<typeof programmeRow>;

const STAFF_PHONE_SELECT = "id,phone,label,created_at";

const staffPhoneRow = z.object({
	id: z.string(),
	phone: z.string(),
	label: z.string().nullable(),
	created_at: z.string(),
});

export const STORE_SETTINGS_FUNCTION = "set_loyalty_store_settings";
export const BILL_ANOMALY_FUNCTION = "bill_anomaly_report";

export const STORE_SETTINGS_SELECT = [
	"store_id",
	...Object.values(STORE_SETTING_COLUMNS),
	"updated_at",
].join(",");

const wholeCount = numeric.pipe(z.number().int().nonnegative());

/** A row of loyalty_store_settings or the answer of set_loyalty_store_settings. */
export const storeSettingsRow = z.object({
	store_id: z.string().min(1),
	confirmation: z.enum(CONFIRMATION_MODES),
	max_bill_amount: numeric.pipe(z.number().positive()),
	bill_evidence_required_level: z.union([
		z.literal(0),
		z.literal(1),
		z.literal(2),
	]),
	bill_manager_approval_above: numeric.pipe(z.number().positive()),
	bill_amount_tolerance: numeric.pipe(z.number().nonnegative()),
	bill_unconfirmed_hours: wholeCount,
	bill_silence_outcome: z.enum(SILENCE_OUTCOMES),
	bill_staff_shift_cap: wholeCount,
	staff_amount_per_day: numeric.pipe(z.number().positive()),
	store_earns_per_day: wholeCount,
	staff_redemptions_per_day: wholeCount,
	reverse_window_minutes: wholeCount,
	bill_audit_sample_pct: numeric.pipe(z.number().min(0).max(100)),
	self_claim: z.boolean(),
	counter_code_ttl_seconds: wholeCount,
	auto_approve_max_amount: numeric.pipe(z.number().nonnegative()),
	auto_approve_per_day: wholeCount,
	bill_photo_retention_days: wholeCount,
	bill_reader_mode: z.enum(BILL_READER_MODES),
	shadow_reconcile: z.boolean(),
	updated_at: z.string(),
});

export function storeSettingsOf(
	row: z.infer<typeof storeSettingsRow>,
): LoyaltyStoreSettings {
	return {
		storeId: row.store_id,
		confirmation: row.confirmation,
		maxBillAmount: row.max_bill_amount,
		billEvidenceRequiredLevel: row.bill_evidence_required_level,
		billManagerApprovalAbove: row.bill_manager_approval_above,
		billAmountTolerance: row.bill_amount_tolerance,
		billUnconfirmedHours: row.bill_unconfirmed_hours,
		billSilenceOutcome: row.bill_silence_outcome,
		billStaffShiftCap: row.bill_staff_shift_cap,
		staffAmountPerDay: row.staff_amount_per_day,
		storeEarnsPerDay: row.store_earns_per_day,
		staffRedemptionsPerDay: row.staff_redemptions_per_day,
		reverseWindowMinutes: row.reverse_window_minutes,
		billAuditSamplePct: row.bill_audit_sample_pct,
		selfClaim: row.self_claim,
		counterCodeTtlSeconds: row.counter_code_ttl_seconds,
		autoApproveMaxAmount: row.auto_approve_max_amount,
		autoApprovePerDay: row.auto_approve_per_day,
		billPhotoRetentionDays: row.bill_photo_retention_days,
		billReaderMode: row.bill_reader_mode,
		shadowReconcile: row.shadow_reconcile,
		updatedAt: row.updated_at,
	};
}

/** A row of bill_anomaly_report. */
export const billAnomalyRow = z.object({
	store_id: z.string().min(1),
	business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	staff_user_id: z.string().nullable(),
	staff_name: z.string().nullable(),
	bills: wholeCount,
	bills_total: numeric,
	level0: wholeCount,
	level2: wholeCount,
	confirmed: wholeCount,
	queued: wholeCount,
	disagreements: wholeCount,
	disputes: wholeCount,
	timed_out: wholeCount,
	reversals: wholeCount,
	audits_failed: wholeCount,
	redemptions_confirmed: wholeCount,
	top_member_share: nullableNumeric,
	amount_outliers: wholeCount,
	max_bills_in_hour: nullableNumeric,
	peer_median_bills: nullableNumeric,
	flags: z.array(z.string()),
});

export function billAnomalyOf(
	row: z.infer<typeof billAnomalyRow>,
): BillAnomalyRow {
	return {
		storeId: row.store_id,
		businessDate: row.business_date,
		staffUserId: row.staff_user_id,
		staffName: row.staff_name,
		bills: row.bills,
		billsTotal: row.bills_total,
		level0: row.level0,
		level2: row.level2,
		confirmed: row.confirmed,
		queued: row.queued,
		disagreements: row.disagreements,
		disputes: row.disputes,
		timedOut: row.timed_out,
		reversals: row.reversals,
		auditsFailed: row.audits_failed,
		redemptionsConfirmed: row.redemptions_confirmed,
		topMemberShare: row.top_member_share,
		amountOutliers: row.amount_outliers,
		maxBillsInHour: row.max_bills_in_hour,
		peerMedianBills: row.peer_median_bills,
		flags: row.flags,
	};
}

export const MEMBERS_PAGE_FUNCTION = "loyalty_members_page";
export const MEMBER_LOOKUP_FUNCTION = "loyalty_member_lookup";
export const SHIFT_ANOMALIES_FUNCTION = "loyalty_shift_anomalies";
export const CUSTOMER_METRICS_FUNCTION = "customer_metrics";
export const COHORT_RETENTION_FUNCTION = "cohort_retention";
export const RFM_FUNCTION = "rfm_quintiles";

const customerMetricsRow = z.object({
	invoices: numeric,
	identified_invoices: numeric,
	customer_capture_rate: nullableNumeric,
	customers: numeric,
	repeat_customers: numeric,
	repeat_rate: nullableNumeric,
	active_customers_30d: numeric,
	visit_frequency_30d: nullableNumeric,
	active_customers_90d: numeric,
	visit_frequency_90d: nullableNumeric,
	outstanding_points: nullableNumeric,
	loyalty_liability: nullableNumeric,
	breakage_rate: nullableNumeric,
	member_revenue: numeric,
	rewards_redeemed_value: nullableNumeric,
	reward_cost_rate: nullableNumeric,
	member_customers: numeric,
	comparison_customers: numeric,
	member_visit_frequency: nullableNumeric,
	comparison_visit_frequency: nullableNumeric,
	member_frequency_uplift: nullableNumeric,
	uplift_comparison: z.string(),
});

const rfmRow = z.object({
	segment: z.enum(RFM_SEGMENTS),
	customers: numeric,
	share: numeric,
});

const cohortRow = z.object({
	cohort_month: z.string(),
	month_offset: numeric,
	cohort_size: numeric,
	retained: numeric,
	retention: nullableNumeric,
});

const memberColumns = {
	membership_id: z.string(),
	tenant_id: z.string(),
	programme_id: z.string(),
	phone_masked: z.string().nullable(),
	joined_at: z.string(),
	status: z.enum(MEMBERSHIP_STATUSES),
	channel: z.string(),
	stamps: numeric,
	points: numeric,
	pending_stamps: numeric,
	pending_points: numeric,
	last_visit: z.string().nullable(),
};

const memberPageRow = z.object({ ...memberColumns, page_key: z.string() });

const memberLookupRow = z.object({
	...memberColumns,
	phone_full: z.string().nullable(),
});

const anomalyRow = z.object({
	store_id: z.string(),
	business_date: z.string(),
	shift_number: nullableNumeric,
	earns: numeric,
	refusals: z.record(z.string(), numeric),
	refusals_total: numeric,
	adjustments: numeric,
	checkins_without_invoice: numeric,
});

const INVOICE_COLUMNS =
	"id,external_id,receipt_no,business_date,sold_at,net_amount,shift_external_id";

const invoiceRow = z.object({
	id: z.string(),
	external_id: z.string(),
	receipt_no: z.string().nullable(),
	business_date: z.string(),
	sold_at: z.string(),
	net_amount: numeric,
	shift_external_id: z.string().nullable(),
});

const LEDGER_SELECT = `id,membership_id,store_id,entry_kind,stamp_delta,point_delta,value_amount,business_date,matched_path,pending,source_entry_id,reason,occurred_at,expires_at,invoice:invoices(${INVOICE_COLUMNS})`;

const ledgerRow = z.object({
	id: z.string(),
	membership_id: z.string(),
	store_id: z.string().nullable(),
	entry_kind: z.enum(LOYALTY_ENTRY_KINDS),
	stamp_delta: numeric,
	point_delta: numeric,
	value_amount: numeric,
	business_date: z.string().nullable(),
	matched_path: z.enum(MATCHED_PATHS).nullable(),
	pending: z.boolean(),
	source_entry_id: z.string().nullable(),
	reason: z.string().nullable(),
	occurred_at: z.string(),
	expires_at: z.string().nullable(),
	invoice: invoiceRow.nullable().optional(),
});

const QUEUE_SELECT =
	"id,store_id,membership_id,matched_path,candidate_invoice_ids,reason,state,created_at,resolved_at,resolved_by,chosen_invoice_id,resolution_reason,entry_id,membership:memberships(phone_masked),checkin:pending_checkins(recorded_at,amount),claim:receipt_claims(receipt_no,amount,business_date)";

// The page lists the two-candidate and duplicate-receipt items (paths B and C).
// Path D items (a verified redemption without an invoice, a discount without a
// redemption) have no member and other reasons; the page cannot show them yet
// (G-100), and one of them in the list must not break the page.
export const QUEUE_PATHS_SHOWN = ["B", "C"] as const;

const queueRow = z.object({
	id: z.string(),
	store_id: z.string(),
	membership_id: z.string(),
	matched_path: z.enum(QUEUE_PATHS_SHOWN),
	candidate_invoice_ids: z.array(z.string()),
	reason: z.enum(QUEUE_REASONS),
	state: z.enum(QUEUE_STATES),
	created_at: z.string(),
	resolved_at: z.string().nullable(),
	resolved_by: z.string().nullable(),
	chosen_invoice_id: z.string().nullable(),
	resolution_reason: z.string().nullable(),
	entry_id: z.string().nullable(),
	membership: z
		.object({ phone_masked: z.string().nullable() })
		.nullable()
		.optional(),
	checkin: z
		.object({ recorded_at: z.string().nullable(), amount: nullableNumeric })
		.nullable()
		.optional(),
	claim: z
		.object({
			receipt_no: z.string(),
			amount: numeric,
			business_date: z.string(),
		})
		.nullable()
		.optional(),
});

// The path D items (G-100): ids only. The entry name and the receipt are read from the redemption and the invoice by
// id, and the redemption's code is never selected.
export const RECONCILIATION_PATH = "D";

const reconciliationRow = z.object({
	id: z.string(),
	store_id: z.string(),
	reason: z.enum(RECONCILIATION_REASONS),
	state: z.enum(QUEUE_STATES),
	created_at: z.string(),
	resolved_at: z.string().nullable(),
	redemption_id: z.string().nullable(),
	invoice_id: z.string().nullable(),
});

const RECONCILIATION_SELECT =
	"id,store_id,reason,state,created_at,resolved_at,redemption_id,invoice_id";

const reconciliationInvoiceRow = z.object({
	id: z.string(),
	receipt_no: z.string().nullable(),
	sold_at: z.string(),
	bill_discount_name: z.string().nullable(),
});

const reconciliationRedemptionRow = z.object({
	id: z.string(),
	pos_discount_name: z.string().nullable(),
});

const queueOutcome = z.object({
	state: z.enum(["resolved", "dismissed"]),
	entry_id: z.string().nullable(),
	refusal: z.enum(LOYALTY_REFUSAL_REASONS).nullable(),
});

function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function parametersOf(row: ProgrammeRow): LoyaltyParameters {
	return {
		stampsPerCard: row.stamps_per_card,
		stampMinBillAmount: row.stamp_min_bill_amount,
		welcomeStamps: row.welcome_stamps,
		pointUnitAmount: row.point_unit_amount,
		pointsPerUnit: row.points_per_unit,
		stampValidityMonths: row.stamp_validity_months,
		pointsExpiryMonths: row.points_expiry_months,
		earningInvoicesPerPhonePerDay: row.earning_invoices_per_phone_per_day,
		checkinWindowBeforeMinutes: row.checkin_window_before_minutes,
		checkinWindowAfterMinutes: row.checkin_window_after_minutes,
		checkinCodeTtlSeconds: row.checkin_code_ttl_seconds,
		checkinPendingHours: row.checkin_pending_hours,
		receiptClaimWindowHours: row.receipt_claim_window_hours,
		receiptClaimsPerPhonePerDay: row.receipt_claims_per_phone_per_day,
		excludedOrderSources: row.excluded_order_sources,
		pointValueAmount: row.point_value_amount,
		expectedBreakageRate: row.expected_breakage_rate,
	};
}

export function programmeColumnsOf(
	change: LoyaltyProgrammeChange,
): Record<string, unknown> {
	const parameters = Object.fromEntries(
		(Object.keys(PARAMETER_COLUMNS) as (keyof LoyaltyParameters)[]).map(
			(field) => [PARAMETER_COLUMNS[field], change.parameters[field]],
		),
	);
	return {
		name: change.name,
		starts_on: change.startsOn,
		ends_on: change.endsOn,
		reward_budget_amount: change.rewardBudgetAmount,
		status: change.status,
		notification_decision: change.notificationDecision,
		notification_basis: change.notificationBasis,
		notification_decided_at: change.notificationDecidedAt,
		...parameters,
	};
}

export function programmeWriteError(
	error: PostgrestFailure,
): SettingsWriteError {
	if (error.code === "22023") {
		const refusal = refusedProgrammeField(error.message);
		return new LoyaltyWriteError("invalid", refusal.field, refusal.hold);
	}
	if (
		error.code === "23505" &&
		/one_active_per_tenant/.test(
			`${error.message ?? ""} ${error.details ?? ""}`,
		)
	) {
		return new LoyaltyWriteError("duplicate", "status");
	}
	return writeErrorOf(error);
}

async function writtenWith<Row>(
	schema: z.ZodType<Row>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
	errorOf: (error: PostgrestFailure) => SettingsWriteError = writeErrorOf,
): Promise<Row[]> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw errorOf(result.error);
	return z.array(schema).parse(result.data ?? []);
}

function invoiceOf(row: z.infer<typeof invoiceRow>): InvoiceReference {
	return {
		id: row.id,
		externalId: row.external_id,
		receiptNo: row.receipt_no,
		businessDate: row.business_date,
		soldAt: row.sold_at,
		netAmount: row.net_amount,
		shiftExternalId: row.shift_external_id,
	};
}

function memberOf(
	row: z.infer<typeof memberPageRow> | z.infer<typeof memberLookupRow>,
): MemberRow {
	return {
		membershipId: row.membership_id,
		tenantId: row.tenant_id,
		programmeId: row.programme_id,
		phoneMasked: row.phone_masked,
		phoneFull: "phone_full" in row ? row.phone_full : null,
		joinedAt: row.joined_at,
		status: row.status,
		channel: row.channel,
		balance: {
			stamps: row.stamps,
			points: row.points,
			pendingStamps: row.pending_stamps,
			pendingPoints: row.pending_points,
			lastVisit: row.last_visit,
		},
	};
}

function isRefusalReason(reason: string): reason is LoyaltyRefusalReason {
	return (LOYALTY_REFUSAL_REASONS as readonly string[]).includes(reason);
}

function anomalyOf(row: z.infer<typeof anomalyRow>): ShiftAnomaly {
	const refusals: Partial<Record<LoyaltyRefusalReason, number>> = {};
	for (const [reason, count] of Object.entries(row.refusals)) {
		if (isRefusalReason(reason)) refusals[reason] = count;
	}
	return {
		storeId: row.store_id,
		businessDate: row.business_date,
		shiftNumber: row.shift_number,
		earns: row.earns,
		refusals,
		refusalsTotal: row.refusals_total,
		adjustments: row.adjustments,
		checkinsWithoutInvoice: row.checkins_without_invoice,
	};
}

function ledgerEntryOf(row: z.infer<typeof ledgerRow>): LedgerEntryRow {
	return {
		id: row.id,
		membershipId: row.membership_id,
		storeId: row.store_id,
		entryKind: row.entry_kind,
		stampDelta: row.stamp_delta,
		pointDelta: row.point_delta,
		valueAmount: row.value_amount,
		invoice: row.invoice == null ? null : invoiceOf(row.invoice),
		businessDate: row.business_date,
		matchedPath: row.matched_path,
		pending: row.pending,
		sourceEntryId: row.source_entry_id,
		reason: row.reason,
		occurredAt: row.occurred_at,
		expiresAt: row.expires_at,
	};
}

export function createSupabaseLoyaltySource(
	client: SupabaseClient,
): LoyaltySource {
	const audits = createSupabaseAudits(client);
	const recordOf =
		(auditOf: Awaited<ReturnType<typeof audits.auditsFor>>) =>
		(row: ProgrammeRow): LoyaltyProgrammeRecord => ({
			id: row.id,
			name: row.name,
			startsOn: row.starts_on,
			endsOn: row.ends_on,
			rewardBudgetAmount: row.reward_budget_amount,
			status: row.status,
			notificationDecision: row.notification_decision,
			notificationDecidedAt: row.notification_decided_at,
			notificationBasis: row.notification_basis,
			parameters: parametersOf(row),
			createdAt: row.created_at,
			audit: auditOf(row.updated_at, row.updated_by),
		});
	return {
		kind: "supabase",
		async programmes(tenantId) {
			const [rows, auditOf] = await Promise.all([
				fetchOnce(
					programmeRow,
					client
						.from("loyalty_programmes")
						.select(PROGRAMME_SELECT)
						.eq("tenant_id", tenantId)
						.order("created_at", { ascending: false })
						.order("id")
						.limit(READ_PAGE),
				),
				audits.auditsFor(tenantId),
			]);
			return rows.map(recordOf(auditOf));
		},
		async saveProgramme(tenantId, change) {
			const columns = programmeColumnsOf(change);
			const request =
				change.id === null
					? client
							.from("loyalty_programmes")
							.insert({ tenant_id: tenantId, ...columns })
							.select(PROGRAMME_SELECT)
					: client
							.from("loyalty_programmes")
							.update(columns)
							.eq("tenant_id", tenantId)
							.eq("id", change.id)
							.select(PROGRAMME_SELECT);
			const row = onlyRow(
				await writtenWith(programmeRow, request, programmeWriteError),
			);
			const auditOf = await audits.auditsFor(tenantId);
			return recordOf(auditOf)(row);
		},
		async staffPhones(tenantId) {
			const rows = await byId(staffPhoneRow, () =>
				client
					.from("loyalty_staff_phones")
					.select(STAFF_PHONE_SELECT)
					.eq("tenant_id", tenantId),
			);
			return rows
				.map(
					(row): StaffPhoneRow => ({
						id: row.id,
						phone: row.phone,
						label: row.label,
						createdAt: row.created_at,
					}),
				)
				.sort((left, right) =>
					left.createdAt === right.createdAt
						? left.id.localeCompare(right.id)
						: left.createdAt.localeCompare(right.createdAt),
				);
		},
		async addStaffPhone(tenantId, change) {
			const row = onlyRow(
				await writtenWith(
					staffPhoneRow,
					client
						.from("loyalty_staff_phones")
						.insert({
							tenant_id: tenantId,
							phone: change.phone,
							label: change.label,
						})
						.select(STAFF_PHONE_SELECT),
				),
			);
			return {
				id: row.id,
				phone: row.phone,
				label: row.label,
				createdAt: row.created_at,
			};
		},
		async removeStaffPhone(tenantId, id) {
			const removed = await writtenWith(
				z.object({ id: z.string() }),
				client
					.from("loyalty_staff_phones")
					.delete()
					.eq("tenant_id", tenantId)
					.eq("id", id)
					.select("id"),
			);
			if (removed.length === 0) throw new SettingsWriteError("forbidden");
		},
		async storeSettings(tenantId, storeIds) {
			const rows: LoyaltyStoreSettings[] = [];
			for (const part of chunks([...new Set(storeIds)], ID_CHUNK)) {
				const found = await fetchOnce(
					storeSettingsRow,
					client
						.from("loyalty_store_settings")
						.select(STORE_SETTINGS_SELECT)
						.eq("tenant_id", tenantId)
						.in("store_id", part),
				);
				rows.push(...found.map(storeSettingsOf));
			}
			return rows;
		},
		async saveStoreSettings(_tenantId, storeId, change) {
			let result: { data: unknown; error: PostgrestFailure | null };
			try {
				result = await client.rpc(STORE_SETTINGS_FUNCTION, {
					p_store_id: storeId,
					p_settings: storeSettingsPayload(change),
				});
			} catch {
				throw new SettingsWriteError("network");
			}
			if (result.error !== null) throw writeErrorOf(result.error);
			return storeSettingsOf(storeSettingsRow.parse(result.data));
		},
		async billAnomalies(storeIds, from, to) {
			const rows: BillAnomalyRow[] = [];
			for (const part of chunks([...new Set(storeIds)], REPORT_STORE_CHUNK)) {
				const found = await fetchOnce(
					billAnomalyRow,
					client.rpc(BILL_ANOMALY_FUNCTION, {
						p_store_ids: part,
						p_from: from,
						p_to: to,
					}),
				);
				rows.push(...found.map(billAnomalyOf));
			}
			return rows;
		},
	};
}

async function invoicesById(
	client: SupabaseClient,
	ids: readonly string[],
): Promise<Map<string, InvoiceReference>> {
	const unique = [...new Set(ids)];
	const found = new Map<string, InvoiceReference>();
	for (const part of chunks(unique, ID_CHUNK)) {
		const rows = await fetchOnce(
			invoiceRow,
			client.from("invoices").select(INVOICE_COLUMNS).in("id", part),
		);
		for (const row of rows) found.set(row.id, invoiceOf(row));
	}
	return found;
}

async function reconciliationDetails(
	client: SupabaseClient,
	rows: readonly z.infer<typeof reconciliationRow>[],
) {
	const invoices = new Map<string, z.infer<typeof reconciliationInvoiceRow>>();
	const invoiceIds = [
		...new Set(
			rows.flatMap((row) => (row.invoice_id === null ? [] : [row.invoice_id])),
		),
	];
	for (const part of chunks(invoiceIds, ID_CHUNK)) {
		const found = await fetchOnce(
			reconciliationInvoiceRow,
			client
				.from("invoices")
				.select("id,receipt_no,sold_at,bill_discount_name")
				.in("id", part),
		);
		for (const row of found) invoices.set(row.id, row);
	}
	const redemptions = new Map<
		string,
		z.infer<typeof reconciliationRedemptionRow>
	>();
	const redemptionIds = [
		...new Set(
			rows.flatMap((row) =>
				row.redemption_id === null ? [] : [row.redemption_id],
			),
		),
	];
	for (const part of chunks(redemptionIds, ID_CHUNK)) {
		const found = await fetchOnce(
			reconciliationRedemptionRow,
			client.from("redemptions").select("id,pos_discount_name").in("id", part),
		);
		for (const row of found) redemptions.set(row.id, row);
	}
	return { invoices, redemptions };
}

function queueItemOf(
	row: z.infer<typeof queueRow>,
	invoices: ReadonlyMap<string, InvoiceReference>,
): QueueItemRow {
	return {
		id: row.id,
		storeId: row.store_id,
		membershipId: row.membership_id,
		phoneMasked: row.membership?.phone_masked ?? null,
		matchedPath: row.matched_path,
		reason: row.reason,
		state: row.state,
		createdAt: row.created_at,
		resolvedAt: row.resolved_at,
		resolvedBy: row.resolved_by,
		chosenInvoiceId: row.chosen_invoice_id,
		resolutionReason: row.resolution_reason,
		entryId: row.entry_id,
		checkin:
			row.checkin == null
				? null
				: { recordedAt: row.checkin.recorded_at, amount: row.checkin.amount },
		claim:
			row.claim == null
				? null
				: {
						receiptNo: row.claim.receipt_no,
						amount: row.claim.amount,
						businessDate: row.claim.business_date,
					},
		candidateIds: row.candidate_invoice_ids,
		candidates: row.candidate_invoice_ids.flatMap((id) => {
			const invoice = invoices.get(id);
			return invoice === undefined ? [] : [invoice];
		}),
	};
}

interface Pageable {
	gt(column: string, value: string): Pageable;
	order(column: string): Pageable;
	limit(count: number): PromiseLike<QueryResult>;
}

function byId<Row extends { readonly id: string }>(
	schema: z.ZodType<Row>,
	build: () => Pageable,
): Promise<Row[]> {
	return fetchAllByKey(
		schema,
		(row) => row.id,
		(after, pageSize) =>
			(after === null ? build() : build().gt("id", after.id))
				.order("id")
				.limit(pageSize),
	);
}

export function createSupabaseCustomerSource(
	client: SupabaseClient,
): CustomerSource {
	const membersPage = (
		storeIds: readonly string[],
		after: string | null,
		limit: number,
		search: string | null,
	) =>
		fetchOnce(
			memberPageRow,
			client.rpc(MEMBERS_PAGE_FUNCTION, {
				p_store_ids: [...storeIds],
				p_after: after,
				p_limit: limit,
				p_search: search,
			}),
		);
	return {
		kind: "supabase",
		privacy: createSupabasePrivacySource(client),
		async members(storeIds, after, pageSize) {
			if (storeIds.length === 0) return { rows: [], next: null };
			const rows = await membersPage(storeIds, after, pageSize + 1, null);
			const page = rows.slice(0, pageSize);
			const last = page.at(-1);
			return {
				rows: page.map(memberOf),
				next:
					rows.length > pageSize && last !== undefined ? last.page_key : null,
			};
		},
		async lookup(tenantId, phone) {
			const rows = await fetchOnce(
				memberLookupRow,
				client.rpc(MEMBER_LOOKUP_FUNCTION, { p_phone: phone }),
			);
			return rows.filter((row) => row.tenant_id === tenantId).map(memberOf);
		},
		async member(storeIds, membershipId) {
			if (storeIds.length === 0) return null;
			const [row] = await membersPage(storeIds, null, 1, membershipId);
			return row === undefined ? null : memberOf(row);
		},
		async ledger(membershipIds) {
			const entries: LedgerEntryRow[] = [];
			for (const part of chunks([...new Set(membershipIds)], ID_CHUNK)) {
				const rows = await byId(ledgerRow, () =>
					client
						.from("loyalty_ledger")
						.select(LEDGER_SELECT)
						.in("membership_id", part),
				);
				entries.push(...rows.map(ledgerEntryOf));
			}
			return entries;
		},
		async queue(tenantId) {
			const [open, closed] = await Promise.all([
				byId(queueRow, () =>
					client
						.from("loyalty_queue")
						.select(QUEUE_SELECT)
						.eq("tenant_id", tenantId)
						.in("matched_path", QUEUE_PATHS_SHOWN)
						.eq("state", "open"),
				),
				fetchOnce(
					queueRow,
					client
						.from("loyalty_queue")
						.select(QUEUE_SELECT)
						.eq("tenant_id", tenantId)
						.in("matched_path", QUEUE_PATHS_SHOWN)
						.neq("state", "open")
						.order("resolved_at", { ascending: false })
						.order("id")
						.limit(CLOSED_QUEUE_ITEMS),
				),
			]);
			const rows = [...open, ...closed];
			const invoices = await invoicesById(
				client,
				rows.flatMap((row) => row.candidate_invoice_ids),
			);
			return rows.map((row) => queueItemOf(row, invoices));
		},
		async reconciliation(tenantId) {
			const [open, closed] = await Promise.all([
				byId(reconciliationRow, () =>
					client
						.from("loyalty_queue")
						.select(RECONCILIATION_SELECT)
						.eq("tenant_id", tenantId)
						.eq("matched_path", RECONCILIATION_PATH)
						.eq("state", "open"),
				),
				fetchOnce(
					reconciliationRow,
					client
						.from("loyalty_queue")
						.select(RECONCILIATION_SELECT)
						.eq("tenant_id", tenantId)
						.eq("matched_path", RECONCILIATION_PATH)
						.neq("state", "open")
						.order("resolved_at", { ascending: false })
						.order("id")
						.limit(CLOSED_QUEUE_ITEMS),
				),
			]);
			const rows = [...open, ...closed];
			const { invoices, redemptions } = await reconciliationDetails(
				client,
				rows,
			);
			return rows.map((row) => {
				const invoice =
					row.invoice_id === null ? undefined : invoices.get(row.invoice_id);
				const redemption =
					row.redemption_id === null
						? undefined
						: redemptions.get(row.redemption_id);
				return {
					id: row.id,
					storeId: row.store_id,
					reason: row.reason,
					state: row.state,
					createdAt: row.created_at,
					resolvedAt: row.resolved_at,
					entryName:
						redemption?.pos_discount_name ??
						invoice?.bill_discount_name ??
						null,
					receiptNo: invoice?.receipt_no ?? null,
					soldAt: invoice?.sold_at ?? null,
				};
			});
		},
		async resolveQueueItem(resolution) {
			let result: { data: unknown; error: PostgrestFailure | null };
			try {
				result = await client.rpc("resolve_loyalty_queue_item", {
					p_item_id: resolution.itemId,
					p_choice: resolution.choice,
					p_reason: resolution.reason,
				});
			} catch {
				throw new SettingsWriteError("network");
			}
			if (result.error !== null) throw writeErrorOf(result.error);
			const outcome = queueOutcome.parse(result.data);
			return {
				state: outcome.state,
				entryId: outcome.entry_id,
				refusal: outcome.refusal,
			};
		},
		async metrics(storeIds, from, to) {
			const [row] = await fetchOnce(
				customerMetricsRow,
				client.rpc(CUSTOMER_METRICS_FUNCTION, {
					p_store_ids: [...storeIds],
					p_from: from,
					p_to: to,
				}),
			);
			if (row === undefined) throw new Error("no customer metrics row");
			return {
				invoices: row.invoices,
				identifiedInvoices: row.identified_invoices,
				captureRate: row.customer_capture_rate,
				customers: row.customers,
				repeatCustomers: row.repeat_customers,
				repeatRate: row.repeat_rate,
				activeCustomers30d: row.active_customers_30d,
				visitFrequency30d: row.visit_frequency_30d,
				activeCustomers90d: row.active_customers_90d,
				visitFrequency90d: row.visit_frequency_90d,
				outstandingPoints: row.outstanding_points,
				liability: row.loyalty_liability,
				breakageRate: row.breakage_rate,
				memberRevenue: row.member_revenue,
				rewardsRedeemedValue: row.rewards_redeemed_value,
				rewardCostRate: row.reward_cost_rate,
				memberCustomers: row.member_customers,
				comparisonCustomers: row.comparison_customers,
				memberVisitFrequency: row.member_visit_frequency,
				comparisonVisitFrequency: row.comparison_visit_frequency,
				uplift: row.member_frequency_uplift,
				upliftComparison: row.uplift_comparison,
			};
		},
		async rfm(storeIds, asOf) {
			const rows = await fetchOnce(
				rfmRow,
				client.rpc(RFM_FUNCTION, { p_store_ids: [...storeIds], p_as_of: asOf }),
			);
			return rows.map((row) => ({
				segment: row.segment,
				customers: row.customers,
				share: row.share,
			}));
		},
		async cohorts(storeIds, firstMonth, months, asOf) {
			const rows = await fetchOnce(
				cohortRow,
				client.rpc(COHORT_RETENTION_FUNCTION, {
					p_store_ids: [...storeIds],
					p_first_month: firstMonth,
					p_months: months,
					p_as_of: asOf,
				}),
			);
			return rows.map((row) => ({
				cohortMonth: row.cohort_month,
				monthOffset: row.month_offset,
				cohortSize: row.cohort_size,
				retained: row.retained,
				retention: row.retention,
			}));
		},
		async anomalies(storeIds, from, to) {
			const rows: ShiftAnomaly[] = [];
			for (const part of chunks([...new Set(storeIds)], REPORT_STORE_CHUNK)) {
				const found = await fetchOnce(
					anomalyRow,
					client.rpc(SHIFT_ANOMALIES_FUNCTION, {
						p_store_ids: part,
						p_from: from,
						p_to: to,
					}),
				);
				rows.push(...found.map(anomalyOf));
			}
			return rows;
		},
	};
}
