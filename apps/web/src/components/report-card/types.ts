import type { MetricDirection } from "../../metrics/registry";

export type ValueKind =
	| "money"
	| "count"
	| "percent"
	| "signedPercent"
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
}

export type SeriesTone = "primary" | "secondary";

export interface ChartSeries {
	name: string;
	kind: "bar" | "line";
	tone: SeriesTone;
	values: readonly (number | null)[];
}

export interface ChartSpec {
	label: string;
	categories: readonly string[];
	series: readonly ChartSeries[];
	valueKind: "money" | "count";
}

export interface ChipSpec {
	id: string;
	label: string;
	change: number | null;
	direction: MetricDirection;
}

export type VerificationMarker = "verified" | "unverified" | "sample";
