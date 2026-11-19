import {
	type IsoDate,
	type NamedPreset,
	type ReportRange,
	type ResolvedRange,
	rangeSearch,
	resolveRange,
	SHIFT_THEME_RANGE_DAYS,
} from "@fnb/reports";
import { businessDateOf, type StoreClock } from "../lib/business-dates";
import { STORE_PARAM } from "../reports/report-route";
import { FROM_PARAM, RANGE_PARAM, TO_PARAM } from "../themes/theme-route";

export const OPERATIONS_PAGES = [
	"checklist",
	"ket-tien",
	"su-co",
	"thong-bao",
] as const;

export type OperationsPage = (typeof OPERATIONS_PAGES)[number];

export const OPERATIONS_MAX_DAYS = SHIFT_THEME_RANGE_DAYS;
export const OPERATIONS_DEFAULT_PRESET: NamedPreset = "7d";

export const OPERATIONS_FILTER_PARAMS = ["kind", "category", "status"] as const;

export type OperationsFilterParam = (typeof OPERATIONS_FILTER_PARAMS)[number];

export type OperationsFilters = Readonly<
	Partial<Record<OperationsFilterParam, string>>
>;

export interface ParsedOperationsSearch {
	readonly resolved: ResolvedRange;
	readonly filters: OperationsFilters;
	readonly storeIds: readonly string[] | null;
	readonly canonical: string;
	readonly normalised: boolean;
}

export function isOperationsPage(value: string): value is OperationsPage {
	return (OPERATIONS_PAGES as readonly string[]).includes(value);
}

export function operationsToday(
	stores: readonly StoreClock[],
	now: Date,
): IsoDate {
	const dates = stores.map((store) => businessDateOf(now, store)).sort();
	return (
		dates.at(-1) ??
		businessDateOf(now, { timeZone: "UTC", businessDayStartMinutes: 0 })
	);
}

export function operationsSearch(
	range: ReportRange,
	filters: OperationsFilters = {},
): string {
	const search = rangeSearch(range);
	const parts =
		search.range === undefined
			? [
					`${FROM_PARAM}=${encodeURIComponent(search.from ?? range.from)}`,
					`${TO_PARAM}=${encodeURIComponent(search.to ?? range.to)}`,
				]
			: [`${RANGE_PARAM}=${encodeURIComponent(search.range)}`];
	for (const name of OPERATIONS_FILTER_PARAMS) {
		const value = filters[name];
		if (value !== undefined && value !== "") {
			parts.push(`${name}=${encodeURIComponent(value)}`);
		}
	}
	return parts.join("&");
}

export function operationsHref(
	page: OperationsPage,
	range: ReportRange,
	filters: OperationsFilters = {},
): string {
	return `/van-hanh/${page}?${operationsSearch(range, filters)}`;
}

function parseStores(
	search: URLSearchParams,
	storeIds: readonly string[],
): readonly string[] | null {
	const raw = search.get(STORE_PARAM);
	if (raw === null) return null;
	const known = new Set(storeIds);
	const wanted = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => known.has(value));
	return wanted.length === 0 ? null : wanted;
}

export function parseOperationsSearch(
	search: URLSearchParams,
	asOf: IsoDate,
	storeIds: readonly string[],
): ParsedOperationsSearch {
	const hasRange =
		search.has(RANGE_PARAM) || search.has(FROM_PARAM) || search.has(TO_PARAM);
	const resolved = resolveRange(
		hasRange
			? {
					preset: search.get(RANGE_PARAM),
					from: search.get(FROM_PARAM),
					to: search.get(TO_PARAM),
				}
			: { preset: OPERATIONS_DEFAULT_PRESET },
		asOf,
		{
			defaultPreset: OPERATIONS_DEFAULT_PRESET,
			maxDays: OPERATIONS_MAX_DAYS,
		},
	);
	const filters: Partial<Record<OperationsFilterParam, string>> = {};
	for (const name of OPERATIONS_FILTER_PARAMS) {
		const value = search.get(name);
		if (value !== null && value !== "") filters[name] = value;
	}
	const canonical = operationsSearch(resolved.range, filters);
	return {
		resolved,
		filters,
		storeIds: parseStores(search, storeIds),
		canonical,
		normalised: new URLSearchParams(canonical).toString() !== search.toString(),
	};
}
