import type { MetricDirection } from "../../metrics/registry";

export type ValueKind =
	| "money"
	| "count"
	| "decimal"
	| "ratio"
	| "percent"
	| "signedPercent"
	| "percentPoints"
	| "percentChange"
	| "date"
	| "weekday"
	| "month"
	| "hour"
	| "text";

export type TableValue = string | number | null;

export interface TableColumn {
	key: string;
	label: string;
	kind: ValueKind;
}

export interface TableRow {
	id: string;
	cells: Readonly<Record<string, TableValue>>;
}

export type SortDirection = "ascending" | "descending";

export interface TableSort {
	key: string;
	direction: SortDirection;
}

export interface TableSpec {
	caption: string;
	columns: readonly TableColumn[];
	rows: readonly TableRow[];
	initialSort?: TableSort;
	heatColumns?: readonly string[];
}

export type SeriesTone =
	| "primary"
	| "secondary"
	| "tertiary"
	| "muted"
	| "positive"
	| "negative";

export type ChartValueKind =
	| "money"
	| "count"
	| "decimal"
	| "ratio"
	| "percent";

export type ChartAxis = "left" | "right";

export interface ChartSeries {
	name: string;
	kind: "bar" | "line";
	tone: SeriesTone;
	values: readonly (number | null)[];
	axis?: ChartAxis;
	stack?: string;
}

export interface ChartMarkLine {
	label: string;
	value: number;
	axis: ChartAxis;
}

export interface ChartMarkArea {
	label: string;
	from: number;
	to: number;
}

export interface ChartSpec {
	label: string;
	categories: readonly string[];
	series: readonly ChartSeries[];
	valueKind: ChartValueKind;
	rightValueKind?: ChartValueKind;
	markLines?: readonly ChartMarkLine[];
	markAreas?: readonly ChartMarkArea[];
	zeroBased?: boolean;
}

export interface ChipSpec {
	id: string;
	label: string;
	change: number | null;
	direction: MetricDirection;
	unit?: "relative" | "points";
}

export type VerificationMarker = "verified" | "unverified" | "sample";
