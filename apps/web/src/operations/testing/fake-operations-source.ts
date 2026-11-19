import {
	type SettingsWriteCode,
	SettingsWriteError,
} from "../../settings/source";
import type {
	Actors,
	CashCountRow,
	ChecklistRun,
	ChecklistTemplate,
	ChecklistTemplateChange,
	HandoverRow,
	IncidentCategory,
	IncidentRow,
	OperationsSource,
	RunDetail,
} from "../source";
import {
	emptyAnnouncementsData,
	type FakeAnnouncementsData,
	fakeAnnouncementMethods,
} from "./fake-announcements";

export interface FakeOperationsData extends FakeAnnouncementsData {
	templates: ChecklistTemplate[];
	runs: ChecklistRun[];
	details: Map<string, RunDetail>;
	cash: CashCountRow[];
	incidents: IncidentRow[];
	handovers: HandoverRow[];
	categories: IncidentCategory[];
	actors: Actors;
}

export interface FakeOperations extends OperationsSource {
	readonly data: FakeOperationsData;
	readonly calls: [string, unknown][];
	refuse(method: string, code: SettingsWriteCode): void;
}

export const DEFAULT_CATEGORIES: IncidentCategory[] = [
	{ key: "thiet_bi", label: "Thiết bị", sortOrder: 10, active: true },
	{ key: "ve_sinh", label: "Vệ sinh", sortOrder: 20, active: true },
	{ key: "khac", label: "Khác", sortOrder: 90, active: true },
];

export function createFakeOperations(
	seed: Partial<FakeOperationsData> = {},
): FakeOperations {
	const data: FakeOperationsData = {
		templates: [],
		runs: [],
		details: new Map(),
		cash: [],
		incidents: [],
		handovers: [],
		categories: DEFAULT_CATEGORIES,
		actors: { currentUserId: "owner-1", byId: new Map() },
		...emptyAnnouncementsData(),
		...seed,
	};
	const calls: [string, unknown][] = [];
	const refusals = new Map<string, SettingsWriteCode>();
	let next = 1;
	const record = (method: string, args: unknown) => {
		calls.push([method, args]);
		const code = refusals.get(method);
		if (code !== undefined) throw new SettingsWriteError(code);
	};
	const between = (date: string, from: string, to: string) =>
		date >= from && date <= to;
	return {
		kind: "supabase",
		data,
		...fakeAnnouncementMethods(data, record, () => data.actors.currentUserId),
		calls,
		refuse(method, code) {
			refusals.set(method, code);
		},
		async checklistTemplates() {
			return data.templates.map((template) => ({ ...template }));
		},
		async saveChecklistTemplate(_tenantId, change: ChecklistTemplateChange) {
			record("saveChecklistTemplate", change);
			const existing = data.templates.find(
				(template) => template.id === change.templateId,
			);
			const id = existing?.id ?? `template-new-${next++}`;
			const version = (existing?.version ?? 0) + 1;
			const saved: ChecklistTemplate = {
				id,
				storeId: change.storeId,
				phase: change.phase,
				title: change.title,
				active: existing?.active ?? true,
				version,
				items: change.items.map((item, index) => ({
					...item,
					id: `${id}-v${version}-${index + 1}`,
					position: index + 1,
				})),
				createdAt: existing?.createdAt ?? "2026-11-18T01:00:00Z",
				audit: { changedAt: "2026-11-18T01:00:00Z", author: { kind: "you" } },
			};
			data.templates = [
				...data.templates.filter((template) => template.id !== id),
				saved,
			];
			return { templateId: id, version, active: saved.active };
		},
		async setChecklistTemplateActive(templateId, active) {
			record("setChecklistTemplateActive", { templateId, active });
			data.templates = data.templates.map((template) =>
				template.id === templateId ? { ...template, active } : template,
			);
			return active;
		},
		async checklistRuns(storeIds, from, to) {
			return data.runs.filter(
				(run) =>
					storeIds.includes(run.storeId) && between(run.businessDate, from, to),
			);
		},
		async runDetail(runId) {
			return data.details.get(runId) ?? null;
		},
		async photo(bucket, path) {
			record("photo", { bucket, path });
			return new Blob([path], { type: "image/jpeg" });
		},
		async cashCounts(storeIds, from, to) {
			return data.cash.filter(
				(row) =>
					storeIds.includes(row.storeId) && between(row.businessDate, from, to),
			);
		},
		async reopenCashCount(cashCountId) {
			record("reopenCashCount", cashCountId);
			data.cash = data.cash.map((row) =>
				row.cashCountId === cashCountId
					? {
							...row,
							cashCountId: null,
							countedAmount: null,
							countedBy: null,
							countedAt: null,
							recounts: null,
							varianceAmount: null,
							state: "no_count",
						}
					: row,
			);
		},
		async incidents(storeIds, from, to) {
			return data.incidents.filter(
				(row) =>
					storeIds.includes(row.storeId) && between(row.businessDate, from, to),
			);
		},
		async handovers(storeIds, from, to) {
			return data.handovers.filter(
				(row) =>
					storeIds.includes(row.storeId) && between(row.businessDate, from, to),
			);
		},
		async incidentCategories() {
			return data.categories;
		},
		async acknowledgeIncident(incidentId) {
			record("acknowledgeIncident", incidentId);
			data.incidents = data.incidents.map((row) =>
				row.id === incidentId && row.status === "open"
					? {
							...row,
							status: "seen",
							acknowledgedBy: data.actors.currentUserId,
							acknowledgedAt: "2026-11-18T03:00:00Z",
						}
					: row,
			);
		},
		async resolveIncident(incidentId) {
			record("resolveIncident", incidentId);
			data.incidents = data.incidents.map((row) =>
				row.id === incidentId
					? {
							...row,
							status: "resolved",
							acknowledgedBy: row.acknowledgedBy ?? data.actors.currentUserId,
							acknowledgedAt: row.acknowledgedAt ?? "2026-11-18T03:00:00Z",
							resolvedBy: data.actors.currentUserId,
							resolvedAt: "2026-11-18T03:00:00Z",
						}
					: row,
			);
		},
		async acknowledgeHandover(handoverId) {
			record("acknowledgeHandover", handoverId);
			data.handovers = data.handovers.map((row) =>
				row.id === handoverId
					? {
							...row,
							acknowledgedBy: data.actors.currentUserId,
							acknowledgedAt: "2026-11-18T03:00:00Z",
						}
					: row,
			);
		},
		async actors() {
			return data.actors;
		},
	};
}
