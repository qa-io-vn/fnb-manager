import {
	createRestClient,
	createRestOpsClient,
	createStorageClient,
	type DataEndpoint,
	type MemberRole,
	type OpsClient,
	type RestClient,
	type StoredSession,
} from "@fnb/zalo-mini";
import {
	memberStores,
	type OpeningHours,
	type RevenueVisibility,
	revenueAccess,
	storeDays,
} from "../home/model";
import { readStore, readTenant } from "../home/source";
import { createSampleShiftSource, shiftSampleSettingsFrom } from "./sample";

export interface ShiftStore {
	readonly id: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly openingHours: OpeningHours;
	readonly today: string;
	readonly yesterday: string;
}

export interface ShiftContext {
	readonly tenantId: string | null;
	readonly role: MemberRole;
	readonly access: RevenueVisibility;
	readonly currencyCode: string;
	readonly timeZone: string;
	readonly stores: readonly ShiftStore[];
}

export interface ShiftQuery {
	readonly role: MemberRole;
	readonly tenantId: string | null;
	readonly storeIds: readonly string[] | null;
	readonly storeNames: readonly string[];
}

export interface ShiftSource {
	readonly ops: OpsClient;
	context(query: ShiftQuery, now: Date): Promise<ShiftContext>;
}

export type ShiftSourceFactory = (
	endpoint: DataEndpoint,
	session: StoredSession,
) => ShiftSource;

export function shiftStore(
	store: Omit<ShiftStore, "today" | "yesterday">,
	now: Date,
): ShiftStore {
	return { ...store, ...storeDays(now, store) };
}

export async function loadShiftContext(
	rest: RestClient,
	query: ShiftQuery,
	now: Date,
): Promise<ShiftContext> {
	const [tenants, storeRows] = await Promise.all([
		rest.select("tenants", {
			select: "id,currency_code,timezone,staff_revenue_visibility",
			...(query.tenantId === null ? {} : { id: `eq.${query.tenantId}` }),
			order: "id.asc",
			limit: "1",
		}),
		rest.select("stores", {
			select: "id,name,timezone,business_day_start_minutes,opening_hours",
			...(query.tenantId === null ? {} : { tenant_id: `eq.${query.tenantId}` }),
			active: "eq.true",
			order: "name.asc,id.asc",
		}),
	]);
	const tenant = readTenant(tenants[0]);
	const first = tenants[0] as Readonly<Record<string, unknown>> | undefined;
	const tenantId =
		query.tenantId ?? (typeof first?.id === "string" ? first.id : null);
	return {
		tenantId,
		role: query.role,
		access: revenueAccess(query.role, tenant.visibility),
		currencyCode: tenant.currencyCode,
		timeZone: tenant.timeZone,
		stores: memberStores(
			storeRows.map(readStore),
			query.storeIds,
			query.storeNames,
		).map((store) => shiftStore(store, now)),
	};
}

export function createRestShiftSource(
	endpoint: Extract<DataEndpoint, { kind: "supabase" }>,
	session: StoredSession,
): ShiftSource {
	const options = {
		url: endpoint.url,
		publishableKey: endpoint.publishableKey,
		accessToken: session.accessToken,
	};
	const rest = createRestClient(options);
	return {
		ops: createRestOpsClient(
			rest,
			createStorageClient(options),
			session.accessToken,
		),
		context: (query, now) => loadShiftContext(rest, query, now),
	};
}

const standInSources = new WeakMap<StoredSession, ShiftSource>();

export function shiftSourceFor(
	endpoint: DataEndpoint,
	session: StoredSession,
): ShiftSource {
	if (endpoint.kind === "stand-in") {
		const known = standInSources.get(session);
		if (known !== undefined) return known;
		const created = createSampleShiftSource(
			shiftSampleSettingsFrom(window.location.search),
		);
		standInSources.set(session, created);
		return created;
	}
	return createRestShiftSource(endpoint, session);
}
