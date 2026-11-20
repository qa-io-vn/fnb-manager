import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchOnce } from "../data/paginate";
import { SettingsWriteError } from "../settings/source";
import {
	numeric,
	onlyRow,
	type PostgrestFailure,
	writeErrorOf,
	writtenRows,
} from "../settings/supabase-common";
import { parseSubjectExport } from "./export-shape";
import {
	CONSENT_PURPOSES,
	type ConsentRow,
	type DataRequestRow,
	DELETION_TABLES,
	type DeletionPreview,
	type DeletionResult,
	type DeletionTable,
	type DueRow,
	PREVIEW_TABLES,
	type PreviewTable,
	type PrivacySource,
	REQUEST_STATUSES,
	REQUEST_TYPES,
	type SubjectSummary,
} from "./source";

export const DSR_LOOKUP_FUNCTION = "dsr_lookup";
export const DSR_EXPORT_FUNCTION = "dsr_export";
export const DSR_CORRECT_FUNCTION = "dsr_correct";
export const DSR_DELETE_FUNCTION = "dsr_delete";
export const DSR_PREVIEW_FUNCTION = "dsr_deletion_preview";
export const DSR_DUE_SOON_FUNCTION = "dsr_due_soon";

export const REQUEST_SELECT =
	"id,subject_type,subject_id,contact,request_type,received_at,uses_processor,first_response_due_at,completion_due_at,status,responded_at,completed_at,notes";

const consentJson = z.object({
	id: z.string(),
	purpose: z.enum(CONSENT_PURPOSES),
	channel: z.string(),
	policy_version: z.string(),
	granted_at: z.string(),
	revoked_at: z.string().nullable(),
	active: z.boolean(),
});

const subjectRow = z.object({
	customer_id: z.string(),
	tenant_id: z.string(),
	name: z.string().nullable(),
	phone_masked: z.string(),
	first_seen_at: z.string(),
	memberships: numeric,
	ledger_entries: numeric,
	stamp_total: numeric,
	point_total: numeric,
	consents: z.array(consentJson),
	messages: numeric,
	open_requests: numeric,
});

const requestRow = z.object({
	id: z.string(),
	subject_type: z.enum(["customer", "staff"]),
	subject_id: z.string().nullable(),
	contact: z.string(),
	request_type: z.enum(REQUEST_TYPES),
	received_at: z.string(),
	uses_processor: z.boolean(),
	first_response_due_at: z.string(),
	completion_due_at: z.string(),
	status: z.enum(REQUEST_STATUSES),
	responded_at: z.string().nullable(),
	completed_at: z.string().nullable(),
	notes: z.string().nullable(),
});

const dueState = z.enum(["done", "overdue", "due_soon", "on_track"]);

const dueRow = z.object({
	request_id: z.string(),
	request_type: z.enum(REQUEST_TYPES),
	first_response_state: dueState,
	completion_state: dueState,
});

const correctionAnswer = z.object({
	changed: z.boolean(),
	status: z.enum(REQUEST_STATUSES),
});

function countsOf(tables: readonly string[]) {
	return z.record(z.string(), numeric).superRefine((counts, context) => {
		for (const table of tables) {
			if (!(table in counts)) {
				context.addIssue({ code: "custom", message: `missing ${table}` });
			}
		}
	});
}

const deletionAnswer = z.object({
	already_done: z.boolean(),
	counts: countsOf(DELETION_TABLES),
	responded_on_time: z.boolean(),
	completed_on_time: z.boolean(),
});

const previewAnswer = countsOf(PREVIEW_TABLES);

function consentOf(row: z.infer<typeof consentJson>): ConsentRow {
	return {
		id: row.id,
		purpose: row.purpose,
		channel: row.channel,
		policyVersion: row.policy_version,
		grantedAt: row.granted_at,
		revokedAt: row.revoked_at,
		active: row.active,
	};
}

function subjectOf(row: z.infer<typeof subjectRow>): SubjectSummary {
	return {
		customerId: row.customer_id,
		tenantId: row.tenant_id,
		name: row.name,
		phoneMasked: row.phone_masked,
		firstSeenAt: row.first_seen_at,
		memberships: row.memberships,
		ledgerEntries: row.ledger_entries,
		stampTotal: row.stamp_total,
		pointTotal: row.point_total,
		consents: row.consents.map(consentOf),
		messages: row.messages,
		openRequests: row.open_requests,
	};
}

