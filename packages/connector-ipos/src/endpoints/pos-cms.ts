import { z } from "zod";
import type { QueryParams } from "../http.js";
import type { IposLogger } from "../logger.js";
import { dataEnvelope, pageEnvelope } from "../schemas/envelope.js";
import {
	type OutOfStockRow,
	outOfStockRowSchema,
	type PosCmsShift,
	type RemovedItemEvent,
	removedItemEventSchema,
	type SaleChangeLogRow,
	type SaleEditDeleteRow,
	type SaleSnapshot,
	saleChangeLogRowSchema,
	saleEditDeleteResponseSchema,
	saleSnapshotSchema,
} from "../schemas/pos-cms.js";
import {
	type EpochMsRange,
	splitRangeByCalendarMonth,
	VIETNAM_TIMEZONE,
} from "../time.js";
import {
	type ApiCall,
	type BrandScope,
	brandScopeQuery,
	collectPagedEnvelope,
	collectUntilShortPage,
	type PagedRows,
	requireUid,
} from "./shared.js";

const POS_CMS_ROOT = "/api/v3/pos-cms";
export const SALE_EDIT_DELETE_PATH = `${POS_CMS_ROOT}/report/sale-edit-delete`;
export const SALE_SNAPSHOT_PATH = `${POS_CMS_ROOT}/sale`;
export const REMOVED_ITEMS_PATH = `${POS_CMS_ROOT}/report/sale-change-log-remove-item`;
export const SALE_CHANGE_LOG_PATH = `${POS_CMS_ROOT}/sale-change-log`;
export const OUT_OF_STOCK_PATH = `${POS_CMS_ROOT}/report/out-of-stock-item`;
export const REMOVED_ITEMS_PAGE_SIZE = 20;
export const SALE_CHANGE_LOG_PAGE_SIZE = 100;
export const SALE_EDIT_DELETE_MAX_MONTHS = 3;
const MILLISECONDS_PER_SECOND = 1000;

export interface PosCmsRangeParams extends BrandScope {
	storeUid: string;
	startDate: number;
	endDate: number;
	storeOpenAt?: number;
}

export interface MonthBoundedRangeParams extends PosCmsRangeParams {
	timezone?: string;
}

export interface SaleSnapshotParams extends PosCmsRangeParams {
	tranId: string;
}

export interface OutOfStockParams extends PosCmsRangeParams {
	cityUid?: string;
}

export interface EditedOrDeletedSales {
	rows: SaleEditDeleteRow[];
	shifts: PosCmsShift[];
}

export interface MonthBoundedRows<T> extends PagedRows<T> {
	ranges: EpochMsRange[];
}

function scopedRangeQuery(params: PosCmsRangeParams): QueryParams {
	return {
		...brandScopeQuery(params),
		start_date: params.startDate,
		end_date: params.endDate,
		store_open_at: params.storeOpenAt ?? 0,
	};
}

function storeUidQuery(params: PosCmsRangeParams): QueryParams {
	return { store_uid: requireUid(params.storeUid, "storeUid") };
}

function listStoreUidQuery(params: PosCmsRangeParams): QueryParams {
	return { list_store_uid: requireUid(params.storeUid, "storeUid") };
}

function toEpochSeconds(epochMs: number): number {
	return Math.floor(epochMs / MILLISECONDS_PER_SECOND);
}

async function collectPerCalendarMonth<T>(
	params: MonthBoundedRangeParams,
	pageSize: number,
	fetchPage: (range: EpochMsRange, page: number) => Promise<T[]>,
): Promise<MonthBoundedRows<T>> {
	const ranges = splitRangeByCalendarMonth(
		{ startDate: params.startDate, endDate: params.endDate },
		params.timezone ?? VIETNAM_TIMEZONE,
	);
	const rows: T[] = [];
	let pages = 0;
	for (const range of ranges) {
		const collected = await collectUntilShortPage(pageSize, (page) =>
			fetchPage(range, page),
		);
		rows.push(...collected.rows);
		pages += collected.pages;
	}
	return { rows, pages, ranges };
}

