import {
	createRestClient,
	type DataEndpoint,
	type RestClient,
	type StoredSession,
} from "@fnb/zalo-mini";
import { revenueAccess } from "../home/model";
import {
	SAMPLE_CURRENCY,
	SAMPLE_STORES,
	SAMPLE_TIME_ZONE,
} from "../home/sample";
import { SAMPLE_TENANT_ID } from "../shift/sample";
import {
	loadShiftContext,
	type ShiftContext,
	type ShiftQuery,
	shiftStore,
} from "../shift/source";
import {
	actionCall,
	answerRows,
	checkinArgs,
	type LoyaltyClient,
	lookupArgs,
	queueArgs,
	readCheckinAnswer,
	readLookupAnswer,
	readMyRequest,
	readQueueItem,
	readQueueOutcome,
	readRedemptionAnswer,
	readRequestReceipt,
	requestArgs,
	STAFF_LOYALTY_FUNCTIONS,
	verifyArgs,
} from "./contract";
import {
	createDemoLoyaltyClient,
	type DemoLoyaltyClient,
	type LoyaltyDemoSettings,
	loyaltyDemoSettingsFrom,
} from "./demo";

export interface LoyaltySource {
	readonly client: LoyaltyClient;
	readonly sampleBadge: boolean;
	context(query: ShiftQuery, now: Date): Promise<ShiftContext>;
}

export type LoyaltySourceFactory = (
	endpoint: DataEndpoint,
	session: StoredSession,
) => LoyaltySource;

export type LoyaltyMode = "demo" | "live";

export const LOCAL_LOOP_LOYALTY_VARIABLE = "VITE_STAFF_LOYALTY";

export function localLoopLoyalty(value: unknown): LoyaltyMode {
	return value === "live" ? "live" : "demo";
}

export function createRestLoyaltyClient(rest: RestClient): LoyaltyClient {
	const fn = STAFF_LOYALTY_FUNCTIONS;
	return {
		async recordCheckin(input) {
			return readCheckinAnswer(
				await rest.rpc(fn.recordCheckin, checkinArgs(input)),
			);
		},
		async verifyRedemption(storeId, code) {
			return readRedemptionAnswer(
				await rest.rpc(fn.verifyRedemption, verifyArgs(storeId, code)),
			);
		},
		async lookupMember(storeId, query) {
			return readLookupAnswer(
				await rest.rpc(fn.memberLookup, lookupArgs(storeId, query)),
			);
		},
		async request(input) {
			return readRequestReceipt(await rest.rpc(fn.request, requestArgs(input)));
		},
		async queue(storeId) {
			return answerRows(
				await rest.rpc(fn.queue, queueArgs(storeId)),
				"queue",
			).map(readQueueItem);
		},
		async act(action) {
			const call = actionCall(action);
			return readQueueOutcome(await rest.rpc(call.fn, call.args));
		},
		async myRequests() {
			return answerRows(await rest.rpc(fn.myRequests), "own requests").map(
				readMyRequest,
			);
		},
	};
}

export function sampleLoyaltyContext(
	query: ShiftQuery,
	now: Date,
): ShiftContext {
	const wanted = (store: { readonly id: string; readonly name: string }) =>
		query.storeIds === null
			? query.storeNames.includes(store.name)
			: query.storeIds.includes(store.id);
	return {
		tenantId: SAMPLE_TENANT_ID,
		role: query.role,
		access: revenueAccess(query.role, "all"),
		currencyCode: SAMPLE_CURRENCY,
		timeZone: SAMPLE_TIME_ZONE,
		stores: SAMPLE_STORES.filter(wanted).map((store) =>
			shiftStore(
				{
					id: store.id,
					name: store.name,
					timeZone: store.timeZone,
					businessDayStartMinutes: store.businessDayStartMinutes,
					openingHours: store.openingHours,
				},
				now,
			),
		),
	};
}

export function createDemoLoyaltySource(
	settings: LoyaltyDemoSettings,
	session: StoredSession,
	context: (query: ShiftQuery, now: Date) => Promise<ShiftContext> = async (
		query,
		now,
	) => sampleLoyaltyContext(query, now),
	clock?: () => Date,
	sampleBadge = false,
): LoyaltySource & { readonly client: DemoLoyaltyClient } {
	const client = createDemoLoyaltyClient({
		settings,
		role: session.member.role,
		...(clock === undefined ? {} : { clock }),
	});
	return {
		client,
		sampleBadge,
		async context(query, now) {
			const loaded = await context(query, now);
			client.nameStores(loaded.stores);
			return loaded;
		},
	};
}

export function loyaltyModeFrom(
	search: string,
	runtime: string | undefined,
	local: LoyaltyMode = localLoopLoyalty(
		import.meta.env[LOCAL_LOOP_LOYALTY_VARIABLE],
	),
): LoyaltyMode {
	if (runtime === "zalo") return "live";
	const requested = new URLSearchParams(search).get("loyalty");
	return requested === "live" || requested === "demo" ? requested : local;
}

const sources = new WeakMap<StoredSession, LoyaltySource>();

export function loyaltySourceFor(
	endpoint: DataEndpoint,
	session: StoredSession,
): LoyaltySource {
	const known = sources.get(session);
	if (known !== undefined) return known;
	const search = typeof window === "undefined" ? "" : window.location.search;
	const settings = loyaltyDemoSettingsFrom(search);
	let created: LoyaltySource;
	if (endpoint.kind === "stand-in") {
		created = createDemoLoyaltySource(settings, session);
	} else {
		const rest = createRestClient({
			url: endpoint.url,
			publishableKey: endpoint.publishableKey,
			accessToken: session.accessToken,
		});
		const context = (query: ShiftQuery, now: Date) =>
			loadShiftContext(rest, query, now);
		created =
			loyaltyModeFrom(search, import.meta.env.VITE_ZALO_RUNTIME) === "live"
				? { client: createRestLoyaltyClient(rest), sampleBadge: false, context }
				: createDemoLoyaltySource(settings, session, context, undefined, true);
	}
	sources.set(session, created);
	return created;
}
