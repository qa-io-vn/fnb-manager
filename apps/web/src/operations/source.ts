import type { IsoDate } from "@fnb/reports";
import type { AuditEntry, TenantRole } from "../settings/source";
import type { AnnouncementsSource } from "./announcements-source";

export const SHIFT_PHASES = ["opening", "midshift", "closing"] as const;

export type ShiftPhase = (typeof SHIFT_PHASES)[number];

export const CHECKLIST_TITLE_MAX = 120;
export const CHECKLIST_ITEM_LABEL_MAX = 200;
export const CHECKLIST_UNIT_MAX = 16;
export const CHECKLIST_ITEMS_MAX = 60;

export interface ChecklistItemDraft {
	readonly label: string;
	readonly requiresPhoto: boolean;
	readonly numberUnit: string | null;
}

export interface ChecklistItem extends ChecklistItemDraft {
	readonly id: string;
	readonly position: number;
}

export interface ChecklistTemplate {
	readonly id: string;
	readonly storeId: string | null;
	readonly phase: ShiftPhase;
	readonly title: string;
	readonly active: boolean;
	readonly version: number;
	readonly items: readonly ChecklistItem[];
	readonly createdAt: string;
	readonly audit: AuditEntry | null;
}

export interface ChecklistTemplateChange {
	readonly templateId: string | null;
	readonly storeId: string | null;
	readonly phase: ShiftPhase;
	readonly title: string;
	readonly items: readonly ChecklistItemDraft[];
}

export interface SavedChecklistTemplate {
	readonly templateId: string;
	readonly version: number;
	readonly active: boolean;
}

export type RunStatus = "open" | "finished";

export interface ChecklistRun {
	readonly id: string;
	readonly storeId: string;
	readonly templateId: string;
	readonly templateVersion: number;
	readonly title: string;
	readonly phase: ShiftPhase;
	readonly businessDate: IsoDate;
	readonly status: RunStatus;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly startedBy: string | null;
	readonly itemsTotal: number;
	readonly itemsDone: number;
	readonly photos: number;
	readonly photosRemoved: number;
	readonly corrections: number;
}

export interface RunDetailItem {
	readonly answerId: string;
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

export interface AnswerValues {
	readonly done: boolean | null;
	readonly numberValue: number | null;
	readonly photoPath: string | null;
}

export interface RunCorrection {
	readonly id: string;
	readonly answerId: string;
	readonly before: AnswerValues;
	readonly after: AnswerValues;
	readonly by: string | null;
	readonly at: string;
}

export interface RunDetail {
	readonly runId: string;
	readonly storeId: string;
	readonly title: string;
	readonly phase: ShiftPhase;
	readonly businessDate: IsoDate;
	readonly templateVersion: number;
	readonly status: RunStatus;
	readonly startedBy: string | null;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly photoBucket: string | null;
	readonly items: readonly RunDetailItem[];
	readonly corrections: readonly RunCorrection[];
}

export const CASH_COUNT_STATES = [
	"no_count",
	"unmatched",
	"recorded",
	"no_reference",
	"over",
	"within",
] as const;

export type CashCountState = (typeof CASH_COUNT_STATES)[number];

export interface CashCountRow {
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly shiftId: string | null;
	readonly shiftNumber: number | null;
	readonly openedAt: string | null;
	readonly closedAt: string | null;
	readonly cashCountId: string | null;
	readonly countedAmount: number | null;
	readonly countedBy: string | null;
	readonly countedAt: string | null;
	readonly recounts: number | null;
	readonly expectedCashAmount: number | null;
	readonly drawerAmount: number | null;
	readonly cashSalesAmount: number | null;
	readonly varianceAmount: number | null;
	readonly drawerVarianceAmount: number | null;
	readonly overAbs: boolean;
	readonly overRel: boolean;
	readonly overZ: boolean;
	readonly state: CashCountState;
}

export const INCIDENT_KINDS = ["incident", "stock_out"] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const REPORT_STATUSES = ["open", "seen", "resolved"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface IncidentRow {
	readonly id: string;
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly occurredAt: string;
	readonly kind: IncidentKind;
	readonly categoryKey: string;
	readonly description: string;
	readonly itemLabel: string | null;
	readonly photoBucket: string | null;
	readonly photoPaths: readonly string[];
	readonly photosRemoved: boolean;
	readonly status: ReportStatus;
	readonly reportedBy: string | null;
	readonly acknowledgedBy: string | null;
	readonly acknowledgedAt: string | null;
	readonly resolvedBy: string | null;
	readonly resolvedAt: string | null;
}

export interface HandoverRow {
	readonly id: string;
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly fromShift: number;
	readonly toShift: number;
	readonly note: string;
	readonly writtenBy: string | null;
	readonly writtenAt: string;
	readonly acknowledgedBy: string | null;
	readonly acknowledgedAt: string | null;
}

export interface IncidentCategory {
	readonly key: string;
	readonly label: string;
	readonly sortOrder: number;
	readonly active: boolean;
}

export interface Actor {
	readonly name: string | null;
	readonly role: TenantRole | null;
}

export interface Actors {
	readonly currentUserId: string | null;
	readonly byId: ReadonlyMap<string, Actor>;
}

export interface OperationsSource extends AnnouncementsSource {
	readonly kind: "supabase";
	checklistTemplates(tenantId: string): Promise<ChecklistTemplate[]>;
	saveChecklistTemplate(
		tenantId: string,
		change: ChecklistTemplateChange,
	): Promise<SavedChecklistTemplate>;
	setChecklistTemplateActive(
		templateId: string,
		active: boolean,
	): Promise<boolean>;
	checklistRuns(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<ChecklistRun[]>;
	runDetail(runId: string): Promise<RunDetail | null>;
	photo(bucket: string, path: string): Promise<Blob>;
	cashCounts(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<CashCountRow[]>;
	reopenCashCount(cashCountId: string): Promise<void>;
	incidents(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<IncidentRow[]>;
	handovers(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
	): Promise<HandoverRow[]>;
	incidentCategories(tenantId: string): Promise<IncidentCategory[]>;
	acknowledgeIncident(incidentId: string): Promise<void>;
	resolveIncident(incidentId: string): Promise<void>;
	acknowledgeHandover(handoverId: string): Promise<void>;
	actors(tenantId: string): Promise<Actors>;
}
