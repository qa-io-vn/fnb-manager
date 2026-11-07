import { type ZodType, z } from "zod";
import type { QueryParams } from "../http.js";
import type { IposLogger } from "../logger.js";
import {
	type DailySales,
	dailySalesSchema,
	type Invoice,
	type InvoiceLine,
	invoiceLineSchema,
	invoiceSchema,
	type Payment,
	paymentSchema,
} from "../schemas/accounting.js";
import { cursorEnvelope } from "../schemas/envelope.js";
import {
	type ApiCall,
	type BrandScope,
	brandScopeQuery,
	type PagedRows,
	requireUid,
} from "./shared.js";

const ACCOUNTING_ROOT = "/api/v1/accounting/report";
export const DEFAULT_RESULTS_PER_PAGE = 5000;

export interface AccountingRangeParams extends BrandScope {
	storeUid: string;
	startDate: number;
	endDate: number;
	resultsPerPage?: number;
}

interface CursorRow {
	tran_date: number;
}

type RowKey<T> = (row: T) => string;

export const invoiceKey: RowKey<Invoice> = (row) => row.tran_id;
export const invoiceLineKey: RowKey<InvoiceLine> = (row) => row.id;
export const paymentKey: RowKey<Payment> = (row) =>
	[row.tran_id, row.payment_method_id, row.trace_no ?? "", row.amount].join(
		"|",
	);
export const dailySalesKey: RowKey<DailySales> = (row) =>
	`${row.tran_date}|${row.payment_method_name ?? ""}`;

function countByKey<T>(rows: T[], rowKey: RowKey<T>): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key = rowKey(row);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

export function dropRowsRepeatedAtCursor<T extends CursorRow>(
	resumedPage: T[],
	previousPage: T[],
	cursor: number,
	rowKey: RowKey<T>,
): T[] {
	const repeatable = countByKey(
		previousPage.filter((row) => row.tran_date === cursor),
		rowKey,
	);
	return resumedPage.filter((row) => {
		if (row.tran_date !== cursor) {
			return true;
		}
		const key = rowKey(row);
		const remaining = repeatable.get(key) ?? 0;
		if (remaining === 0) {
			return true;
		}
		repeatable.set(key, remaining - 1);
		return false;
	});
}

export function createAccountingEndpoints(call: ApiCall, logger: IposLogger) {
	async function collectPages<T extends CursorRow>(
		report: string,
		params: AccountingRangeParams,
		rowSchema: ZodType<T>,
		rowKey: RowKey<T>,
	) {
		const path = `${ACCOUNTING_ROOT}/${report}`;
		const baseQuery = {
			...brandScopeQuery(params),
			list_store_uid: requireUid(params.storeUid, "storeUid"),
			start_date: params.startDate,
			end_date: params.endDate,
			skip_limit: 1,
			results_per_page: params.resultsPerPage ?? DEFAULT_RESULTS_PER_PAGE,
		};
		const schema = cursorEnvelope(z.array(rowSchema));
		const rows: T[] = [];
		let previousPage: T[] = [];
		let cursor: number | null = null;
		let pages = 0;

		while (true) {
			const query: QueryParams =
				cursor === null ? baseQuery : { ...baseQuery, last_tran_date: cursor };
			const envelope = await call({
				path,
				query,
				schema,
				signal: params.signal,
			});
			pages += 1;
			const page = envelope.data;
			const freshRows =
				cursor === null
					? page
					: dropRowsRepeatedAtCursor(page, previousPage, cursor, rowKey);
			rows.push(...freshRows);
			previousPage = page;
			const nextCursor: number | null = envelope.next_cursor ?? null;
			const madeProgress = nextCursor !== cursor && page.length > 0;
			if (nextCursor === null || !madeProgress) {
				break;
			}
			cursor = nextCursor;
		}

		logger.debug("ipos accounting report collected", {
			endpoint: path,
			pages,
			rows: rows.length,
		});
		return { rows, pages } satisfies PagedRows<T>;
	}

	return {
		listInvoices: (params: AccountingRangeParams) =>
			collectPages("sale", params, invoiceSchema, invoiceKey),
		listInvoiceLines: (params: AccountingRangeParams) =>
			collectPages("sale-detail", params, invoiceLineSchema, invoiceLineKey),
		listPayments: (params: AccountingRangeParams) =>
			collectPages("payment-method", params, paymentSchema, paymentKey),
		salesGroupedByDay: (params: AccountingRangeParams) =>
			collectPages(
				"sale-group-by-day",
				params,
				dailySalesSchema,
				dailySalesKey,
			),
	};
}

export type AccountingEndpoints = ReturnType<typeof createAccountingEndpoints>;
