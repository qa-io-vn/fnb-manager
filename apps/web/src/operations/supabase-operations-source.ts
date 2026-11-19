import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllPages, fetchOnce } from "../data/paginate";
import { SettingsWriteError } from "../settings/source";
import {
	createSupabaseAudits,
	nullableNumeric,
	numeric,
	type PostgrestFailure,
	tenantRole,
	writeErrorOf,
} from "../settings/supabase-common";
import {
	type Actor,
	type Actors,
	type AnswerValues,
	CASH_COUNT_STATES,
	type CashCountRow,
	type ChecklistRun,
	type ChecklistTemplate,
	type HandoverRow,
	INCIDENT_KINDS,
	type IncidentCategory,
	type IncidentRow,
	type OperationsSource,
	REPORT_STATUSES,
	type RunCorrection,
	type RunDetail,
	SHIFT_PHASES,
} from "./source";

export const RUN_ID_CHUNK = 120;

const phase = z.enum(SHIFT_PHASES);

const templateRow = z.object({
	id: z.string(),
	store_id: z.string().nullable(),
	shift_phase: phase,
	title: z.string(),
	active: z.boolean(),
	version: z.number(),
	created_at: z.string(),
	updated_at: z.string(),
	updated_by: z.string().nullable(),
});

export const TEMPLATE_SELECT =
	"id,store_id,shift_phase,title,active,version,created_at,updated_at,updated_by";

const itemRow = z.object({
	id: z.string(),
	template_id: z.string(),
	template_version: z.number(),
	position: z.number(),
	label: z.string(),
	requires_photo: z.boolean(),
	number_unit: z.string().nullable(),
});

export const ITEM_SELECT =
	"id,template_id,template_version,position,label,requires_photo,number_unit";

const savedTemplate = z.object({
	template_id: z.string(),
	version: z.number(),
	active: z.boolean(),
});

const runRow = z.object({
	id: z.string(),
	store_id: z.string(),
	template_id: z.string(),
	template_version: z.number(),
	title: z.string(),
	shift_phase: phase,
	business_date: z.string(),
	status: z.enum(["open", "finished"]),
	started_at: z.string(),
	finished_at: z.string().nullable(),
	created_by: z.string().nullable(),
});

export const RUN_SELECT =
	"id,store_id,template_id,template_version,title,shift_phase,business_date,status,started_at,finished_at,created_by";

const answerRow = z.object({
	id: z.string(),
	run_id: z.string(),
	done: z.boolean(),
	photo_path: z.string().nullable(),
	photo_removed_at: z.string().nullable(),
});

export const ANSWER_SELECT = "id,run_id,done,photo_path,photo_removed_at";

const correctionCountRow = z.object({ id: z.string(), run_id: z.string() });

const answerValues = z
	.object({
		done: z.boolean().nullable().optional(),
		number_value: nullableNumeric.optional(),
		photo_path: z.string().nullable().optional(),
	})
	.transform(
		(values): AnswerValues => ({
			done: values.done ?? null,
			numberValue: values.number_value ?? null,
			photoPath: values.photo_path ?? null,
		}),
	);

const correctionRow = z.object({
	id: z.string(),
	answer_id: z.string(),
	old_values: answerValues,
	new_values: answerValues,
	created_by: z.string().nullable(),
	created_at: z.string(),
});

export const CORRECTION_SELECT =
	"id,answer_id,old_values,new_values,created_by,created_at";

const runDetail = z
	.object({
		run_id: z.string(),
		store_id: z.string(),
		title: z.string(),
		shift_phase: phase,
		business_date: z.string(),
		template_version: z.number(),
		status: z.enum(["open", "finished"]),
		started_by: z.string().nullable(),
		started_at: z.string(),
		finished_at: z.string().nullable(),
		photo_bucket: z.string().nullable(),
		items: z.array(
			z.object({
				answer_id: z.string(),
				position: z.number(),
				label: z.string(),
				requires_photo: z.boolean(),
				number_unit: z.string().nullable(),
				done: z.boolean(),
				number_value: nullableNumeric,
				photo_path: z.string().nullable(),
				photo_removed: z.boolean(),
				answered_by: z.string().nullable(),
				answered_at: z.string().nullable(),
			}),
		),
	})
	.nullable();

