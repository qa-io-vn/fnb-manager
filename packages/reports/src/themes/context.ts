import type { DateRange } from "../contract/values.js";
import type { ReportStore } from "../definition.js";
import type { ThemeCallResults } from "./definition.js";
import type { ReportRange } from "./range.js";

export type ThemeKind =
	| "revenue"
	| "hours"
	| "menu"
	| "payments"
	| "promotions"
	| "shifts"
	| "stores"
	| "quality";

export type ThemeSlug =
	| "doanh-thu"
	| "gio-ngay"
	| "thuc-don"
	| "thanh-toan"
	| "khuyen-mai"
	| "ca-ket-tien"
	| "so-sanh"
	| "chat-luong";

export const THEME_SLUGS: Readonly<Record<ThemeKind, ThemeSlug>> = {
	revenue: "doanh-thu",
	hours: "gio-ngay",
	menu: "thuc-don",
	payments: "thanh-toan",
	promotions: "khuyen-mai",
	shifts: "ca-ket-tien",
	stores: "so-sanh",
	quality: "chat-luong",
};

export const THEME_ORDER: readonly ThemeKind[] = [
	"revenue",
	"hours",
	"menu",
	"payments",
	"promotions",
	"shifts",
	"stores",
	"quality",
];

export function themeKindOfSlug(slug: string): ThemeKind | null {
	const entry = Object.entries(THEME_SLUGS).find(([, value]) => value === slug);
	return entry === undefined ? null : (entry[0] as ThemeKind);
}

export interface ThemeContext {
	readonly tenantId: string;
	readonly stores: readonly ReportStore[];
	readonly allStoresSelected: boolean;
	readonly range: ReportRange;
	readonly sample: boolean;
	readonly params: Readonly<Record<string, string>>;
	readonly catchUpPending: DateRange | null;
}

export type ThemeParamControl = "select" | "radio";

export type ThemeParamLabelValue =
	| { readonly text: string }
	| { readonly key: string };

export interface ThemeParamOption {
	readonly value: string;
	readonly labelKey: string;
	readonly labelValues?: Readonly<Record<string, ThemeParamLabelValue>>;
	readonly disabled?: boolean;
}

export interface ThemeParamSpec {
	readonly id: string;
	readonly labelKey: string;
	readonly cardId: string;
	readonly control: ThemeParamControl;
	readonly defaultValue: string;
	readonly options: readonly ThemeParamOption[];
	readonly accepts?: (value: string) => boolean;
	readonly optionsFrom?: (
		results: ThemeCallResults,
	) => readonly ThemeParamOption[] | null;
}

function paramAccepts(spec: ThemeParamSpec, value: string): boolean {
	if (spec.options.length > 0) {
		return spec.options.some(
			(option) => option.value === value && option.disabled !== true,
		);
	}
	return spec.accepts === undefined || spec.accepts(value);
}

export function parseThemeParams(
	specs: readonly ThemeParamSpec[],
	search: Readonly<Record<string, string | null | undefined>>,
): Readonly<Record<string, string>> {
	const params: Record<string, string> = {};
	for (const spec of specs) {
		const value = search[spec.id];
		params[spec.id] =
			typeof value === "string" && paramAccepts(spec, value)
				? value
				: spec.defaultValue;
	}
	return params;
}

export function themeParamOptions(
	spec: ThemeParamSpec,
	results: ThemeCallResults | null,
): readonly ThemeParamOption[] | null {
	if (spec.optionsFrom === undefined) return spec.options;
	return results === null ? null : spec.optionsFrom(results);
}

export function themeParamsOfCard(
	specs: readonly ThemeParamSpec[],
	cardId: string,
): readonly ThemeParamSpec[] {
	return specs.filter((spec) => spec.cardId === cardId);
}

export function overlaps(left: DateRange, right: DateRange): boolean {
	return left.from <= right.to && right.from <= left.to;
}

export function catchUpOverlaps(context: ThemeContext): boolean {
	return (
		context.catchUpPending !== null &&
		overlaps(context.catchUpPending, context.range)
	);
}
