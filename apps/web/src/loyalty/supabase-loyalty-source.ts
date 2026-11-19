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
	type CustomerSource,
	type InvoiceReference,
	type LedgerEntryRow,
	type LoyaltyProgrammeChange,
	type LoyaltyProgrammeRecord,
	type LoyaltySource,
	LoyaltyWriteError,
	MEMBERSHIP_STATUSES,
	type MemberRow,
	QUEUE_REASONS,
	QUEUE_STATES,
	type QueueItemRow,
	type ShiftAnomaly,
	type StaffPhoneRow,
} from "./source";

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

export const MEMBERS_PAGE_FUNCTION = "loyalty_members_page";
export const MEMBER_LOOKUP_FUNCTION = "loyalty_member_lookup";
export const SHIFT_ANOMALIES_FUNCTION = "loyalty_shift_anomalies";

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

const queueRow = z.object({
	id: z.string(),
	store_id: z.string(),
	membership_id: z.string(),
	matched_path: z.enum(["B", "C"]),
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
						.eq("state", "open"),
				),
				fetchOnce(
					queueRow,
					client
						.from("loyalty_queue")
						.select(QUEUE_SELECT)
						.eq("tenant_id", tenantId)
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
