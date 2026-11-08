import { z } from "zod";
import type { IposLogger } from "../logger.js";
import { dataEnvelope, pageEnvelope } from "../schemas/envelope.js";
import {
	cashInOutResponseSchema,
	itemPriceRowSchema,
	type Shift,
	shiftSchema,
} from "../schemas/reports.js";
import {
	type ApiCall,
	collectPagedEnvelope,
	type DateRangeParams,
	type PagedRows,
	reportRangeQuery,
	requireUid,
} from "./shared.js";

const SHIFTS_PATH = "/api/v3/reports/shifts";
const CASH_IN_OUT_PATH = "/api/v3/pos-cms/cash-in-out";
const ITEMS_BY_PRICE_PATH = "/api/v1/reports/sale-summary/items-by-price";
export const DEFAULT_SHIFTS_PER_PAGE = 500;

export interface StoreRangeParams extends DateRangeParams {
	storeUid: string;
}

export interface ShiftListParams extends DateRangeParams {
	resultsPerPage?: number;
}

export function createReportEndpoints(call: ApiCall, logger: IposLogger) {
	async function listShifts(
		params: ShiftListParams,
	): Promise<PagedRows<Shift>> {
		const schema = pageEnvelope(z.array(shiftSchema));
		const resultsPerPage = params.resultsPerPage ?? DEFAULT_SHIFTS_PER_PAGE;
		const collected = await collectPagedEnvelope((page) =>
			call({
				path: SHIFTS_PATH,
				query: {
					...reportRangeQuery(params),
					page,
					results_per_page: resultsPerPage,
				},
				schema,
				signal: params.signal,
			}),
		);
		logger.debug("ipos shifts collected", {
			endpoint: SHIFTS_PATH,
			pages: collected.pages,
			rows: collected.rows.length,
		});
		return collected;
	}

	async function cashInOut(params: StoreRangeParams) {
		const response = await call({
			path: CASH_IN_OUT_PATH,
			query: {
				...reportRangeQuery(params),
				list_store_uid: requireUid(params.storeUid, "storeUid"),
			},
			schema: cashInOutResponseSchema,
			signal: params.signal,
		});
		return {
			movements: response.data,
			shifts: response.data_shift ?? [],
			totalCashIn: response.total_cash_in ?? 0,
			totalCashOut: response.total_cash_out ?? 0,
		};
	}

	async function itemsByPrice(params: StoreRangeParams) {
		const envelope = await call({
			path: ITEMS_BY_PRICE_PATH,
			query: {
				...reportRangeQuery(params),
				list_store_uid: requireUid(params.storeUid, "storeUid"),
			},
			schema: dataEnvelope(z.array(itemPriceRowSchema)),
			signal: params.signal,
		});
		return envelope.data;
	}

	return { listShifts, cashInOut, itemsByPrice };
}

export type ReportEndpoints = ReturnType<typeof createReportEndpoints>;
