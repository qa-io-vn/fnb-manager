import {
	type CardModel,
	type ChartModel,
	type ColumnKind,
	type Comparison,
	type Decomposition,
	type NoticeAction,
	type ReportKind,
	reportKeys,
	roundHalfAwayFromZero,
	type TableCell,
	type TableModel,
	type ThemeKind,
	type ValueUnit,
} from "@fnb/reports";
import { signed } from "../components/report-card/headline";
import type {
	CardDecomposition,
	CardNotice,
	ReportCardProps,
} from "../components/report-card/report-card";
import type {
	ChartSpec,
	ChartValueKind,
	ChipSpec,
	TableSpec,
	ValueKind,
} from "../components/report-card/types";
import type { Translate } from "../i18n";
import type { Formatters } from "../lib/format";
import {
	isWebMetricId,
	type MetricDefinition,
	type MetricDirection,
	metricRegistry,
} from "../metrics/registry";
import {
	formatPart,
	formatParts,
	formatTypedValue,
	translateKey,
} from "./typed-values";

export const noticeRoutes: Readonly<Record<NoticeAction, string>> = {
	today: "/",
	settings_roles: "/cai-dat/phan-loai",
	settings_targets: "/cai-dat/du-lieu-nhap-tay",
	settings_costs: "/cai-dat/du-lieu-nhap-tay?tab=gia-von",
	settings_fees: "/cai-dat/du-lieu-nhap-tay?tab=phi",
	settings_store: "/cai-dat/cua-hang",
	settings_categories: "/cai-dat/phan-loai?tab=nhom-mon",
	settings_payment_kinds: "/cai-dat/phan-loai?tab=thanh-toan",
	settings_holidays: "/cai-dat/ngay-le",
	settings_thresholds: "/cai-dat/bao-cao",
	settings_legal: "/cai-dat/phap-ly",
};

const actionKeys: Readonly<Record<NoticeAction, string>> = {
	today: "report.action.today",
	settings_roles: "report.action.settings_roles",
	settings_targets: "report.action.settings_targets",
	settings_costs: "report.action.settings_costs",
	settings_fees: "report.action.settings_fees",
	settings_store: "report.action.settings_store",
	settings_categories: "report.action.settings_categories",
	settings_payment_kinds: "report.action.settings_payment_kinds",
	settings_holidays: "report.action.settings_holidays",
	settings_thresholds: "report.action.settings_thresholds",
	settings_legal: "report.action.settings_legal",
};

export function headlineKindOf(unit: ValueUnit): Exclude<ValueKind, "text"> {
	switch (unit) {
		case "money":
			return "money";
		case "count":
			return "count";
		case "decimal":
			return "decimal";
		case "ratio":
			return "ratio";
		case "fraction":
			return "percent";
		case "signedFraction":
			return "signedPercent";
		case "percentChange":
			return "percentChange";
	}
}

export function chartKindOf(unit: ValueUnit): ChartValueKind {
	switch (unit) {
		case "money":
			return "money";
		case "count":
			return "count";
		case "decimal":
			return "decimal";
		case "ratio":
			return "ratio";
		case "fraction":
		case "signedFraction":
		case "percentChange":
			return "percent";
	}
}

function chartScale(unit: ValueUnit | null): number {
	return unit === "percentChange" ? 0.01 : 1;
}

const SHIFT_NUMBER_KEY = reportKeys.label.shiftNumber;

export function columnKindOf(kind: ColumnKind): ValueKind {
	return kind === "message" || kind === "label" || kind === "shift"
		? "text"
		: kind;
}

export function metricFor(id: string): MetricDefinition {
	if (!isWebMetricId(id)) {
		throw new Error(`the web metric registry has no entry for ${id}`);
	}
	return metricRegistry[id];
}