const cashRow = z.object({
	store_id: z.string(),
	business_date: z.string(),
	shift_id: z.string().nullable(),
	shift_number: z.number().nullable(),
	opened_at: z.string().nullable(),
	closed_at: z.string().nullable(),
	cash_count_id: z.string().nullable(),
	counted_amount: nullableNumeric,
	counted_by: z.string().nullable(),
	counted_at: z.string().nullable(),
	recounts: z.number().nullable(),
	expected_cash_amount: nullableNumeric,
	drawer_amount: nullableNumeric,
	cash_sales_amount: nullableNumeric,
	variance_amount: nullableNumeric,
	drawer_variance_amount: nullableNumeric,
	over_abs_threshold: z.boolean(),
	over_rel_threshold: z.boolean(),
	over_z_threshold: z.boolean(),
	state: z.enum(CASH_COUNT_STATES),
});

const incidentRow = z.object({
	id: z.string(),
	store_id: z.string(),
	business_date: z.string(),
	occurred_at: z.string(),
	kind: z.enum(INCIDENT_KINDS),
	category_key: z.string(),
	description: z.string(),
	item_label: z.string().nullable(),
	photo_bucket: z.string().nullable(),
	photo_paths: z.array(z.string()),
	photo_removed_at: z.string().nullable(),
	status: z.enum(REPORT_STATUSES),
	created_by: z.string().nullable(),
	acknowledged_by: z.string().nullable(),
	acknowledged_at: z.string().nullable(),
	resolved_by: z.string().nullable(),
	resolved_at: z.string().nullable(),
});

export const INCIDENT_SELECT =
	"id,store_id,business_date,occurred_at,kind,category_key,description,item_label,photo_bucket,photo_paths,photo_removed_at,status,created_by,acknowledged_by,acknowledged_at,resolved_by,resolved_at";

const handoverRow = z.object({
	id: z.string(),
	store_id: z.string(),
	business_date: z.string(),
	from_shift: z.number(),
	to_shift: z.number(),
	note: z.string(),
	created_by: z.string().nullable(),
	created_at: z.string(),
	acknowledged_by: z.string().nullable(),
	acknowledged_at: z.string().nullable(),
});

export const HANDOVER_SELECT =
	"id,store_id,business_date,from_shift,to_shift,note,created_by,created_at,acknowledged_by,acknowledged_at";

const categoryRow = z.object({
	key: z.string(),
	label: z.string(),
	sort_order: numeric,
	active: z.boolean(),
});

const rosterNameRow = z.object({
	user_id: z.string(),
	display_name: z.string(),
});

const memberRow = z.object({ user_id: z.string(), role: tenantRole });

