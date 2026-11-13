import {
	addDays,
	type IsoDate,
	isFuturePeriodKey,
	parsePeriodKey,
	periodContaining,
	type ReportKind,
	type ReportPeriod,
	rangeOfPeriodKey,
} from "@fnb/reports";

export const reportSlugs: Record<
	ReportKind,
	"ngay" | "tuan" | "thang" | "nam"
> = {
	day: "ngay",
	week: "tuan",
	month: "thang",
	year: "nam",
};

export const periodParams: Record<
	ReportKind,
	"date" | "week" | "month" | "year"
> = {
	day: "date",
	week: "week",
	month: "month",
	year: "year",
};

export const STORE_PARAM = "store";
const STORE_SEPARATOR = ",";

export type ClampReason = "today" | "notStarted";

export interface ParsedReportSearch {
	readonly period: ReportPeriod;
	readonly storeIds: readonly string[] | null;
	readonly clampedFromFuture: boolean;
	readonly clampReason: ClampReason | null;
	readonly normalised: boolean;
}

export function clampReasonOf(
	kind: ReportKind,
	key: string,
	asOf: IsoDate,
): ClampReason | null {
	if (!isFuturePeriodKey(kind, key, asOf)) return null;
	const today = addDays(asOf, 1);
	const range = rangeOfPeriodKey(kind, key);
	return range !== null && range.from <= today && today <= range.to
		? "today"
		: "notStarted";
}

export function parseStoreParam(
	search: URLSearchParams,
	storeIds: readonly string[],
): {
	readonly storeIds: readonly string[] | null;
	readonly normalised: boolean;
} {
	const raw = search.get(STORE_PARAM);
	if (raw === null) return { storeIds: null, normalised: false };
	const wanted = new Set(
		raw
			.split(STORE_SEPARATOR)
			.map((id) => id.trim())
			.filter((id) => id.length > 0),
	);
	const chosen = storeIds.filter((id) => wanted.has(id));
	if (chosen.length === 0 || chosen.length === storeIds.length) {
		return { storeIds: null, normalised: true };
	}
	return {
		storeIds: chosen,
		normalised: chosen.join(STORE_SEPARATOR) !== raw,
	};
}

export function parseReportSearch(
	kind: ReportKind,
	search: URLSearchParams,
	asOf: IsoDate,
	storeIds: readonly string[],
): ParsedReportSearch {
	const stores = parseStoreParam(search, storeIds);
	const raw = search.get(periodParams[kind]);
	const fallback = () => periodContaining(kind, asOf, asOf);
	if (raw === null || raw.trim() === "") {
		return {
			period: fallback(),
			storeIds: stores.storeIds,
			clampedFromFuture: false,
			clampReason: null,
			normalised: true,
		};
	}
	const clampReason = clampReasonOf(kind, raw, asOf);
	if (clampReason !== null) {
		return {
			period: fallback(),
			storeIds: stores.storeIds,
			clampedFromFuture: true,
			clampReason,
			normalised: clampReason === "notStarted" || stores.normalised,
		};
	}
	const parsed = parsePeriodKey(kind, raw, asOf);
	return {
		period: parsed ?? fallback(),
		storeIds: stores.storeIds,
		clampedFromFuture: false,
		clampReason: null,
		normalised: parsed === null || parsed.key !== raw || stores.normalised,
	};
}

export function reportSearch(
	kind: ReportKind,
	period: Pick<ReportPeriod, "key">,
	storeIds: readonly string[] | null,
): string {
	const parts = [`${periodParams[kind]}=${encodeURIComponent(period.key)}`];
	if (storeIds !== null && storeIds.length > 0) {
		parts.push(
			`${STORE_PARAM}=${storeIds.map(encodeURIComponent).join(STORE_SEPARATOR)}`,
		);
	}
	return parts.join("&");
}

export function reportHref(
	kind: ReportKind,
	period: Pick<ReportPeriod, "key">,
	storeIds: readonly string[] | null,
): string {
	return `/bao-cao/${reportSlugs[kind]}?${reportSearch(kind, period, storeIds)}`;
}
