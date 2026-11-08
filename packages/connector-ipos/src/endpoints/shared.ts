import type { ZodType } from "zod";
import { IposError } from "../errors.js";
import type { QueryParams } from "../http.js";

export interface ApiCallSpec<T> {
	path: string;
	query?: QueryParams;
	schema: ZodType<T>;
	signal?: AbortSignal | undefined;
}

export type ApiCall = <T>(spec: ApiCallSpec<T>) => Promise<T>;

export interface Abortable {
	signal?: AbortSignal;
}

export interface BrandScope extends Abortable {
	companyUid: string;
	brandUid: string;
}

export interface DateRangeParams extends BrandScope {
	startDate: number;
	endDate: number;
	storeOpenAt?: number;
	storeUid?: string;
}

export interface PagedRows<T> {
	rows: T[];
	pages: number;
}

export interface PageEnvelopeLike<T> {
	data: T[];
	page: number;
	total_pages: number;
}

export async function collectUntilShortPage<T>(
	pageSize: number,
	fetchPage: (page: number) => Promise<T[]>,
): Promise<PagedRows<T>> {
	const rows: T[] = [];
	let pages = 0;
	for (let page = 1; ; page += 1) {
		const batch = await fetchPage(page);
		pages += 1;
		rows.push(...batch);
		if (batch.length < pageSize) {
			break;
		}
	}
	return { rows, pages };
}

export async function collectPagedEnvelope<T>(
	fetchPage: (page: number) => Promise<PageEnvelopeLike<T>>,
): Promise<PagedRows<T>> {
	const rows: T[] = [];
	let pages = 0;
	let page = 1;
	while (true) {
		const envelope = await fetchPage(page);
		pages += 1;
		rows.push(...envelope.data);
		const isLastPage =
			envelope.page >= envelope.total_pages || envelope.data.length === 0;
		if (isLastPage) {
			break;
		}
		page = envelope.page + 1;
	}
	return { rows, pages };
}

export function requireUid(value: string, parameterName: string): string {
	if (value.trim() === "") {
		throw new IposError(`${parameterName} must be a non-empty uid`);
	}
	return value;
}

export function brandScopeQuery(scope: BrandScope): QueryParams {
	return {
		company_uid: requireUid(scope.companyUid, "companyUid"),
		brand_uid: requireUid(scope.brandUid, "brandUid"),
	};
}

export function reportRangeQuery(params: DateRangeParams): QueryParams {
	return {
		...brandScopeQuery(params),
		list_brand_uid: params.brandUid,
		start_date: params.startDate,
		end_date: params.endDate,
		store_open_at: params.storeOpenAt ?? 0,
		...(params.storeUid === undefined
			? {}
			: { list_store_uid: requireUid(params.storeUid, "storeUid") }),
	};
}
