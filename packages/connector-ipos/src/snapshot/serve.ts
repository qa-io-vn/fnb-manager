import { sameCalendarMonth } from "../time.js";
import type { RangedRoute } from "./routes.js";
import { numberParam } from "./routes.js";
import type { SnapshotRow, StoredResponse } from "./storage.js";

export const SNAPSHOT_TRACK_ID = "ipos-snapshot";

const CROSS_MONTH_MESSAGE =
	"Truyền thiếu dữ liệu: chọn ngày bắt đầu và ngày kết thúc trong cùng 1 tháng";

export function dataEnvelope(
	data: unknown,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return { data, message: null, track_id: SNAPSHOT_TRACK_ID, ...extra };
}

export function errorEnvelope(
	code: number,
	message: string,
): Record<string, unknown> {
	return { error: { code, message }, track_id: SNAPSHOT_TRACK_ID };
}

function byField(field: string, descending = false) {
	return (left: SnapshotRow, right: SnapshotRow) => {
		const order = Number(left[field]) - Number(right[field]);
		return descending ? -order : order;
	};
}

function cursorPage(
	rows: readonly SnapshotRow[],
	route: RangedRoute,
	params: URLSearchParams,
): StoredResponse {
	const pageSize = numberParam(params, "results_per_page") ?? route.pageSize;
	const cursor = numberParam(params, "last_tran_date");
	const sorted = [...rows].sort(byField(route.field));
	const remaining =
		cursor === null
			? sorted
			: sorted.filter((row) => Number(row[route.field]) >= cursor);
	const page = remaining.slice(0, Math.max(1, pageSize));
	const last = page.at(-1);
	const nextCursor =
		page.length < remaining.length && last ? Number(last[route.field]) : null;
	return {
		status: 200,
		body: dataEnvelope(page, { next_cursor: nextCursor }),
	};
}

function pages(
	rows: readonly SnapshotRow[],
	route: RangedRoute,
	params: URLSearchParams,
): StoredResponse {
	const pageSize = Math.max(
		1,
		numberParam(params, "results_per_page") ?? route.pageSize,
	);
	const page = Math.max(1, numberParam(params, "page") ?? 1);
	const sorted = [...rows].sort(byField(route.field));
	return {
		status: 200,
		body: dataEnvelope(sorted.slice((page - 1) * pageSize, page * pageSize), {
			page,
			num_results: sorted.length,
			total_pages: Math.max(1, Math.ceil(sorted.length / pageSize)),
		}),
	};
}

function shortPages(
	rows: readonly SnapshotRow[],
	route: RangedRoute,
	params: URLSearchParams,
): StoredResponse {
	const start = numberParam(params, "start_date");
	const end = numberParam(params, "end_date");
	if (start === null || end === null) {
		return { status: 400, body: errorEnvelope(0, "Truyền thiếu dữ liệu") };
	}
	if (!sameCalendarMonth({ startDate: start, endDate: end })) {
		return { status: 400, body: errorEnvelope(0, CROSS_MONTH_MESSAGE) };
	}
	const page = Math.max(1, numberParam(params, "page") ?? 1);
	const sorted = [...rows].sort(byField(route.field, true));
	return {
		status: 200,
		body: dataEnvelope(
			sorted.slice((page - 1) * route.pageSize, page * route.pageSize),
		),
	};
}

function single(
	rows: readonly SnapshotRow[],
	route: RangedRoute,
): StoredResponse {
	return {
		status: 200,
		body: {
			data: [...rows].sort(byField(route.field)),
			data_shift: [],
			track_id: SNAPSHOT_TRACK_ID,
		},
	};
}

function sum(rows: readonly SnapshotRow[], field: string): number {
	return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function days(
	rows: readonly SnapshotRow[],
	route: RangedRoute,
): StoredResponse {
	const sorted = [...rows].sort(byField(route.field));
	return {
		status: 200,
		body: dataEnvelope({
			total_sales: sum(sorted, "total_sales"),
			revenue_gross: sum(sorted, "revenue_gross"),
			revenue_net: sum(sorted, "revenue_net"),
			discount_amount: sum(sorted, "discount_amount"),
			peo_count: sum(sorted, "peo_count"),
			list_data: sorted,
		}),
	};
}

export function serveRows(
	route: RangedRoute,
	rows: readonly SnapshotRow[],
	params: URLSearchParams,
): StoredResponse {
	switch (route.serve) {
		case "cursor":
			return cursorPage(rows, route, params);
		case "pages":
			return pages(rows, route, params);
		case "short-pages":
			return shortPages(rows, route, params);
		case "single":
			return single(rows, route);
		default:
			return days(rows, route);
	}
}

export function rowsOfBody(route: RangedRoute, body: unknown): SnapshotRow[] {
	const data = (body as { data?: unknown } | null)?.data;
	const list =
		route.serve === "days"
			? (data as { list_data?: unknown } | null)?.list_data
			: data;
	return Array.isArray(list)
		? list.filter(
				(row): row is SnapshotRow =>
					row !== null && typeof row === "object" && !Array.isArray(row),
			)
		: [];
}

export function isFirstPage(
	route: RangedRoute,
	params: URLSearchParams,
): boolean {
	switch (route.serve) {
		case "cursor":
			return numberParam(params, "last_tran_date") === null;
		case "pages":
		case "short-pages":
			return (numberParam(params, "page") ?? 1) <= 1;
		default:
			return true;
	}
}