async function answered<Value>(
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

async function read<Value>(
	schema: z.ZodType<Value>,
	request: PromiseLike<{ data: unknown; error: PostgrestFailure | null }>,
): Promise<Value> {
	const result = await request;
	if (result.error !== null) {
		throw Object.assign(new Error(result.error.message ?? "read failed"), {
			code: result.error.code,
		});
	}
	return schema.parse(result.data);
}

export function chunksOf<Value>(
	values: readonly Value[],
	size: number,
): Value[][] {
	const chunks: Value[][] = [];
	for (let start = 0; start < values.length; start += size) {
		chunks.push(values.slice(start, start + size));
	}
	return chunks;
}

function countBy<Row>(
	rows: readonly Row[],
	keyOf: (row: Row) => string,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = keyOf(row);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

export function createSupabaseOperationsSource(
	client: SupabaseClient,
): OperationsSource {
	const audits = createSupabaseAudits(client);

	const byRuns = async <Row>(
		runIds: readonly string[],
		schema: z.ZodType<Row>,
		table: string,
		select: string,
	): Promise<Row[]> => {
		const rows: Row[] = [];
		for (const chunk of chunksOf(runIds, RUN_ID_CHUNK)) {
			rows.push(
				...(await fetchAllPages(schema, (from, to) =>
					client
						.from(table)
						.select(select)
						.in("run_id", chunk)
						.order("run_id")
						.order("id")
						.range(from, to),
				)),
			);
		}
		return rows;
	};

	const rpcVoid = async (name: string, args: Record<string, string>) => {
		await answered(z.unknown(), client.rpc(name, args));
	};

	return {
		kind: "supabase",

		async checklistTemplates(tenantId): Promise<ChecklistTemplate[]> {
			const [templates, items, auditOf] = await Promise.all([
				fetchAllPages(templateRow, (from, to) =>
					client
						.from("checklist_templates")
						.select(TEMPLATE_SELECT)
						.eq("tenant_id", tenantId)
						.order("created_at")
						.order("id")
						.range(from, to),
				),
				fetchAllPages(itemRow, (from, to) =>
					client
						.from("checklist_items")
						.select(ITEM_SELECT)
						.eq("tenant_id", tenantId)
						.order("template_id")
						.order("template_version")
						.order("position")
						.range(from, to),
				),
				audits.auditsFor(tenantId),
			]);
			return templates.map((row) => ({
				id: row.id,
				storeId: row.store_id,
				phase: row.shift_phase,
				title: row.title,
				active: row.active,
				version: row.version,
				items: items
					.filter(
						(item) =>
							item.template_id === row.id &&
							item.template_version === row.version,
					)
					.sort((left, right) => left.position - right.position)
					.map((item) => ({
						id: item.id,
						position: item.position,
						label: item.label,
						requiresPhoto: item.requires_photo,
						numberUnit: item.number_unit,
					})),
				createdAt: row.created_at,
				audit: auditOf(row.updated_at, row.updated_by),
			}));
		},

		async saveChecklistTemplate(tenantId, change) {
			const saved = await answered(
				savedTemplate,
				client.rpc("save_checklist_template", {
					p_tenant_id: tenantId,
					p_store_id: change.storeId,
					p_shift_phase: change.phase,
					p_title: change.title,
					p_items: change.items.map((item) => ({
						label: item.label,
						requires_photo: item.requiresPhoto,
						number_unit: item.numberUnit,
					})),
					p_template_id: change.templateId,
				}),
			);
			return {
				templateId: saved.template_id,
				version: saved.version,
				active: saved.active,
			};
		},

		setChecklistTemplateActive(templateId, active) {
			return answered(
				z.boolean(),
				client.rpc("set_checklist_template_active", {
					p_template_id: templateId,
					p_active: active,
				}),
			);
		},

		async checklistRuns(storeIds, from, to): Promise<ChecklistRun[]> {
			if (storeIds.length === 0) return [];
			const runs = await fetchAllPages(runRow, (start, end) =>
				client
					.from("checklist_runs")
					.select(RUN_SELECT)
					.in("store_id", [...storeIds])
					.gte("business_date", from)
					.lte("business_date", to)
					.order("business_date")
					.order("id")
					.range(start, end),
			);
			const runIds = runs.map((run) => run.id);
			const [answers, corrections] = await Promise.all([
				byRuns(runIds, answerRow, "checklist_answers", ANSWER_SELECT),
				byRuns(
					runIds,
					correctionCountRow,
					"checklist_corrections",
					"id,run_id",
				),
			]);
			const correctionCounts = countBy(corrections, (row) => row.run_id);
			const answersByRun = new Map<string, (typeof answers)[number][]>();
			for (const answer of answers) {
				answersByRun.set(answer.run_id, [
					...(answersByRun.get(answer.run_id) ?? []),
					answer,
				]);
			}
			return runs.map((run) => {
				const own = answersByRun.get(run.id) ?? [];
				return {
					id: run.id,
					storeId: run.store_id,
					templateId: run.template_id,
					templateVersion: run.template_version,
					title: run.title,
					phase: run.shift_phase,
					businessDate: run.business_date,
					status: run.status,
					startedAt: run.started_at,
					finishedAt: run.finished_at,
					startedBy: run.created_by,
					itemsTotal: own.length,
					itemsDone: own.filter((answer) => answer.done).length,
					photos: own.filter((answer) => answer.photo_path !== null).length,
					photosRemoved: own.filter(
						(answer) => answer.photo_removed_at !== null,
					).length,
					corrections: correctionCounts.get(run.id) ?? 0,
				};
			});
		},

		async runDetail(runId): Promise<RunDetail | null> {
			const [detail, corrections] = await Promise.all([
				read(
					runDetail,
					client.rpc("checklist_run_detail", { p_run_id: runId }),
				),
				fetchAllPages(correctionRow, (from, to) =>
					client
						.from("checklist_corrections")
						.select(CORRECTION_SELECT)
						.eq("run_id", runId)
						.order("created_at")
						.order("id")
						.range(from, to),
				),
			]);
			if (detail === null) return null;
			return {
				runId: detail.run_id,
				storeId: detail.store_id,
				title: detail.title,
				phase: detail.shift_phase,
				businessDate: detail.business_date,
				templateVersion: detail.template_version,
				status: detail.status,
				startedBy: detail.started_by,
				startedAt: detail.started_at,
				finishedAt: detail.finished_at,
				photoBucket: detail.photo_bucket,
				items: detail.items.map((item) => ({
					answerId: item.answer_id,
					position: item.position,
					label: item.label,
					requiresPhoto: item.requires_photo,
					numberUnit: item.number_unit,
					done: item.done,
					numberValue: item.number_value,
					photoPath: item.photo_path,
					photoRemoved: item.photo_removed,
					answeredBy: item.answered_by,
					answeredAt: item.answered_at,
				})),
				corrections: corrections.map(
					(row): RunCorrection => ({
						id: row.id,
						answerId: row.answer_id,
						before: row.old_values,
						after: row.new_values,
						by: row.created_by,
						at: row.created_at,
					}),
				),
			};
		},

		async photo(bucket, path) {
			const { data, error } = await client.storage.from(bucket).download(path);
			if (error !== null || data === null) {
				throw new Error(error?.message ?? "photo not readable");
			}
			return data;
		},

		async cashCounts(storeIds, from, to): Promise<CashCountRow[]> {
			if (storeIds.length === 0) return [];
			const rows = await read(
				z.array(cashRow),
				client.rpc("cash_count_review", {
					store_ids: [...storeIds],
					from_date: from,
					to_date: to,
				}),
			);
			return rows.map((row) => ({
				storeId: row.store_id,
				businessDate: row.business_date,
				shiftId: row.shift_id,
				shiftNumber: row.shift_number,
				openedAt: row.opened_at,
				closedAt: row.closed_at,
				cashCountId: row.cash_count_id,
				countedAmount: row.counted_amount,
				countedBy: row.counted_by,
				countedAt: row.counted_at,
				recounts: row.recounts,
				expectedCashAmount: row.expected_cash_amount,
				drawerAmount: row.drawer_amount,
				cashSalesAmount: row.cash_sales_amount,
				varianceAmount: row.variance_amount,
				drawerVarianceAmount: row.drawer_variance_amount,
				overAbs: row.over_abs_threshold,
				overRel: row.over_rel_threshold,
				overZ: row.over_z_threshold,
				state: row.state,
			}));
		},

		reopenCashCount(cashCountId) {
			return rpcVoid("reopen_cash_count", { p_cash_count_id: cashCountId });
		},

		async incidents(storeIds, from, to): Promise<IncidentRow[]> {
			if (storeIds.length === 0) return [];
			const rows = await fetchAllPages(incidentRow, (start, end) =>
				client
					.from("incidents")
					.select(INCIDENT_SELECT)
					.in("store_id", [...storeIds])
					.gte("business_date", from)
					.lte("business_date", to)
					.order("occurred_at", { ascending: false })
					.order("id")
					.range(start, end),
			);
			return rows.map((row) => ({
				id: row.id,
				storeId: row.store_id,
				businessDate: row.business_date,
				occurredAt: row.occurred_at,
				kind: row.kind,
				categoryKey: row.category_key,
				description: row.description,
				itemLabel: row.item_label,
				photoBucket: row.photo_bucket,
				photoPaths: row.photo_paths,
				photosRemoved: row.photo_removed_at !== null,
				status: row.status,
				reportedBy: row.created_by,
				acknowledgedBy: row.acknowledged_by,
				acknowledgedAt: row.acknowledged_at,
				resolvedBy: row.resolved_by,
				resolvedAt: row.resolved_at,
			}));
		},

		async handovers(storeIds, from, to): Promise<HandoverRow[]> {
			if (storeIds.length === 0) return [];
			const rows = await fetchAllPages(handoverRow, (start, end) =>
				client
					.from("shift_handovers")
					.select(HANDOVER_SELECT)
					.in("store_id", [...storeIds])
					.gte("business_date", from)
					.lte("business_date", to)
					.order("created_at", { ascending: false })
					.order("id")
					.range(start, end),
			);
			return rows.map((row) => ({
				id: row.id,
				storeId: row.store_id,
				businessDate: row.business_date,
				fromShift: row.from_shift,
				toShift: row.to_shift,
				note: row.note,
				writtenBy: row.created_by,
				writtenAt: row.created_at,
				acknowledgedBy: row.acknowledged_by,
				acknowledgedAt: row.acknowledged_at,
			}));
		},

		async incidentCategories(tenantId): Promise<IncidentCategory[]> {
			const rows = await fetchOnce(
				categoryRow,
				client.rpc("incident_categories_of", { p_tenant_id: tenantId }),
			);
			return rows.map((row) => ({
				key: row.key,
				label: row.label,
				sortOrder: row.sort_order,
				active: row.active,
			}));
		},

		acknowledgeIncident(incidentId) {
			return rpcVoid("acknowledge_incident", { p_incident_id: incidentId });
		},

		resolveIncident(incidentId) {
			return rpcVoid("resolve_incident", { p_incident_id: incidentId });
		},

		acknowledgeHandover(handoverId) {
			return rpcVoid("acknowledge_handover", { p_handover_id: handoverId });
		},

		async actors(tenantId): Promise<Actors> {
			const [currentUserId, members, roster] = await Promise.all([
				audits.currentUserId().catch(() => null),
				fetchAllPages(memberRow, (from, to) =>
					client
						.from("tenant_members")
						.select("user_id,role")
						.eq("tenant_id", tenantId)
						.order("user_id")
						.range(from, to),
				).catch((): z.output<typeof memberRow>[] => []),
				fetchAllPages(rosterNameRow, (from, to) =>
					client
						.from("staff_roster")
						.select("user_id,display_name")
						.eq("tenant_id", tenantId)
						.not("user_id", "is", null)
						.order("user_id")
						.order("id")
						.range(from, to),
				).catch((): z.output<typeof rosterNameRow>[] => []),
			]);
			const byId = new Map<string, Actor>();
			for (const member of members) {
				byId.set(member.user_id, { name: null, role: member.role });
			}
			for (const row of roster) {
				byId.set(row.user_id, {
					name: row.display_name,
					role: byId.get(row.user_id)?.role ?? null,
				});
			}
			return { currentUserId, byId };
		},
	};
}
