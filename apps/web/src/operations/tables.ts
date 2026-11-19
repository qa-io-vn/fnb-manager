import type {
	TableColumn,
	TableRow,
	TableSpec,
} from "../components/report-card/types";
import type { Translate } from "../i18n";
import type { Formatters } from "../lib/format";
import type { ComplianceRow } from "./compliance";
import {
	actorName,
	CASH_STATE_KEYS,
	COMPLIANCE_LABEL_KEYS,
	cashReasons,
	LOG_KIND_KEYS,
	moment,
	PHASE_LABEL_KEYS,
	STATUS_KEYS,
	shiftLabel,
	storeNameOf,
} from "./labels";
import { categoryLabel, type LogEntry } from "./log";
import type { Actors, CashCountRow, IncidentCategory } from "./source";

export interface TableContext {
	readonly t: Translate;
	readonly formatters: Formatters;
	readonly stores: readonly { readonly id: string; readonly name: string }[];
	readonly actors: Actors | undefined;
	readonly timeZone: string;
}

function column(
	t: Translate,
	key: string,
	labelKey: Parameters<Translate>[0],
	kind: TableColumn["kind"],
): TableColumn {
	return { key, label: t(labelKey), kind };
}

function withStore(
	context: TableContext,
	columns: readonly TableColumn[],
): TableColumn[] {
	if (context.stores.length < 2) return [...columns];
	const [first, ...rest] = columns;
	return [
		...(first === undefined ? [] : [first]),
		column(context.t, "store", "operations.column.store", "text"),
		...rest,
	];
}

export function complianceTable(
	rows: readonly ComplianceRow[],
	context: TableContext,
): TableSpec {
	const { t } = context;
	const columns = withStore(context, [
		column(t, "date", "operations.column.date", "date"),
		column(t, "phase", "operations.column.phase", "text"),
		column(t, "checklist", "operations.column.checklist", "text"),
		column(t, "status", "operations.column.status", "text"),
		column(t, "items", "operations.column.items", "text"),
		column(t, "photos", "operations.column.photos", "count"),
		column(t, "actor", "operations.column.actor", "text"),
		column(t, "finished", "operations.column.finished", "text"),
		column(t, "deadline", "operations.column.deadline", "text"),
		column(t, "corrections", "operations.column.corrections", "count"),
	]);
	return {
		caption: t("operations.checklist.table"),
		columns,
		rows: rows.map(
			(row): TableRow => ({
				id: row.key,
				cells: {
					date: row.businessDate,
					store: storeNameOf(context.stores, row.storeId),
					phase: t(PHASE_LABEL_KEYS[row.phase]),
					checklist: row.title,
					status: t(COMPLIANCE_LABEL_KEYS[row.status]),
					items:
						row.run === null
							? null
							: t("operations.checklist.itemsDone", {
									done: row.run.itemsDone,
									total: row.run.itemsTotal,
								}),
					photos: row.run === null ? null : row.run.photos,
					actor: actorName(t, context.actors, row.run?.startedBy ?? null),
					finished: moment(
						context.formatters,
						row.run?.finishedAt ?? null,
						context.timeZone,
					),
					deadline:
						row.deadline === null
							? null
							: moment(
									context.formatters,
									row.deadline.toISOString(),
									context.timeZone,
								),
					corrections: row.run === null ? null : row.run.corrections,
				},
			}),
		),
	};
}

export function cashTable(
	rows: readonly CashCountRow[],
	context: TableContext,
): TableSpec {
	const { t } = context;
	const columns = withStore(context, [
		column(t, "date", "operations.column.date", "date"),
		column(t, "shift", "operations.column.shift", "text"),
		column(t, "closed", "operations.column.closed", "text"),
		column(t, "counted", "operations.column.counted", "money"),
		column(t, "drawer", "operations.column.drawer", "money"),
		column(t, "expected", "operations.column.expected", "money"),
		column(t, "variance", "operations.column.variance", "money"),
		column(t, "status", "operations.column.status", "text"),
		column(t, "reasons", "operations.column.reasons", "text"),
		column(t, "counter", "operations.column.counter", "text"),
		column(t, "countedAt", "operations.column.countedAt", "text"),
		column(t, "recounts", "operations.column.recounts", "count"),
	]);
	return {
		caption: t("operations.cash.table"),
		columns,
		rows: rows.map(
			(row, index): TableRow => ({
				id: row.shiftId ?? row.cashCountId ?? `row-${index + 1}`,
				cells: {
					date: row.businessDate,
					store: storeNameOf(context.stores, row.storeId),
					shift: shiftLabel(t, row.shiftNumber),
					closed: moment(context.formatters, row.closedAt, context.timeZone),
					counted: row.countedAmount,
					drawer: row.drawerAmount,
					expected: row.expectedCashAmount,
					variance: row.varianceAmount,
					status: t(CASH_STATE_KEYS[row.state]),
					reasons: cashReasons(t, row),
					counter: actorName(t, context.actors, row.countedBy),
					countedAt: moment(
						context.formatters,
						row.countedAt,
						context.timeZone,
					),
					recounts: row.cashCountId === null ? null : row.recounts,
				},
			}),
		),
	};
}

export function logText(t: Translate, entry: LogEntry): string {
	return entry.kind === "handover"
		? t("operations.log.handoverText", {
				from: entry.fromShift ?? "",
				to: entry.toShift ?? "",
				note: entry.text,
			})
		: entry.text;
}

export function logTable(
	entries: readonly LogEntry[],
	categories: readonly IncidentCategory[] | undefined,
	context: TableContext,
): TableSpec {
	const { t, formatters, timeZone } = context;
	const columns = withStore(context, [
		column(t, "time", "operations.column.time", "text"),
		column(t, "kind", "operations.column.kind", "text"),
		column(t, "category", "operations.column.category", "text"),
		column(t, "text", "operations.column.text", "text"),
		column(t, "item", "operations.column.item", "text"),
		column(t, "photos", "operations.column.photos", "count"),
		column(t, "reporter", "operations.column.reporter", "text"),
		column(t, "status", "operations.column.status", "text"),
		column(t, "seenBy", "operations.column.seenBy", "text"),
		column(t, "seenAt", "operations.column.seenAt", "text"),
		column(t, "resolvedBy", "operations.column.resolvedBy", "text"),
		column(t, "resolvedAt", "operations.column.resolvedAt", "text"),
	]);
	return {
		caption: t("operations.log.table"),
		columns,
		rows: entries.map(
			(entry): TableRow => ({
				id: entry.key,
				cells: {
					time: moment(formatters, entry.at, timeZone),
					store: storeNameOf(context.stores, entry.storeId),
					kind: t(LOG_KIND_KEYS[entry.kind]),
					category: categoryLabel(categories, entry.categoryKey),
					text: logText(t, entry),
					item: entry.itemLabel,
					photos: entry.kind === "handover" ? null : entry.photoPaths.length,
					reporter: actorName(t, context.actors, entry.reportedBy),
					status: t(STATUS_KEYS[entry.status]),
					seenBy: actorName(t, context.actors, entry.seenBy),
					seenAt: moment(formatters, entry.seenAt, timeZone),
					resolvedBy: actorName(t, context.actors, entry.resolvedBy),
					resolvedAt: moment(formatters, entry.resolvedAt, timeZone),
				},
			}),
		),
	};
}