function requestOf(row: z.infer<typeof requestRow>): DataRequestRow {
	return {
		id: row.id,
		subjectType: row.subject_type,
		subjectId: row.subject_id,
		contact: row.contact,
		requestType: row.request_type,
		receivedAt: row.received_at,
		usesProcessor: row.uses_processor,
		firstResponseDueAt: row.first_response_due_at,
		completionDueAt: row.completion_due_at,
		status: row.status,
		respondedAt: row.responded_at,
		completedAt: row.completed_at,
		notes: row.notes,
	};
}

async function answer(
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<unknown> {
	let result: { data: unknown; error: PostgrestFailure | null };
	try {
		result = await request;
	} catch {
		throw new SettingsWriteError("network");
	}
	if (result.error !== null) throw writeErrorOf(result.error);
	return result.data;
}

function countsFrom<Table extends string>(
	tables: readonly Table[],
	counts: Readonly<Record<string, number>>,
): Readonly<Record<Table, number>> {
	return Object.fromEntries(
		tables.map((table) => [table, counts[table] ?? 0]),
	) as Record<Table, number>;
}

export function createSupabasePrivacySource(
	client: SupabaseClient,
): PrivacySource {
	return {
		async lookupSubjects(phone) {
			const rows = await fetchOnce(
				subjectRow,
				client.rpc(DSR_LOOKUP_FUNCTION, { p_phone: phone }),
			);
			return rows.map(subjectOf);
		},
		async requests(tenantId) {
			const rows = await fetchOnce(
				requestRow,
				client
					.from("data_subject_requests")
					.select(REQUEST_SELECT)
					.eq("tenant_id", tenantId)
					.order("completion_due_at")
					.order("id"),
			);
			return rows.map(requestOf);
		},
		async dueSoon(days) {
			const rows = await fetchOnce(
				dueRow,
				client.rpc(DSR_DUE_SOON_FUNCTION, { p_days: days }),
			);
			return rows.map(
				(row): DueRow => ({
					requestId: row.request_id,
					requestType: row.request_type,
					firstResponseState: row.first_response_state,
					completionState: row.completion_state,
				}),
			);
		},
		async recordRequest(tenantId, change) {
			const rows = await writtenRows(
				requestRow,
				client
					.from("data_subject_requests")
					.insert({
						tenant_id: tenantId,
						subject_type: "customer",
						subject_id: change.subjectId,
						contact: change.contact,
						request_type: change.requestType,
						uses_processor: change.usesProcessor,
						notes: change.notes,
					})
					.select(REQUEST_SELECT),
			);
			return requestOf(onlyRow(rows));
		},
		async closeRequest(closure) {
			const rows = await writtenRows(
				z.object({ id: z.string() }),
				client
					.from("data_subject_requests")
					.update({
						status: closure.status,
						notes: closure.notes,
						completed_at: new Date().toISOString(),
					})
					.eq("id", closure.requestId)
					.in("status", ["received", "in_progress"])
					.select("id"),
			);
			onlyRow(rows);
		},
		async exportSubject(requestId) {
			return parseSubjectExport(
				await answer(
					client.rpc(DSR_EXPORT_FUNCTION, { p_request_id: requestId }),
				),
			);
		},
		async correctName(requestId, name) {
			const parsed = correctionAnswer.parse(
				await answer(
					client.rpc(DSR_CORRECT_FUNCTION, {
						p_request_id: requestId,
						p_field: "name",
						p_value: name,
					}),
				),
			);
			return { changed: parsed.changed, status: parsed.status };
		},
		async deletionPreview(requestId): Promise<DeletionPreview> {
			const counts = previewAnswer.parse(
				await answer(
					client.rpc(DSR_PREVIEW_FUNCTION, { p_request_id: requestId }),
				),
			);
			return countsFrom<PreviewTable>(PREVIEW_TABLES, counts);
		},
		async deleteSubject(requestId): Promise<DeletionResult> {
			const parsed = deletionAnswer.parse(
				await answer(
					client.rpc(DSR_DELETE_FUNCTION, { p_request_id: requestId }),
				),
			);
			return {
				alreadyDone: parsed.already_done,
				counts: countsFrom<DeletionTable>(DELETION_TABLES, parsed.counts),
				respondedOnTime: parsed.responded_on_time,
				completedOnTime: parsed.completed_on_time,
			};
		},
		async revokeConsent(consentId) {
			const rows = await writtenRows(
				z.object({ id: z.string() }),
				client
					.from("consent_records")
					.update({ revoked_at: new Date().toISOString() })
					.eq("id", consentId)
					.is("revoked_at", null)
					.select("id"),
			);
			onlyRow(rows);
		},
	};
}
