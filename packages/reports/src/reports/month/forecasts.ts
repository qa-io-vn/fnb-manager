import type { IsoDate } from "../../contract/values.js";
import type { Comparison } from "../../model/card.js";
import {
	comparison,
	likeForLikeLabel,
	noCoverageReason,
} from "../../model/comparison.js";
import type { CoverageModel } from "../../model/coverage.js";
import { reportKeys } from "../../model/keys.js";
import { sumMoney } from "../../model/money.js";
import { part, type SentencePart } from "../../model/values.js";
import { monthKeys } from "./keys.js";
import type { AccuracyRow, PaceRow } from "./support.js";

export type ForecastMethod = AccuracyRow["forecast_id"];

export const FORECAST_METHODS: readonly ForecastMethod[] = [
	"forecast_weekday_profile",
	"forecast_seasonal_naive",
];

export const forecastLabelKeys: Readonly<Record<ForecastMethod, string>> = {
	forecast_weekday_profile: reportKeys.compare.forecast.weekdayProfile,
	forecast_seasonal_naive: reportKeys.compare.forecast.seasonalNaive,
};

export const forecastRowKeys: Readonly<Record<ForecastMethod, string>> = {
	forecast_weekday_profile: monthKeys.pace.row.forecastWeekdayProfile,
	forecast_seasonal_naive: monthKeys.pace.row.forecastSeasonalNaive,
};

export const forecastTargetKeys: Readonly<Record<ForecastMethod, string>> = {
	forecast_weekday_profile: monthKeys.target.forecastWeekdayProfile,
	forecast_seasonal_naive: monthKeys.target.forecastSeasonalNaive,
};

export function forecastOf(
	row: PaceRow | null | undefined,
	method: ForecastMethod,
): number | null {
	if (row === null || row === undefined) return null;
	return method === "forecast_weekday_profile"
		? row.forecast_weekday_profile_net_amount
		: row.forecast_seasonal_naive_net_amount;
}

export function accuracyOf(
	rows: readonly AccuracyRow[],
	method: ForecastMethod,
): AccuracyRow | null {
	return rows.find((row) => row.forecast_id === method) ?? null;
}

function errorRank(
	rows: readonly AccuracyRow[],
	method: ForecastMethod,
): number {
	return accuracyOf(rows, method)?.mae ?? Number.POSITIVE_INFINITY;
}

export function forecastOrder(
	rows: readonly AccuracyRow[],
): readonly ForecastMethod[] {
	return [...FORECAST_METHODS].sort(
		(left, right) =>
			errorRank(rows, left) - errorRank(rows, right) ||
			FORECAST_METHODS.indexOf(left) - FORECAST_METHODS.indexOf(right),
	);
}

export function leadingForecast(
	rows: readonly AccuracyRow[],
	pace: PaceRow | null,
): { readonly method: ForecastMethod; readonly value: number } | null {
	for (const method of forecastOrder(rows)) {
		const value = forecastOf(pace, method);
		if (value !== null) return { method, value };
	}
	return null;
}

export function forecastLabel(method: ForecastMethod): SentencePart {
	return part(forecastLabelKeys[method]);
}

export interface CoveredReference {
	readonly coverage: CoverageModel;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly all: { current: number | null; reference: number | null };
	readonly perStore: (storeId: string) => {
		current: number | null;
		reference: number | null;
	};
}

function coveredSum(
	storeIds: readonly string[],
	value: (storeId: string) => number | null,
): number | null {
	const values = storeIds.map(value);
	if (values.some((entry) => entry === null)) return null;
	return sumMoney(values);
}

export function coveredComparison(input: {
	readonly kind: Comparison["kind"];
	readonly label: SentencePart;
	readonly reference: CoveredReference;
	readonly missingCurrent: Comparison["unavailable"];
}): Comparison {
	const { reference } = input;
	const range = { from: reference.from, to: reference.to };
	const coverage = reference.coverage.forReference(reference.from);
	if (coverage.state === "none") {
		return comparison({
			kind: input.kind,
			label: input.label,
			range,
			current: reference.all.current,
			reference: null,
			coveredStores: 0,
			totalStores: coverage.storeCount,
			unavailable: noCoverageReason(
				reference.coverage,
				coverage.youngStoreIds,
				reference.from,
			),
		});
	}
	const partial = coverage.state === "partial";
	const current = partial
		? coveredSum(
				coverage.coveredStoreIds,
				(id) => reference.perStore(id).current,
			)
		: reference.all.current;
	const value = partial
		? coveredSum(
				coverage.coveredStoreIds,
				(id) => reference.perStore(id).reference,
			)
		: reference.all.reference;
	return comparison({
		kind: input.kind,
		label: partial ? likeForLikeLabel(input.label, coverage) : input.label,
		range,
		current,
		reference: value,
		basis: partial ? "like_for_like" : "all_stores",
		coveredStores: coverage.coveredStoreIds.length,
		totalStores: coverage.storeCount,
		unavailable: current === null ? input.missingCurrent : null,
	});
}
