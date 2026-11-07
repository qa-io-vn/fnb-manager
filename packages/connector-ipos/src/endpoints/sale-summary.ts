import { type ZodType, z } from "zod";
import type { QueryParams } from "../http.js";
import { dataEnvelope } from "../schemas/envelope.js";
import {
	daysSchema,
	hourRowSchema,
	itemClassRowSchema,
	itemsSchema,
	itemTypeRowSchema,
	overviewSchema,
	paymentMethodRowSchema,
	promotionRowSchema,
	sourceRowSchema,
	storeRowSchema,
	trendSeriesSchema,
	weekdayRowSchema,
} from "../schemas/sale-summary.js";
import type { EpochMsRange } from "../time.js";
import {
	type ApiCall,
	type BrandScope,
	type DateRangeParams,
	reportRangeQuery,
	requireUid,
} from "./shared.js";

const SALE_SUMMARY_ROOT = "/api/v3/reports/sale-summary";
const SALE_TREND_ROOT = "/api/v3/reports/sale-trend";

export interface ItemsRankingParams extends DateRangeParams {
	limit?: number;
	orderBy?: string;
}

export function createSaleSummaryEndpoints(call: ApiCall) {
	async function view<T>(
		name: string,
		params: DateRangeParams,
		schema: ZodType<T>,
		extraQuery: QueryParams = {},
	) {
		const envelope = await call({
			path: `${SALE_SUMMARY_ROOT}/${name}`,
			query: { ...reportRangeQuery(params), ...extraQuery },
			schema: dataEnvelope(schema),
			signal: params.signal,
		});
		return envelope.data;
	}

	return {
		overview: (params: DateRangeParams) =>
			view("overview", params, overviewSchema),
		days: (params: DateRangeParams) =>
			view("days", params, daysSchema, { by_days: 1 }),
		hours: (params: DateRangeParams) =>
			view("hours", params, z.array(hourRowSchema)),
		weekdays: (params: DateRangeParams) =>
			view("weekdays", params, z.array(weekdayRowSchema)),
		stores: (params: DateRangeParams) =>
			view("stores", params, z.array(storeRowSchema)),
		items: (params: ItemsRankingParams) =>
			view("items", params, itemsSchema, {
				limit: params.limit,
				order_by: params.orderBy ?? "revenue_net",
			}),
		itemTypes: (params: DateRangeParams) =>
			view("item-types", params, z.array(itemTypeRowSchema)),
		itemClasses: (params: DateRangeParams) =>
			view("item-classes", params, z.array(itemClassRowSchema)),
		sources: (params: DateRangeParams) =>
			view("sources", params, z.array(sourceRowSchema)),
		paymentMethods: (params: DateRangeParams) =>
			view("payment-methods", params, z.array(paymentMethodRowSchema)),
		promotions: (params: DateRangeParams) =>
			view("promotions", params, z.array(promotionRowSchema)),
	};
}

export type SaleSummaryEndpoints = ReturnType<
	typeof createSaleSummaryEndpoints
>;

export interface SaleTrendParams extends BrandScope {
	first: EpochMsRange;
	second: EpochMsRange;
	storeOpenAt?: number;
}

export function createSaleTrendEndpoints(call: ApiCall) {
	async function trend(name: string, params: SaleTrendParams) {
		const envelope = await call({
			path: `${SALE_TREND_ROOT}/${name}`,
			query: {
				company_uid: requireUid(params.companyUid, "companyUid"),
				list_brand_uid: requireUid(params.brandUid, "brandUid"),
				first_start_date: params.first.startDate,
				first_end_date: params.first.endDate,
				second_start_date: params.second.startDate,
				second_end_date: params.second.endDate,
				store_open_at: params.storeOpenAt ?? 0,
			},
			schema: dataEnvelope(z.array(trendSeriesSchema)),
			signal: params.signal,
		});
		return envelope.data;
	}

	return {
		dayOfWeek: (params: SaleTrendParams) => trend("day-of-week", params),
		monthOfYear: (params: SaleTrendParams) => trend("month-of-year", params),
		byHour: (params: SaleTrendParams) => trend("by-hour", params),
	};
}

export type SaleTrendEndpoints = ReturnType<typeof createSaleTrendEndpoints>;
