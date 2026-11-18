import { LOGIN_PATH } from "../auth.js";
import { DEFAULT_RESULTS_PER_PAGE } from "../endpoints/accounting.js";
import {
	REMOVED_ITEMS_PAGE_SIZE,
	REMOVED_ITEMS_PATH,
	SALE_EDIT_DELETE_PATH,
} from "../endpoints/pos-cms.js";
import { DEFAULT_SHIFTS_PER_PAGE } from "../endpoints/reports.js";

export type RangedServe =
	| "cursor"
	| "pages"
	| "short-pages"
	| "single"
	| "days";

export interface RangedRoute {
	kind: "ranged";
	serve: RangedServe;
	field: string;
	pageSize: number;
	covers: boolean;
}

export type SnapshotRoute = { kind: "login" } | { kind: "fixed" } | RangedRoute;

export type SnapshotParams = Readonly<
	Record<string, string | number | boolean | undefined>
>;

export interface SnapshotRequest {
	method: string;
	path: string;
	params: URLSearchParams;
	key: string;
	route: SnapshotRoute;
}

export const ACCOUNTING_SALES_PATH = "/api/v1/accounting/report/sale";
export const ACCOUNTING_LINES_PATH = "/api/v1/accounting/report/sale-detail";
export const ACCOUNTING_PAYMENTS_PATH =
	"/api/v1/accounting/report/payment-method";
export const SHIFTS_REPORT_PATH = "/api/v3/reports/shifts";
export const DAYS_REPORT_PATH = "/api/v3/reports/sale-summary/days";
export const MASTER_DATA_PREFIX = "/api/mdata/v1/";

const KEY_PARAMETERS: ReadonlySet<string> = new Set([
	"aggregate",
	"brand_uid",
	"by_days",
	"list_store_uid",
	"store_uid",
]);

function ranged(
	serve: RangedServe,
	field: string,
	pageSize: number,
	covers: boolean,
): RangedRoute {
	return { kind: "ranged", serve, field, pageSize, covers };
}

const RANGED_ROUTES: ReadonlyMap<string, RangedRoute> = new Map([
	[
		ACCOUNTING_SALES_PATH,
		ranged("cursor", "tran_date", DEFAULT_RESULTS_PER_PAGE, true),
	],
	[
		ACCOUNTING_LINES_PATH,
		ranged("cursor", "tran_date", DEFAULT_RESULTS_PER_PAGE, true),
	],
	[
		ACCOUNTING_PAYMENTS_PATH,
		ranged("cursor", "tran_date", DEFAULT_RESULTS_PER_PAGE, true),
	],
	[
		SHIFTS_REPORT_PATH,
		ranged("pages", "start_date", DEFAULT_SHIFTS_PER_PAGE, false),
	],
	[DAYS_REPORT_PATH, ranged("days", "tran_date", 0, true)],
	[SALE_EDIT_DELETE_PATH, ranged("single", "updated_at", 0, false)],
	[
		REMOVED_ITEMS_PATH,
		ranged("short-pages", "log_date", REMOVED_ITEMS_PAGE_SIZE, false),
	],
]);

function isKnownPath(path: string): boolean {
	return (
		path === LOGIN_PATH ||
		path.startsWith(MASTER_DATA_PREFIX) ||
		RANGED_ROUTES.has(path)
	);
}

export function snapshotRoute(path: string): SnapshotRoute {
	if (path === LOGIN_PATH) {
		return { kind: "login" };
	}
	return RANGED_ROUTES.get(path) ?? { kind: "fixed" };
}

function paramEntries(params: SnapshotParams | URLSearchParams): string[][] {
	if (params instanceof URLSearchParams) {
		return [...params.entries()];
	}
	return Object.entries(params).flatMap(([name, value]) =>
		value === undefined ? [] : [[name, String(value)]],
	);
}

export function snapshotKey(
	method: string,
	path: string,
	params: SnapshotParams | URLSearchParams = {},
): string {
	const known = isKnownPath(path);
	const kept = paramEntries(params)
		.filter(([name]) => !known || KEY_PARAMETERS.has(name ?? ""))
		.sort(([left = ""], [right = ""]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
	const query = new URLSearchParams(kept).toString();
	return `${method.toUpperCase()} ${path}${query === "" ? "" : `?${query}`}`;
}

function requestUrl(input: string | URL | Request): URL {
	if (input instanceof URL) {
		return input;
	}
	return new URL(typeof input === "string" ? input : input.url);
}

export function describeSnapshotRequest(
	input: string | URL | Request,
	init?: RequestInit,
): SnapshotRequest {
	const url = requestUrl(input);
	const method = (
		init?.method ?? (input instanceof Request ? input.method : "GET")
	).toUpperCase();
	return {
		method,
		path: url.pathname,
		params: url.searchParams,
		key: snapshotKey(method, url.pathname, url.searchParams),
		route: snapshotRoute(url.pathname),
	};
}

export function numberParam(
	params: URLSearchParams,
	name: string,
): number | null {
	const value = params.get(name);
	if (value === null || value.trim() === "") {
		return null;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
