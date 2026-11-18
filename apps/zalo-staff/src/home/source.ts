import type { MemberRole, MessageParams, RestClient } from "@fnb/zalo-mini";
import type { HomeFormatters } from "./format";
import {
	brandStores,
	calendarDateIn,
	DEFAULT_REVENUE_VISIBILITY,
	daysFrom,
	type HoursToday,
	hoursOn,
	type IsoDate,
	isRevenueVisibility,
	type OpeningHours,
	type RevenueVisibility,
	readOpeningHours,
	revenueAccess,
	storeDays,
} from "./model";

export type Freshness =
	| { readonly kind: "synced"; readonly finishedAt: Date }
	| { readonly kind: "never" }
	| { readonly kind: "unknown" };

export interface DayTotals {
	readonly net: number;
	readonly invoices: number;
}

export interface HomeStore {
	readonly id: string;
	readonly name: string;
	readonly today: IsoDate;
	readonly yesterday: IsoDate;
	readonly hours: HoursToday;
	readonly totals: DayTotals | null;
	readonly yesterdayVerified: boolean | null;
}

export interface HomeData {
	readonly access: RevenueVisibility;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly freshness: Freshness;
	readonly loadedAt: Date;
	readonly stores: readonly HomeStore[];
}

export interface HomeQuery {
	readonly role: MemberRole;
	readonly tenantId: string | null;
	readonly storeNames: readonly string[];
}

export interface HomeSource {
	load(query: HomeQuery, now: Date): Promise<HomeData>;
}

export interface FreshnessMessage {
	readonly key: string;
	readonly params?: MessageParams;
}

export function freshnessMessage(
	freshness: Freshness,
	now: Date,
	timeZone: string,
	formatters: HomeFormatters,
): FreshnessMessage {
	switch (freshness.kind) {
		case "never":
			return { key: "home.freshness.never" };
		case "unknown":
			return { key: "home.freshness.unknown" };
		case "synced": {
			const time = formatters.time(freshness.finishedAt);
			const day = calendarDateIn(freshness.finishedAt, timeZone);
			return day === calendarDateIn(now, timeZone)
				? { key: "home.freshness.updatedAt", params: { time } }
				: {
						key: "home.freshness.updatedAtOn",
						params: { time, date: formatters.date(day) },
					};
		}
	}
}

export interface StoreFacts {
	readonly id: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly openingHours: OpeningHours;
}

export interface StoreFigures {
	readonly totals: ReadonlyMap<string, DayTotals & { readonly date: IsoDate }>;
	readonly matched: ReadonlySet<string>;
}

export function checkKey(storeId: string, date: IsoDate): string {
	return `${storeId}|${date}`;
}

