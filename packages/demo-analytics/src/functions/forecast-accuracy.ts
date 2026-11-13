import { type AnalyticsRow, addDays } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { PgDecimal } from "../pg-numeric.js";
import {
	dailyNetSeries,
	PROFILE_HISTORY_DAYS,
	PROFILE_LEVEL_DAYS,
	profileEntryFor,
	profileForecast,
	seasonalNaiveOf,
	weekdayProfileOf,
} from "./forecast-series-helpers.js";
import type { HandlerArgs, HandlerContext } from "./support.js";

type Row = AnalyticsRow<"forecast_accuracy">;
type ForecastId = Row["forecast_id"];

export const DEFAULT_ACCURACY_DAYS = 28;
export const FORECAST_IDS: readonly ForecastId[] = [
	"forecast_seasonal_naive",
	"forecast_weekday_profile",
];

const MAE_DIGITS = 2;
const MAPE_DIGITS = 6;

interface ScoredDay {
	readonly actual: PgDecimal;
	readonly forecast: PgDecimal;
}

function accuracyRow(forecastId: ForecastId, days: readonly ScoredDay[]): Row {
	const errors = days.map((day) => day.actual.sub(day.forecast).abs());
	const relative = days.flatMap((day, index) => {
		const error = errors[index];
		return error === undefined || day.actual.isZero()
			? []
			: [error.div(day.actual)];
	});
	return {
		forecast_id: forecastId,
		sample_days: days.length,
		mae: PgDecimal.avg(errors)?.round(MAE_DIGITS).toNumber() ?? null,
		mape: PgDecimal.avg(relative)?.round(MAPE_DIGITS).toNumber() ?? null,
	};
}

export function forecastAccuracy(
	store: AggregateStore,
	args: HandlerArgs<"forecast_accuracy">,
	context: HandlerContext,
): Row[] {
	const days = Math.max(args.days ?? DEFAULT_ACCURACY_DAYS, 1);
	const asOf = args.as_of_date;
	const series = dailyNetSeries(
		store,
		args.store_ids,
		addDays(asOf, 1 - days - PROFILE_HISTORY_DAYS),
		asOf,
		context.holidays,
	);
	const scoredAfter = addDays(asOf, -days);
	const scored: Record<ForecastId, ScoredDay[]> = {
		forecast_seasonal_naive: [],
		forecast_weekday_profile: [],
	};
	for (const day of series) {
		if (day.date <= scoredAfter || day.excluded) continue;
		const origin = addDays(day.date, -1);
		const historyFrom = addDays(day.date, -PROFILE_HISTORY_DAYS);
		const cleanHistory = series.filter(
			(point) =>
				!point.excluded && point.date >= historyFrom && point.date <= origin,
		);
		const profile = weekdayProfileOf(
			cleanHistory,
			addDays(day.date, -PROFILE_LEVEL_DAYS),
		);
		const weekdayProfileForecast = profileForecast(
			profileEntryFor(profile, day.date),
		);
		const seasonalNaiveForecast = seasonalNaiveOf(series, day.date, origin);
		if (weekdayProfileForecast === null || seasonalNaiveForecast === null) {
			continue;
		}
		scored.forecast_weekday_profile.push({
			actual: day.net,
			forecast: weekdayProfileForecast,
		});
		scored.forecast_seasonal_naive.push({
			actual: day.net,
			forecast: seasonalNaiveForecast,
		});
	}
	return FORECAST_IDS.map((forecastId) =>
		accuracyRow(forecastId, scored[forecastId]),
	);
}
