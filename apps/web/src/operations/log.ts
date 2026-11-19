import type { IsoDate } from "@fnb/reports";
import type { LogKind } from "./labels";
import type {
	HandoverRow,
	IncidentCategory,
	IncidentRow,
	ReportStatus,
} from "./source";
import { REPORT_STATUSES } from "./source";

export const LOG_KINDS: readonly LogKind[] = [
	"incident",
	"stock_out",
	"handover",
];

export interface LogEntry {
	readonly key: string;
	readonly id: string;
	readonly kind: LogKind;
	readonly storeId: string;
	readonly businessDate: IsoDate;
	readonly at: string;
	readonly categoryKey: string | null;
	readonly text: string;
	readonly fromShift: number | null;
	readonly toShift: number | null;
	readonly itemLabel: string | null;
	readonly photoBucket: string | null;
	readonly photoPaths: readonly string[];
	readonly photosRemoved: boolean;
	readonly status: ReportStatus;
	readonly reportedBy: string | null;
	readonly seenBy: string | null;
	readonly seenAt: string | null;
	readonly resolvedBy: string | null;
	readonly resolvedAt: string | null;
}

export interface LogFilters {
	readonly kind: LogKind | null;
	readonly category: string | null;
	readonly status: ReportStatus | null;
}

function incidentEntry(row: IncidentRow): LogEntry {
	return {
		key: `incident:${row.id}`,
		id: row.id,
		kind: row.kind,
		storeId: row.storeId,
		businessDate: row.businessDate,
		at: row.occurredAt,
		categoryKey: row.categoryKey,
		text: row.description,
		fromShift: null,
		toShift: null,
		itemLabel: row.itemLabel,
		photoBucket: row.photoBucket,
		photoPaths: row.photoPaths,
		photosRemoved: row.photosRemoved,
		status: row.status,
		reportedBy: row.reportedBy,
		seenBy: row.acknowledgedBy,
		seenAt: row.acknowledgedAt,
		resolvedBy: row.resolvedBy,
		resolvedAt: row.resolvedAt,
	};
}

function handoverEntry(row: HandoverRow): LogEntry {
	return {
		key: `handover:${row.id}`,
		id: row.id,
		kind: "handover",
		storeId: row.storeId,
		businessDate: row.businessDate,
		at: row.writtenAt,
		categoryKey: null,
		text: row.note,
		fromShift: row.fromShift,
		toShift: row.toShift,
		itemLabel: null,
		photoBucket: null,
		photoPaths: [],
		photosRemoved: false,
		status: row.acknowledgedAt === null ? "open" : "seen",
		reportedBy: row.writtenBy,
		seenBy: row.acknowledgedBy,
		seenAt: row.acknowledgedAt,
		resolvedBy: null,
		resolvedAt: null,
	};
}

export function logEntries(
	incidents: readonly IncidentRow[],
	handovers: readonly HandoverRow[],
): LogEntry[] {
	return [
		...incidents.map(incidentEntry),
		...handovers.map(handoverEntry),
	].sort((left, right) =>
		left.at === right.at
			? left.key < right.key
				? -1
				: 1
			: left.at < right.at
				? 1
				: -1,
	);
}

function isLogKind(value: string): value is LogKind {
	return (LOG_KINDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is ReportStatus {
	return (REPORT_STATUSES as readonly string[]).includes(value);
}

export function logFiltersOf(
	params: Readonly<Partial<Record<"kind" | "category" | "status", string>>>,
	categories: readonly IncidentCategory[] | undefined,
): LogFilters {
	const kind = params.kind;
	const status = params.status;
	const category = params.category;
	return {
		kind: kind !== undefined && isLogKind(kind) ? kind : null,
		status: status !== undefined && isStatus(status) ? status : null,
		category:
			category !== undefined &&
			(categories === undefined ||
				categories.some((candidate) => candidate.key === category))
				? category
				: null,
	};
}

export function filteredEntries(
	entries: readonly LogEntry[],
	filters: LogFilters,
): LogEntry[] {
	return entries.filter(
		(entry) =>
			(filters.kind === null || entry.kind === filters.kind) &&
			(filters.status === null || entry.status === filters.status) &&
			(filters.category === null || entry.categoryKey === filters.category),
	);
}

export interface LogSummary {
	readonly total: number;
	readonly incidents: number;
	readonly stockOuts: number;
	readonly handovers: number;
	readonly open: number;
	readonly seen: number;
	readonly resolved: number;
}

export function logSummary(entries: readonly LogEntry[]): LogSummary {
	const count = (test: (entry: LogEntry) => boolean) =>
		entries.filter(test).length;
	return {
		total: entries.length,
		incidents: count((entry) => entry.kind === "incident"),
		stockOuts: count((entry) => entry.kind === "stock_out"),
		handovers: count((entry) => entry.kind === "handover"),
		open: count((entry) => entry.status === "open"),
		seen: count((entry) => entry.status === "seen"),
		resolved: count((entry) => entry.status === "resolved"),
	};
}

export function categoryLabel(
	categories: readonly IncidentCategory[] | undefined,
	key: string | null,
): string | null {
	if (key === null) return null;
	return categories?.find((category) => category.key === key)?.label ?? key;
}
