import {
	type IsoDate,
	type NamedPreset,
	parseThemeParams,
	type ReportRange,
	type ResolvedRange,
	rangeSearch,
	resolveRange,
	type ThemeDefinition,
	type ThemeSlug,
} from "@fnb/reports";
import { parseStoreParam, STORE_PARAM } from "../reports/report-route";

export const RANGE_PARAM = "range";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";

export interface ParsedThemeSearch {
	readonly resolved: ResolvedRange;
	readonly storeIds: readonly string[] | null;
	readonly params: Readonly<Record<string, string>>;
	readonly canonical: string;
	readonly normalised: boolean;
}

export function themeSearch(
	range: ReportRange,
	storeIds: readonly string[] | null,
	params: Readonly<Record<string, string>> = {},
): string {
	const search = rangeSearch(range);
	const parts =
		search.range === undefined
			? [
					`${FROM_PARAM}=${encodeURIComponent(search.from ?? range.from)}`,
					`${TO_PARAM}=${encodeURIComponent(search.to ?? range.to)}`,
				]
			: [`${RANGE_PARAM}=${encodeURIComponent(search.range)}`];
	if (storeIds !== null && storeIds.length > 0) {
		parts.push(`${STORE_PARAM}=${storeIds.map(encodeURIComponent).join(",")}`);
	}
	for (const [name, value] of Object.entries(params)) {
		parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
	}
	return parts.join("&");
}

export function themeHref(
	slug: ThemeSlug,
	range: ReportRange,
	storeIds: readonly string[] | null,
	params: Readonly<Record<string, string>> = {},
): string {
	return `/chu-de/${slug}?${themeSearch(range, storeIds, params)}`;
}

function nonDefaultParams(
	definition: ThemeDefinition,
	params: Readonly<Record<string, string>>,
): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const spec of definition.params) {
		const value = params[spec.id];
		if (value !== undefined && value !== spec.defaultValue)
			kept[spec.id] = value;
	}
	return kept;
}

export function parseThemeSearch(
	definition: ThemeDefinition,
	search: URLSearchParams,
	asOf: IsoDate,
	storeIds: readonly string[],
	preferredPreset: NamedPreset | null = null,
): ParsedThemeSearch {
	const stores = parseStoreParam(search, storeIds);
	const hasRange =
		search.has(RANGE_PARAM) || search.has(FROM_PARAM) || search.has(TO_PARAM);
	const resolved = resolveRange(
		hasRange
			? {
					preset: search.get(RANGE_PARAM),
					from: search.get(FROM_PARAM),
					to: search.get(TO_PARAM),
				}
			: { preset: preferredPreset },
		asOf,
		{
			defaultPreset: definition.defaultPreset,
			maxDays: definition.maxRangeDays,
		},
	);
	const params = parseThemeParams(
		definition.params,
		Object.fromEntries(search.entries()),
	);
	const canonical = themeSearch(
		resolved.range,
		stores.storeIds,
		nonDefaultParams(definition, params),
	);
	return {
		resolved,
		storeIds: stores.storeIds,
		params,
		canonical,
		normalised: new URLSearchParams(canonical).toString() !== search.toString(),
	};
}

export function canonicalParams(
	definition: ThemeDefinition,
	params: Readonly<Record<string, string>>,
): Record<string, string> {
	return nonDefaultParams(definition, params);
}
