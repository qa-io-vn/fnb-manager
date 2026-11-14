import type { DateRange } from "../contract/values.js";
import type { SentencePart, TypedValue, ValueUnit } from "./values.js";

export type UnavailableReason =
	| "no_data"
	| "store_too_young"
	| "no_reference"
	| "not_measured"
	| "not_configured"
	| "building_baseline";

export type ComparisonKind =
	| "previous"
	| "last_year"
	| "baseline"
	| "average_4_weeks"
	| "forecast"
	| "target";

export type ComparisonBasis = "all_stores" | "like_for_like";

export interface Comparison {
	readonly kind: ComparisonKind;
	readonly label: SentencePart;
	readonly range: DateRange | null;
	readonly current: number | null;
	readonly reference: number | null;
	readonly change: number | null;
	readonly difference: number | null;
	readonly basis: ComparisonBasis;
	readonly coveredStores: number;
	readonly totalStores: number;
	readonly sampleDays: number | null;
	readonly unavailable: UnavailableReason | null;
	readonly unit?: ValueUnit;
}

export type DecompositionFactor =
	| "invoices"
	| "items_per_ticket"
	| "avg_item_price";

export interface DecompositionPart {
	readonly factor: DecompositionFactor;
	readonly from: number;
	readonly to: number;
	readonly effect: number;
}

export interface Decomposition {
	readonly metric: "net_revenue" | "avg_ticket";
	readonly against: "previous" | "last_year";
	readonly basis: ComparisonBasis;
	readonly total: number;
	readonly parts: readonly DecompositionPart[];
}

export type ColumnKind =
	| "text"
	| "message"
	| "label"
	| "shift"
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
	| "hour";

export interface TableColumnModel {
	readonly key: string;
	readonly labelKey: string;
	readonly kind: ColumnKind;
}

export type TableCell = string | number | null;

export interface TableRowModel {
	readonly id: string;
	readonly cells: Readonly<Record<string, TableCell>>;
}

export interface TableModel {
	readonly captionKey: string;
	readonly columns: readonly TableColumnModel[];
	readonly rows: readonly TableRowModel[];
	readonly initialSort: {
		readonly key: string;
		readonly direction: "ascending" | "descending";
	} | null;
	readonly variant: "standard" | "heat";
	readonly heatColumns: readonly string[];
}

export type SeriesTone =
	| "primary"
	| "secondary"
	| "tertiary"
	| "muted"
	| "positive"
	| "negative";

export interface ChartSeriesModel {
	readonly label: SentencePart;
	readonly kind: "bar" | "line";
	readonly tone: SeriesTone;
	readonly axis: "left" | "right";
	readonly stack: string | null;
	readonly values: readonly (number | null)[];
}

export interface ChartMarkLine {
	readonly label: SentencePart;
	readonly value: number;
	readonly axis: "left" | "right";
}

export interface ChartMarkArea {
	readonly label: SentencePart;
	readonly fromIndex: number;
	readonly toIndex: number;
}

export interface ChartModel {
	readonly labelKey: string;
	readonly categories: readonly TypedValue[];
	readonly series: readonly ChartSeriesModel[];
	readonly leftUnit: ValueUnit;
	readonly rightUnit: ValueUnit | null;
	readonly markLines: readonly ChartMarkLine[];
	readonly markAreas: readonly ChartMarkArea[];
	readonly zeroBased?: boolean;
}

export type NoticeAction = "today" | "settings_roles" | "settings_targets";

export interface NoticeModel {
	readonly tone: "info" | "warning";
	readonly part: SentencePart;
	readonly action: NoticeAction | null;
}

export type VerificationMarker = "verified" | "unverified" | "sample";

export interface CardMarkers {
	readonly provisional: boolean;
	readonly stale: boolean;
	readonly verification: VerificationMarker;
}

export interface CardHeadline {
	readonly value: number | null;
	readonly unit: ValueUnit;
	readonly caption: SentencePart | null;
}

export interface CardModel {
	readonly id: string;
	readonly titleKey: string;
	readonly subtitle: SentencePart | null;
	readonly metricId: string;
	readonly relatedMetricIds: readonly string[];
	readonly headline: CardHeadline;
	readonly comparisons: readonly Comparison[];
	readonly decomposition: Decomposition | null;
	readonly narrative: readonly SentencePart[];
	readonly tables: readonly TableModel[];
	readonly chart: ChartModel | null;
	readonly notice: NoticeModel | null;
	readonly markers: CardMarkers;
	readonly csvName: string;
}

export const MAX_NARRATIVE_PARTS = 3;
export const MAX_CARD_TABLES = 2;

export function csvName(
	reportSlug: string,
	cardSlug: string,
	periodKey: string,
): string {
	return `${reportSlug}-${cardSlug}-${periodKey}`
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