export function chipOf(
	comparison: Comparison,
	headlineUnit: ValueUnit,
	direction: MetricDirection,
	t: Translate,
	formatters: Formatters,
	index: number,
): ChipSpec {
	const unit = comparison.unit ?? headlineUnit;
	const points = unit === "fraction";
	const unavailable = comparison.unavailable;
	return {
		id: `${comparison.kind}-${index}`,
		label:
			unavailable === null
				? formatPart(comparison.label, t, formatters)
				: translateKey(
						t,
						`report.unavailable.${unavailable}.${comparison.kind}`,
					),
		change:
			unavailable === null
				? points
					? comparison.difference
					: comparison.change
				: null,
		direction,
		unit: points ? "points" : "relative",
	};
}

function effectOf(
	decomposition: Decomposition,
	factor: Decomposition["parts"][number]["factor"],
): number {
	return (
		decomposition.parts.find((part) => part.factor === factor)?.effect ?? 0
	);
}

export interface ShownSplit {
	readonly total: number;
	readonly effects: Readonly<
		Record<Decomposition["parts"][number]["factor"], number>
	>;
}

function minorUnits(value: number, digits: number): number {
	return Math.round(roundHalfAwayFromZero(value, digits) * 10 ** digits);
}

export function shownSplit(split: Decomposition, digits: number): ShownSplit {
	const scale = 10 ** digits;
	const total = minorUnits(split.total, digits);
	const invoices =
		split.metric === "net_revenue"
			? minorUnits(effectOf(split, "invoices"), digits)
			: 0;
	const items = minorUnits(effectOf(split, "items_per_ticket"), digits);
	return {
		total: total / scale,
		effects: {
			invoices: invoices / scale,
			items_per_ticket: items / scale,
			avg_item_price: (total - invoices - items) / scale,
		},
	};
}

export function decompositionOf(
	model: CardModel,
	t: Translate,
	formatters: Formatters,
): CardDecomposition | undefined {
	const split = model.decomposition;
	if (split === null) return undefined;
	const against = model.comparisons.find(
		(comparison) =>
			comparison.kind === split.against && comparison.basis === split.basis,
	);
	const shown = shownSplit(split, formatters.moneyFractionDigits);
	const money = (value: number) => signed(formatters.moneyExact(value), value);
	const values = {
		total: money(shown.total),
		against:
			against === undefined ? "" : formatPart(against.label, t, formatters),
		invoices: money(shown.effects.invoices),
		items: money(shown.effects.items_per_ticket),
		price: money(shown.effects.avg_item_price),
	};
	return {
		label: t(
			split.metric === "net_revenue"
				? "report.decomposition.net"
				: "report.decomposition.ticket",
			values,
		),
		parts: [],
	};
}

export function noticeOf(
	model: CardModel,
	t: Translate,
	formatters: Formatters,
): CardNotice | undefined {
	const notice = model.notice;
	if (notice === null) return undefined;
	return {
		tone: notice.tone,
		text: formatPart(notice.part, t, formatters),
		...(notice.action === null
			? {}
			: {
					action: {
						label: translateKey(t, actionKeys[notice.action]),
						to: noticeRoutes[notice.action],
					},
				}),
	};
}

export function chartOf(
	chart: ChartModel,
	t: Translate,
	formatters: Formatters,
): ChartSpec {
	const scaleOf = (axis: "left" | "right") =>
		chartScale(axis === "right" ? chart.rightUnit : chart.leftUnit);
	return {
		label: translateKey(t, chart.labelKey),
		categories: chart.categories.map((category) =>
			formatTypedValue(category, t, formatters),
		),
		series: chart.series.map((series) => ({
			name: formatPart(series.label, t, formatters),
			kind: series.kind,
			tone: series.tone,
			axis: series.axis,
			values: series.values.map((value) =>
				value === null ? null : value * scaleOf(series.axis),
			),
			...(series.stack === null ? {} : { stack: series.stack }),
		})),
		valueKind: chartKindOf(chart.leftUnit),
		...(chart.rightUnit === null
			? {}
			: { rightValueKind: chartKindOf(chart.rightUnit) }),
		markLines: chart.markLines.map((line) => ({
			label: formatPart(line.label, t, formatters),
			value: line.value * scaleOf(line.axis),
			axis: line.axis,
		})),
		markAreas: chart.markAreas.map((area) => ({
			label: formatPart(area.label, t, formatters),
			from: area.fromIndex,
			to: area.toIndex,
		})),
		...(chart.zeroBased === false ? { zeroBased: false } : {}),
	};
}

