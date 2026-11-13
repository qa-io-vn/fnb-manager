import { z } from "zod";

export type IsoDate = string;

export interface DateRange {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_STORE_IDS = 50;

const numberLike = z.union([z.number(), z.string().min(1), z.bigint()]);

export const isoDateValue = z.string().regex(ISO_DATE_REGEX);
export const optionalIsoDateValue = isoDateValue.nullable();
export const timestampValue = z.string();
export const optionalTimestampValue = timestampValue.nullable();
export const requiredNumericValue = numberLike.pipe(
	z.coerce.number<string | number | bigint>(),
);
export const numericValue = requiredNumericValue.nullable();
export const countValue = numberLike.pipe(
	z.coerce.number<string | number | bigint>().int(),
);
export const optionalCountValue = countValue.nullable();
export const storeIdValue = z.string().nullable();
export const textValue = z.string();
export const optionalTextValue = z.string().nullable();
export const textListValue = z.array(z.string()).nullable();

export const storeIdsArgument = z.array(z.string().min(1)).max(MAX_STORE_IDS);
export const isoDateArgument = isoDateValue;
export const reportGrainArgument = z.enum(["day", "week", "month", "year"]);
export const seriesGrainArgument = z.enum([
	"day",
	"week",
	"month",
	"year",
	"weekday",
]);

export const itemTypeRoles = [
	"drink",
	"topping",
	"food",
	"snack",
	"other",
] as const;
export const paymentKinds = [
	"cash",
	"card",
	"bank_transfer",
	"ewallet",
	"voucher",
	"other",
] as const;
export const holidayKinds = ["public", "tet", "custom"] as const;
export const promotionKinds = ["item", "bill", "voucher"] as const;
export const comparePeriods = [
	"current",
	"previous",
	"last_year",
	"baseline",
] as const;
export const metricPeriods = ["current", "previous", "last_year"] as const;
export const forecastIds = [
	"forecast_seasonal_naive",
	"forecast_weekday_profile",
] as const;

export type ReportGrain = z.infer<typeof reportGrainArgument>;
export type SeriesGrain = z.infer<typeof seriesGrainArgument>;
export type ItemTypeRole = (typeof itemTypeRoles)[number];
export type PaymentKindValue = (typeof paymentKinds)[number];
export type HolidayKind = (typeof holidayKinds)[number];
export type PromotionKind = (typeof promotionKinds)[number];
export type ComparePeriod = (typeof comparePeriods)[number];
export type MetricPeriod = (typeof metricPeriods)[number];
