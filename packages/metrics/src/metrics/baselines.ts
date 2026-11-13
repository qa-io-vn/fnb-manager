import type { MetricDefinition } from "../vocabulary.js";

export const baselineMetrics = [
	{
		id: "same_weekday_baseline",
		group: "baselines",
		label: {
			vi: "Mức nền cùng ngày trong tuần",
			en: "Same-weekday baseline",
		},
		unit: "VND and count",
		formula:
			"medians over the same weekday of the previous 8 weeks, holidays and Tết excluded, days without data skipped: median of `net_revenue`, median of `invoices`, and median of the daily `avg_ticket` (a true median ticket, not the ratio of the two other medians)",
		grains: ["store-day"],
		direction: "neutral",
		source:
			"`same_weekday_baseline()`, row `baseline` of `period_compare(…, 'day', …)`",
		reports: ["today", "day", "week", "month", "alerts", "promotions"],
		reportNotes: {
			promotions: "lift",
		},
		status: "available now",
	},
	{
		id: "forecast_weekday_profile",
		group: "baselines",
		label: {
			vi: "Dự báo theo đặc trưng ngày trong tuần",
			en: "Weekday-profile forecast",
		},
		unit: "VND",
		formula:
			"level × weekday index, both taken at the origin: the level is the mean daily net of the 28 days ending at the origin, the index the mean net of the target's weekday ÷ the mean daily net over the 84 days ending at the origin; excluded days left out of both; index 1 when the weekday has no clean day in the 84 days; the same value for every horizon from one origin. Default origin: the as-of day, or the day before the target when that is earlier",
		grains: ["store-day"],
		direction: "neutral",
		source:
			"`weekday_profile_forecast()`, `month_pace().forecast_weekday_profile_net_amount`",
		reports: ["month", "today"],
		reportNotes: {
			month: "pace",
		},
		status: "available now",
		statusNote:
			"null when the 28 days hold no clean day; while the window lacks some weekdays, as in a store's first four weeks, the level leans toward the weekdays present",
	},
	{
		id: "forecast_seasonal_naive",
		group: "baselines",
		label: {
			vi: "Dự báo mùa vụ đơn giản",
			en: "Seasonal-naïve forecast",
		},
		unit: "VND",
		formula:
			"net of the most recent day with sales that falls on the target's weekday, on or before the origin and at most 55 days before it (usually the last such weekday before the origin); holidays not excluded",
		grains: ["store-day"],
		direction: "neutral",
		source:
			"`seasonal_naive_forecast()`, `month_pace().forecast_seasonal_naive_net_amount`",
		reports: ["month"],
		reportNotes: {
			month: "pace",
		},
		status: "available now",
		statusNote: "null when that weekday had no sales in the 8 weeks",
	},
	{
		id: "forecast_mae",
		group: "baselines",
		label: {
			vi: "Sai số dự báo tuyệt đối trung bình",
			en: "Forecast mean absolute error",
		},
		unit: "VND",
		formula:
			"per benchmark forecast: mean of |actual net − forecast| over the days of the window, each day forecast one day ahead (origin = the day before); scored only on days with sales that are not excluded and where both forecasts exist, so the two values compare like for like; `mape` beside it is the mean of |error| ÷ actual",
		grains: ["store-period"],
		grainNote: "trailing 28 days by default",
		direction: "lower",
		source:
			"`forecast_accuracy(store_ids, as_of_date, days)` rows `forecast_weekday_profile` and `forecast_seasonal_naive` (`sample_days`, `mae`, `mape`)",
		reports: ["month"],
		reportNotes: {
			month: "the forecast with the lower MAE is shown first",
		},
		status: "available now",
		statusNote:
			"null until a day has both forecasts, which needs a week of history",
	},
] as const satisfies readonly MetricDefinition[];