export function homeStores(
	stores: readonly StoreFacts[],
	access: RevenueVisibility,
	figures: StoreFigures,
	now: Date,
): HomeStore[] {
	return stores.map((store) => {
		const local = storeDays(now, store);
		const row = access === "none" ? undefined : figures.totals.get(store.id);
		const days = row === undefined ? local : daysFrom(row.date);
		return {
			id: store.id,
			name: store.name,
			today: days.today,
			yesterday: days.yesterday,
			hours: hoursOn(store.openingHours, days.today),
			totals:
				row === undefined ? null : { net: row.net, invoices: row.invoices },
			yesterdayVerified:
				access !== "all" || days.today !== local.today
					? null
					: figures.matched.has(checkKey(store.id, days.yesterday)),
		};
	});
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the home could not read ${what}`);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" && value !== "" ? value : invalid(what);
}

function amount(value: unknown, what: string): number {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	return Number.isFinite(number) ? number : invalid(what);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown, what: string): IsoDate {
	return typeof value === "string" && ISO_DATE.test(value)
		? value
		: invalid(what);
}

interface TenantFacts {
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly visibility: RevenueVisibility;
}

export function readTenant(value: unknown): TenantFacts {
	if (!isRecord(value)) return invalid("the tenant");
	const visibility = value.staff_revenue_visibility;
	return {
		currencyCode: text(value.currency_code, "the tenant"),
		timeZone: text(value.timezone, "the tenant"),
		visibility: isRevenueVisibility(visibility)
			? visibility
			: visibility === undefined || visibility === null
				? DEFAULT_REVENUE_VISIBILITY
				: invalid("the tenant"),
	};
}

export function readStore(value: unknown): StoreFacts {
	if (!isRecord(value)) return invalid("a store");
	const start = value.business_day_start_minutes;
	if (typeof start !== "number" || !Number.isInteger(start))
		return invalid("a store");
	return {
		id: text(value.id, "a store"),
		name: text(value.name, "a store"),
		timeZone: text(value.timezone, "a store"),
		businessDayStartMinutes: start,
		openingHours: readOpeningHours(value.opening_hours),
	};
}

export function readTotals(value: unknown): StoreFigures["totals"] {
	if (!Array.isArray(value)) return invalid("today's totals");
	return new Map(
		value.map((row: unknown) => {
			if (!isRecord(row)) return invalid("today's totals");
			return [
				text(row.store_id, "today's totals"),
				{
					date: isoDate(row.business_date, "today's totals"),
					net: amount(row.net_amount, "today's totals"),
					invoices: amount(row.invoices, "today's totals"),
				},
			] as const;
		}),
	);
}

export function readMatchedChecks(rows: readonly unknown[]): Set<string> {
	return new Set(
		rows.flatMap((row) => {
			if (!isRecord(row)) return invalid("the sync checks");
			return row.is_matched === true
				? [
						checkKey(
							text(row.store_id, "the sync checks"),
							isoDate(row.business_date, "the sync checks"),
						),
					]
				: [];
		}),
	);
}

export function readFreshness(rows: readonly unknown[]): Freshness {
	const latest = rows[0];
	if (latest === undefined) return { kind: "never" };
	if (!isRecord(latest) || typeof latest.finished_at !== "string")
		return { kind: "unknown" };
	const finishedAt = new Date(latest.finished_at);
	return Number.isNaN(finishedAt.getTime())
		? { kind: "unknown" }
		: { kind: "synced", finishedAt };
}

const UNKNOWN: Freshness = { kind: "unknown" };

export function createRestHomeSource(rest: RestClient): HomeSource {
	return {
		async load(query, now) {
			const tenantScope: Record<string, string> =
				query.tenantId === null ? {} : { tenant_id: `eq.${query.tenantId}` };
			const [tenants, storeRows, freshness] = await Promise.all([
				rest.select("tenants", {
					select: "id,currency_code,timezone,staff_revenue_visibility",
					...(query.tenantId === null ? {} : { id: `eq.${query.tenantId}` }),
					order: "id.asc",
					limit: "1",
				}),
				rest.select("stores", {
					select: "id,name,timezone,business_day_start_minutes,opening_hours",
					...tenantScope,
					active: "eq.true",
					order: "name.asc,id.asc",
				}),
				rest
					.select("sync_runs", {
						select: "finished_at",
						...tenantScope,
						status: "eq.succeeded",
						finished_at: "not.is.null",
						order: "finished_at.desc",
						limit: "1",
					})
					.then(readFreshness, () => UNKNOWN),
			]);
			const tenant = readTenant(tenants[0]);
			const access = revenueAccess(query.role, tenant.visibility);
			const stores = brandStores(storeRows.map(readStore), query.storeNames);
			const ids = stores.map((store) => store.id);
			const yesterdays = [
				...new Set(stores.map((store) => storeDays(now, store).yesterday)),
			];
			const [totals, matched] = await Promise.all([
				access === "none" || ids.length === 0
					? new Map()
					: rest.rpc("today_store_totals").then(readTotals),
				access !== "all" || ids.length === 0
					? new Set<string>()
					: rest
							.select("sync_checks", {
								select: "store_id,business_date,is_matched",
								store_id: `in.(${ids.join(",")})`,
								business_date: `in.(${yesterdays.join(",")})`,
								is_matched: "is.true",
							})
							.then(readMatchedChecks),
			]);
			return {
				access,
				currencyCode: tenant.currencyCode,
				timeZone: tenant.timeZone,
				freshness,
				loadedAt: now,
				stores: homeStores(stores, access, { totals, matched }, now),
			};
		},
	};
}