export function createPosCmsEndpoints(call: ApiCall, logger: IposLogger) {
	async function listEditedOrDeletedSales(
		params: PosCmsRangeParams,
	): Promise<EditedOrDeletedSales> {
		const response = await call({
			path: SALE_EDIT_DELETE_PATH,
			query: { ...scopedRangeQuery(params), ...storeUidQuery(params), page: 1 },
			schema: saleEditDeleteResponseSchema,
			signal: params.signal,
		});
		logger.debug("ipos edited/deleted sales collected", {
			endpoint: SALE_EDIT_DELETE_PATH,
			rows: response.data.length,
		});
		return { rows: response.data, shifts: response.data_shift ?? [] };
	}

	async function getSaleSnapshot(
		params: SaleSnapshotParams,
	): Promise<SaleSnapshot> {
		const envelope = await call({
			path: SALE_SNAPSHOT_PATH,
			query: {
				tran_id: requireUid(params.tranId, "tranId"),
				...scopedRangeQuery(params),
				...storeUidQuery(params),
			},
			schema: dataEnvelope(saleSnapshotSchema),
			signal: params.signal,
		});
		return envelope.data;
	}

	async function listRemovedItemEvents(
		params: MonthBoundedRangeParams,
	): Promise<MonthBoundedRows<RemovedItemEvent>> {
		const schema = dataEnvelope(z.array(removedItemEventSchema));
		const collected = await collectPerCalendarMonth(
			params,
			REMOVED_ITEMS_PAGE_SIZE,
			async (range, page) => {
				const envelope = await call({
					path: REMOVED_ITEMS_PATH,
					query: {
						...scopedRangeQuery({ ...params, ...range }),
						...listStoreUidQuery(params),
						page,
					},
					schema,
					signal: params.signal,
				});
				return envelope.data;
			},
		);
		logger.debug("ipos removed item events collected", {
			endpoint: REMOVED_ITEMS_PATH,
			months: collected.ranges.length,
			pages: collected.pages,
			rows: collected.rows.length,
		});
		return collected;
	}

	async function listSaleChangeLog(
		params: MonthBoundedRangeParams,
	): Promise<MonthBoundedRows<SaleChangeLogRow>> {
		const schema = dataEnvelope(z.array(saleChangeLogRowSchema));
		const collected = await collectPerCalendarMonth(
			params,
			SALE_CHANGE_LOG_PAGE_SIZE,
			async (range, page) => {
				const envelope = await call({
					path: SALE_CHANGE_LOG_PATH,
					query: {
						...scopedRangeQuery({ ...params, ...range }),
						...storeUidQuery(params),
						page,
					},
					schema,
					signal: params.signal,
				});
				return envelope.data;
			},
		);
		logger.debug("ipos sale change log collected", {
			endpoint: SALE_CHANGE_LOG_PATH,
			months: collected.ranges.length,
			pages: collected.pages,
			rows: collected.rows.length,
		});
		return collected;
	}

	async function listOutOfStockEvents(
		params: OutOfStockParams,
	): Promise<PagedRows<OutOfStockRow>> {
		const schema = pageEnvelope(z.array(outOfStockRowSchema));
		const collected = await collectPagedEnvelope((page) =>
			call({
				path: OUT_OF_STOCK_PATH,
				query: {
					...brandScopeQuery(params),
					...storeUidQuery(params),
					start_date: toEpochSeconds(params.startDate),
					end_date: toEpochSeconds(params.endDate),
					store_open_at: params.storeOpenAt ?? 0,
					page,
					...(params.cityUid === undefined
						? {}
						: { city_uid: requireUid(params.cityUid, "cityUid") }),
				},
				schema,
				signal: params.signal,
			}),
		);
		logger.debug("ipos out-of-stock events collected", {
			endpoint: OUT_OF_STOCK_PATH,
			pages: collected.pages,
			rows: collected.rows.length,
		});
		return collected;
	}

	return {
		listEditedOrDeletedSales,
		getSaleSnapshot,
		listRemovedItemEvents,
		listSaleChangeLog,
		listOutOfStockEvents,
	};
}

export type PosCmsEndpoints = ReturnType<typeof createPosCmsEndpoints>;
