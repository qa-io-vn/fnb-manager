import {
	REST_NETWORK_FAILURE,
	type RestClient,
	RestError,
} from "./rest-client";
import type { StorageClient } from "./storage-client";

export const SHIFT_PHASES = ["opening", "midshift", "closing"] as const;
export type ShiftPhase = (typeof SHIFT_PHASES)[number];

export const RUN_STATUSES = ["open", "finished"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const INCIDENT_KINDS = ["incident", "stock_out"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ["open", "seen", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const CASH_COUNT_STATES = [
	"no_count",
	"unmatched",
	"recorded",
	"no_reference",
	"over",
	"within",
] as const;
export type CashCountState = (typeof CASH_COUNT_STATES)[number];

export const REFUSAL = {
	notAllowed: "42501",
	duplicate: "23505",
	check: "23514",
	invalid: "22023",
	state: "55000",
} as const;

export const OPS_PHOTO_NAME = /^[a-z0-9_-]{1,64}\.jpg$/;
export const MAX_INCIDENT_PHOTOS = 3;

export interface PhotoTarget {
	readonly bucket: string;
	readonly prefix: string;
}

export interface DueChecklist {
	readonly templateId: string;
	readonly title: string;
	readonly shiftPhase: ShiftPhase;
	readonly templateVersion: number;
	readonly everyStore: boolean;
	readonly items: number;
	readonly photoItems: number;
	readonly businessDate: string;
	readonly run: {
		readonly id: string;
		readonly status: RunStatus;
		readonly startedBy: string | null;
		readonly startedAt: string;
		readonly finishedAt: string | null;
	} | null;
}

export interface ChecklistItem {
	readonly answerId: string;
	readonly itemId: string;
	readonly position: number;
	readonly label: string;
	readonly requiresPhoto: boolean;
	readonly numberUnit: string | null;
	readonly done: boolean;
	readonly numberValue: number | null;
	readonly photoPath: string | null;
	readonly photoRemoved: boolean;
	readonly answeredBy: string | null;
	readonly answeredAt: string | null;
}

export interface ChecklistRun {
	readonly runId: string;
	readonly storeId: string;
	readonly templateId: string;
	readonly templateVersion: number;
	readonly title: string;
	readonly shiftPhase: ShiftPhase;
	readonly businessDate: string;
	readonly status: RunStatus;
	readonly startedBy: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly photo: PhotoTarget | null;
	readonly itemsTotal: number;
	readonly itemsDone: number;
	readonly items: readonly ChecklistItem[];
}

export interface ChecklistAnswerChange {
	readonly answerId: string;
	readonly done: boolean;
	readonly numberValue: number | null;
	readonly photoPath: string | null;
}

export interface ChecklistAnswer extends ChecklistAnswerChange {
	readonly runId: string;
	readonly itemId: string;
	readonly photoRemoved: boolean;
	readonly answeredBy: string | null;
	readonly answeredAt: string | null;
}

export interface CashCountInput {
	readonly storeId: string;
	readonly amount: number;
	readonly denominations: Readonly<Record<string, number>> | null;
	readonly note: string | null;
	readonly replacesId: string | null;
}

export interface CashCountReceipt {
	readonly cashCountId: string;
	readonly businessDate: string;
	readonly countedAt: string;
	readonly matched: boolean;
}

export interface CashCountRow {
	readonly storeId: string;
	readonly businessDate: string;
	readonly shiftId: string | null;
	readonly shiftNumber: number | null;
	readonly openedAt: string | null;
	readonly closedAt: string | null;
	readonly cashCountId: string | null;
	readonly countedAmount: number | null;
	readonly countedBy: string | null;
	readonly countedAt: string | null;
	readonly recounts: number;
	readonly expectedCash: number | null;
	readonly variance: number | null;
	readonly overAbs: boolean;
	readonly overRel: boolean;
	readonly overZ: boolean;
	readonly state: CashCountState;
}

export interface CashCountRecord {
	readonly id: string;
	readonly storeId: string;
	readonly businessDate: string;
	readonly countedAt: string;
	readonly status: "active" | "reopened";
	readonly replacesId: string | null;
	readonly reopenedAt: string | null;
	readonly createdBy: string | null;
}

export interface HandoverInput {
	readonly storeId: string;
	readonly fromShift: number;
	readonly toShift: number;
	readonly note: string;
}

export interface HandoverReceipt {
	readonly handoverId: string;
	readonly businessDate: string;
}

export interface Handover {
	readonly id: string;
	readonly storeId: string;
	readonly businessDate: string;
	readonly fromShift: number;
	readonly toShift: number;
	readonly note: string;
	readonly createdBy: string | null;
	readonly createdAt: string;
	readonly acknowledgedAt: string | null;
}

export interface IncidentInput {
	readonly storeId: string;
	readonly kind: IncidentKind;
	readonly categoryKey: string;
	readonly description: string;
	readonly itemLabel: string | null;
}

export interface IncidentReceipt {
	readonly incidentId: string;
	readonly businessDate: string;
	readonly photo: PhotoTarget | null;
}

export interface IncidentChange {
	readonly incidentId: string;
	readonly categoryKey: string;
	readonly description: string;
	readonly itemLabel: string | null;
	readonly photoPaths: readonly string[];
}

export interface Incident {
	readonly id: string;
	readonly storeId: string;
	readonly businessDate: string;
	readonly occurredAt: string;
	readonly kind: IncidentKind;
	readonly categoryKey: string;
	readonly description: string;
	readonly itemLabel: string | null;
	readonly photoBucket: string | null;
	readonly photoPaths: readonly string[];
	readonly status: IncidentStatus;
	readonly createdBy: string | null;
	readonly createdAt: string;
}

export interface IncidentCategory {
	readonly key: string;
	readonly label: string;
	readonly active: boolean;
}

export interface OpsClient {
	readonly memberId: string | null;
	dueChecklists(storeId: string): Promise<DueChecklist[]>;
	startChecklistRun(templateId: string, storeId: string): Promise<ChecklistRun>;
	checklistRun(runId: string): Promise<ChecklistRun | null>;
	saveChecklistAnswer(change: ChecklistAnswerChange): Promise<ChecklistAnswer>;
	finishChecklistRun(runId: string): Promise<ChecklistRun>;
	uploadPhoto(
		target: PhotoTarget,
		photo: Blob,
		onProgress?: (fraction: number) => void,
	): Promise<string>;
	photo(bucket: string, path: string): Promise<Blob>;
	recordCashCount(input: CashCountInput): Promise<CashCountReceipt>;
	cashCountReview(
		storeIds: readonly string[],
		fromDate: string,
		toDate: string,
	): Promise<CashCountRow[]>;
	cashCounts(storeId: string, sinceDate: string): Promise<CashCountRecord[]>;
	reopenCashCount(cashCountId: string): Promise<void>;
	writeHandover(input: HandoverInput): Promise<HandoverReceipt>;
	updateHandover(
		handoverId: string,
		input: Omit<HandoverInput, "storeId">,
	): Promise<HandoverReceipt>;
	acknowledgeHandover(handoverId: string): Promise<void>;
	handovers(
		storeIds: readonly string[],
		sinceDate: string,
	): Promise<Handover[]>;
	reportIncident(input: IncidentInput): Promise<IncidentReceipt>;
	updateIncident(change: IncidentChange): Promise<void>;
	acknowledgeIncident(incidentId: string): Promise<IncidentStatus>;
	resolveIncident(incidentId: string): Promise<IncidentStatus>;
	incidents(storeIds: readonly string[]): Promise<Incident[]>;
	incidentCategories(tenantId: string): Promise<IncidentCategory[]>;
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the operations answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return isRecord(value) ? value : invalid(what);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" && value !== "" ? value : invalid(what);
}

function textOrNull(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : text(value, what);
}

function count(value: unknown, what: string): number {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isInteger(number) && number >= 0
		? number
		: invalid(what);
}

function amount(value: unknown, what: string): number {
	const number =
		typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof number === "number" && Number.isFinite(number)
		? number
		: invalid(what);
}

function amountOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : amount(value, what);
}

function flag(value: unknown, what: string): boolean {
	return typeof value === "boolean" ? value : invalid(what);
}

function oneOf<T extends string>(
	values: readonly T[],
	value: unknown,
	what: string,
): T {
	return values.find((candidate) => candidate === value) ?? invalid(what);
}

function photoTarget(bucket: unknown, prefix: unknown): PhotoTarget | null {
	if (bucket === null || bucket === undefined) return null;
	return {
		bucket: text(bucket, "photo bucket"),
		prefix: text(prefix, "photo prefix"),
	};
}

export function readDueChecklist(value: unknown): DueChecklist {
	const row = record(value, "checklist");
	const runId = textOrNull(row.run_id, "run");
	return {
		templateId: text(row.template_id, "checklist"),
		title: text(row.title, "title"),
		shiftPhase: oneOf(SHIFT_PHASES, row.shift_phase, "shift phase"),
		templateVersion: count(row.template_version, "version"),
		everyStore: row.every_store === true,
		items: count(row.items, "item count"),
		photoItems: count(row.photo_items, "photo item count"),
		businessDate: text(row.business_date, "business date"),
		run:
			runId === null
				? null
				: {
						id: runId,
						status: oneOf(RUN_STATUSES, row.run_status, "run status"),
						startedBy: textOrNull(row.run_started_by, "run actor"),
						startedAt: text(row.run_started_at, "run start"),
						finishedAt: textOrNull(row.run_finished_at, "run finish"),
					},
	};
}

export function readChecklistItem(value: unknown): ChecklistItem {
	const row = record(value, "item");
	return {
		answerId: text(row.answer_id, "answer"),
		itemId: text(row.item_id, "item"),
		position: count(row.position, "position"),
		label: text(row.label, "label"),
		requiresPhoto: flag(row.requires_photo, "photo flag"),
		numberUnit: textOrNull(row.number_unit, "unit"),
		done: flag(row.done, "done"),
		numberValue: amountOrNull(row.number_value, "number"),
		photoPath: textOrNull(row.photo_path, "photo"),
		photoRemoved: row.photo_removed === true,
		answeredBy: textOrNull(row.answered_by, "answerer"),
		answeredAt: textOrNull(row.answered_at, "answer time"),
	};
}

export function readChecklistRun(value: unknown): ChecklistRun {
	const row = record(value, "run");
	const items = Array.isArray(row.items) ? row.items : invalid("items");
	return {
		runId: text(row.run_id, "run"),
		storeId: text(row.store_id, "store"),
		templateId: text(row.template_id, "checklist"),
		templateVersion: count(row.template_version, "version"),
		title: text(row.title, "title"),
		shiftPhase: oneOf(SHIFT_PHASES, row.shift_phase, "shift phase"),
		businessDate: text(row.business_date, "business date"),
		status: oneOf(RUN_STATUSES, row.status, "status"),
		startedBy: textOrNull(row.started_by, "actor"),
		startedAt: text(row.started_at, "start"),
		finishedAt: textOrNull(row.finished_at, "finish"),
		photo: photoTarget(row.photo_bucket, row.photo_prefix),
		itemsTotal: count(row.items_total, "item total"),
		itemsDone: count(row.items_done, "items done"),
		items: items.map(readChecklistItem),
	};
}

export function readChecklistAnswer(value: unknown): ChecklistAnswer {
	const row = record(value, "answer");
	return {
		answerId: text(row.answer_id, "answer"),
		runId: text(row.run_id, "run"),
		itemId: text(row.item_id, "item"),
		done: flag(row.done, "done"),
		numberValue: amountOrNull(row.number_value, "number"),
		photoPath: textOrNull(row.photo_path, "photo"),
		photoRemoved: row.photo_removed === true,
		answeredBy: textOrNull(row.answered_by, "answerer"),
		answeredAt: textOrNull(row.answered_at, "answer time"),
	};
}

export function readCashCountReceipt(value: unknown): CashCountReceipt {
	const row = record(value, "count");
	return {
		cashCountId: text(row.cash_count_id, "count"),
		businessDate: text(row.business_date, "business date"),
		countedAt: text(row.counted_at, "count time"),
		matched: flag(row.matched, "match"),
	};
}

export function readCashCountRow(value: unknown): CashCountRow {
	const row = record(value, "shift");
	return {
		storeId: text(row.store_id, "store"),
		businessDate: text(row.business_date, "business date"),
		shiftId: textOrNull(row.shift_id, "shift"),
		shiftNumber:
			row.shift_number === null || row.shift_number === undefined
				? null
				: count(row.shift_number, "shift number"),
		openedAt: textOrNull(row.opened_at, "opening"),
		closedAt: textOrNull(row.closed_at, "close"),
		cashCountId: textOrNull(row.cash_count_id, "count"),
		countedAmount: amountOrNull(row.counted_amount, "counted amount"),
		countedBy: textOrNull(row.counted_by, "counter"),
		countedAt: textOrNull(row.counted_at, "count time"),
		recounts:
			row.recounts === null || row.recounts === undefined
				? 0
				: count(row.recounts, "recounts"),
		expectedCash: amountOrNull(row.expected_cash_amount, "expected cash"),
		variance: amountOrNull(row.variance_amount, "difference"),
		overAbs: row.over_abs_threshold === true,
		overRel: row.over_rel_threshold === true,
		overZ: row.over_z_threshold === true,
		state: oneOf(CASH_COUNT_STATES, row.state, "state"),
	};
}

export function readCashCountRecord(value: unknown): CashCountRecord {
	const row = record(value, "count");
	return {
		id: text(row.id, "count"),
		storeId: text(row.store_id, "store"),
		businessDate: text(row.business_date, "business date"),
		countedAt: text(row.counted_at, "count time"),
		status: oneOf(["active", "reopened"] as const, row.status, "status"),
		replacesId: textOrNull(row.replaces_id, "replaced count"),
		reopenedAt: textOrNull(row.reopened_at, "reopening"),
		createdBy: textOrNull(row.created_by, "counter"),
	};
}

export function readHandover(value: unknown): Handover {
	const row = record(value, "handover");
	return {
		id: text(row.id, "handover"),
		storeId: text(row.store_id, "store"),
		businessDate: text(row.business_date, "business date"),
		fromShift: count(row.from_shift, "from shift"),
		toShift: count(row.to_shift, "to shift"),
		note: text(row.note, "note"),
		createdBy: textOrNull(row.created_by, "writer"),
		createdAt: text(row.created_at, "time"),
		acknowledgedAt: textOrNull(row.acknowledged_at, "acknowledgement"),
	};
}

export function readIncident(value: unknown): Incident {
	const row = record(value, "report");
	const paths = Array.isArray(row.photo_paths) ? row.photo_paths : [];
	return {
		id: text(row.id, "report"),
		storeId: text(row.store_id, "store"),
		businessDate: text(row.business_date, "business date"),
		occurredAt: text(row.occurred_at, "time"),
		kind: oneOf(INCIDENT_KINDS, row.kind, "kind"),
		categoryKey: text(row.category_key, "category"),
		description: text(row.description, "description"),
		itemLabel: textOrNull(row.item_label, "item"),
		photoBucket: textOrNull(row.photo_bucket, "photo bucket"),
		photoPaths: paths.map((path) => text(path, "photo")),
		status: oneOf(INCIDENT_STATUSES, row.status, "status"),
		createdBy: textOrNull(row.created_by, "reporter"),
		createdAt: text(row.created_at, "time"),
	};
}

export function readIncidentCategory(value: unknown): IncidentCategory {
	const row = record(value, "category");
	return {
		key: text(row.key, "category"),
		label: text(row.label, "category label"),
		active: row.active !== false,
	};
}

function rows(value: unknown, what: string): unknown[] {
	return Array.isArray(value) ? value : invalid(what);
}

const SUBJECT =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function tokenSubject(accessToken: string): string | null {
	const payload = accessToken.split(".")[1];
	if (payload === undefined || payload === "") return null;
	try {
		const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
		const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		const claims: unknown = JSON.parse(json);
		const sub = isRecord(claims) ? claims.sub : null;
		return typeof sub === "string" && SUBJECT.test(sub) ? sub : null;
	} catch {
		return null;
	}
}

export function photoName(random: () => number = Math.random): string {
	const time = Date.now().toString(36);
	const tail = Math.floor(random() * 36 ** 6)
		.toString(36)
		.padStart(6, "0");
	return `p-${time}-${tail}.jpg`;
}

export function photoPathIn(target: PhotoTarget, name: string): string {
	if (!OPS_PHOTO_NAME.test(name)) throw new Error("not a photo name");
	return `${target.prefix.replace(/\/*$/, "/")}${name}`;
}

function inList(ids: readonly string[]): string {
	return `in.(${ids.join(",")})`;
}

export function createRestOpsClient(
	rest: RestClient,
	storage: StorageClient,
	accessToken: string,
): OpsClient {
	const answer = async (fn: string, args: Row) => {
		const value = await rest.rpc(fn, args);
		if (value === null) throw new RestError(REST_NETWORK_FAILURE);
		return value;
	};
	return {
		memberId: tokenSubject(accessToken),
		async dueChecklists(storeId) {
			return rows(
				await rest.rpc("due_checklists", { p_store_id: storeId }),
				"checklists",
			).map(readDueChecklist);
		},
		async startChecklistRun(templateId, storeId) {
			return readChecklistRun(
				await answer("start_checklist_run", {
					p_template_id: templateId,
					p_store_id: storeId,
				}),
			);
		},
		async checklistRun(runId) {
			const value = await rest.rpc("checklist_run_detail", {
				p_run_id: runId,
			});
			return value === null ? null : readChecklistRun(value);
		},
		async saveChecklistAnswer(change) {
			return readChecklistAnswer(
				await answer("save_checklist_answer", {
					p_answer_id: change.answerId,
					p_done: change.done,
					p_number_value: change.numberValue,
					p_photo_path: change.photoPath,
				}),
			);
		},
		async finishChecklistRun(runId) {
			return readChecklistRun(
				await answer("finish_checklist_run", { p_run_id: runId }),
			);
		},
		async uploadPhoto(target, photo, onProgress) {
			const path = photoPathIn(target, photoName());
			await storage.upload(target.bucket, path, photo, {
				contentType: "image/jpeg",
				...(onProgress === undefined ? {} : { onProgress }),
			});
			return path;
		},
		photo(bucket, path) {
			return storage.download(bucket, path);
		},
		async recordCashCount(input) {
			return readCashCountReceipt(
				await answer("record_cash_count", {
					p_store_id: input.storeId,
					p_counted_amount: input.amount,
					p_denominations: input.denominations,
					p_note: input.note,
					p_replaces_id: input.replacesId,
				}),
			);
		},
		async cashCountReview(storeIds, fromDate, toDate) {
			return rows(
				await rest.rpc("cash_count_review", {
					store_ids: storeIds,
					from_date: fromDate,
					to_date: toDate,
				}),
				"shifts",
			).map(readCashCountRow);
		},
		async cashCounts(storeId, sinceDate) {
			return (
				await rest.select("cash_counts", {
					select:
						"id,store_id,business_date,counted_at,status,replaces_id,reopened_at,created_by",
					store_id: `eq.${storeId}`,
					business_date: `gte.${sinceDate}`,
					order: "counted_at.desc",
					limit: "50",
				})
			).map(readCashCountRecord);
		},
		async reopenCashCount(cashCountId) {
			await answer("reopen_cash_count", { p_cash_count_id: cashCountId });
		},
		async writeHandover(input) {
			const row = record(
				await answer("write_handover", {
					p_store_id: input.storeId,
					p_from_shift: input.fromShift,
					p_to_shift: input.toShift,
					p_note: input.note,
				}),
				"handover",
			);
			return {
				handoverId: text(row.handover_id, "handover"),
				businessDate: text(row.business_date, "business date"),
			};
		},
		async updateHandover(handoverId, input) {
			const row = record(
				await answer("update_handover", {
					p_handover_id: handoverId,
					p_from_shift: input.fromShift,
					p_to_shift: input.toShift,
					p_note: input.note,
				}),
				"handover",
			);
			return {
				handoverId: text(row.handover_id, "handover"),
				businessDate: text(row.business_date, "business date"),
			};
		},
		async acknowledgeHandover(handoverId) {
			await answer("acknowledge_handover", { p_handover_id: handoverId });
		},
		async handovers(storeIds, sinceDate) {
			if (storeIds.length === 0) return [];
			return (
				await rest.select("shift_handovers", {
					select:
						"id,store_id,business_date,from_shift,to_shift,note,created_by,created_at,acknowledged_at",
					store_id: inList(storeIds),
					business_date: `gte.${sinceDate}`,
					order: "created_at.desc",
					limit: "30",
				})
			).map(readHandover);
		},
		async reportIncident(input) {
			const row = record(
				await answer("report_incident", {
					p_store_id: input.storeId,
					p_kind: input.kind,
					p_category_key: input.categoryKey,
					p_description: input.description,
					p_item_label: input.itemLabel,
				}),
				"report",
			);
			return {
				incidentId: text(row.incident_id, "report"),
				businessDate: text(row.business_date, "business date"),
				photo: photoTarget(row.photo_bucket, row.photo_prefix),
			};
		},
		async updateIncident(change) {
			await answer("update_incident", {
				p_incident_id: change.incidentId,
				p_category_key: change.categoryKey,
				p_description: change.description,
				p_item_label: change.itemLabel,
				p_photo_paths: change.photoPaths,
			});
		},
		async acknowledgeIncident(incidentId) {
			const row = record(
				await answer("acknowledge_incident", { p_incident_id: incidentId }),
				"report",
			);
			return oneOf(INCIDENT_STATUSES, row.status, "status");
		},
		async resolveIncident(incidentId) {
			const row = record(
				await answer("resolve_incident", { p_incident_id: incidentId }),
				"report",
			);
			return oneOf(INCIDENT_STATUSES, row.status, "status");
		},
		async incidents(storeIds) {
			if (storeIds.length === 0) return [];
			return (
				await rest.select("incidents", {
					select:
						"id,store_id,business_date,occurred_at,kind,category_key,description,item_label,photo_bucket,photo_paths,status,created_by,created_at",
					store_id: inList(storeIds),
					status: "in.(open,seen)",
					order: "occurred_at.desc",
					limit: "30",
				})
			).map(readIncident);
		},
		async incidentCategories(tenantId) {
			return rows(
				await rest.rpc("incident_categories_of", { p_tenant_id: tenantId }),
				"categories",
			).map(readIncidentCategory);
		},
	};
}