export function tableOf(table: TableModel, t: Translate): TableSpec {
	const messageColumns = new Set(
		table.columns
			.filter((column) => column.kind === "message" || column.kind === "label")
			.map((column) => column.key),
	);
	const shiftColumns = new Set(
		table.columns
			.filter((column) => column.kind === "shift")
			.map((column) => column.key),
	);
	const cellText = (key: string, value: TableCell): TableCell => {
		if (messageColumns.has(key) && typeof value === "string") {
			return translateKey(t, value);
		}
		if (shiftColumns.has(key) && typeof value === "number") {
			return translateKey(t, SHIFT_NUMBER_KEY, { number: value });
		}
		return value;
	};
	return {
		caption: translateKey(t, table.captionKey),
		columns: table.columns.map((column) => ({
			key: column.key,
			label: translateKey(t, column.labelKey),
			kind: columnKindOf(column.kind),
		})),
		rows: table.rows.map((row) => ({
			id: row.id,
			cells: Object.fromEntries(
				Object.entries(row.cells).map(([key, value]) => [
					key,
					cellText(key, value),
				]),
			),
		})),
		...(table.initialSort === null ? {} : { initialSort: table.initialSort }),
		...(table.variant === "heat" ? { heatColumns: table.heatColumns } : {}),
		...(table.previewRows === undefined
			? {}
			: { previewRows: table.previewRows }),
	};
}

export type CardKind = ReportKind | ThemeKind;

export function cardTestId(kind: CardKind, id: string): string {
	return `card-${kind}-${id}`;
}

export function toReportCardProps(
	model: CardModel,
	kind: CardKind,
	t: Translate,
	formatters: Formatters,
): ReportCardProps {
	const metric = metricFor(model.metricId);
	const [table, secondaryTable] = model.tables;
	const notice = noticeOf(model, t, formatters);
	const decomposition = decompositionOf(model, t, formatters);
	return {
		title: translateKey(t, model.titleKey),
		...(model.subtitle === null
			? {}
			: { subtitle: formatPart(model.subtitle, t, formatters) }),
		metric,
		relatedMetrics: model.relatedMetricIds.map(metricFor),
		headline: {
			value: model.headline.value,
			kind: headlineKindOf(model.headline.unit),
			...(model.headline.caption === null
				? {}
				: { caption: formatPart(model.headline.caption, t, formatters) }),
		},
		chips: model.comparisons.map((comparison, index) =>
			chipOf(
				comparison,
				model.headline.unit,
				metric.direction,
				t,
				formatters,
				index,
			),
		),
		sentence: formatParts(model.narrative, t, formatters),
		...(notice === undefined ? {} : { notice }),
		...(decomposition === undefined ? {} : { decomposition }),
		...(model.chart === null
			? {}
			: { chart: chartOf(model.chart, t, formatters) }),
		...(table === undefined ? {} : { table: tableOf(table, t) }),
		csvFileName: `${model.csvName}.csv`,
		...(secondaryTable === undefined
			? {}
			: {
					secondaryTable: tableOf(secondaryTable, t),
					secondaryCsvFileName: `${model.csvName}-2.csv`,
				}),
		verification: model.markers.verification,
		provisional: model.markers.provisional,
		stale: model.markers.stale,
		...(model.tables.some((entry) => entry.variant === "heat")
			? { wide: true }
			: {}),
		formatters,
		testId: cardTestId(kind, model.id),
	};
}
