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
	answerClaimArgs,
	type BillsClient,
	closeAuditArgs,
	decideArgs,
	readAuditAnswer,
	readBillQueue,
	readClaimAnswer,
	readConfirmRedemption,
	readCounterClaims,
	readCounterCode,
	readDecideAnswer,
	readRecentBills,
	readReverseAnswer,
	readStoreBillMode,
	readSubmitAnswer,
	readVoidRedemption,
	redemptionArgs,
	reverseArgs,
	STAFF_BILL_FUNCTIONS,
	storeArgs,
	submitArgs,
	voidArgs,
} from "./bills-contract";
import {
	createDemoBillsClient,
	DEMO_STAFF_STORE_ID,
	type DemoBillsClient,
} from "./bills-demo";
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
import {
	type DemoNetwork,
	demoNetworkFrom,
	withDemoBillsNetwork,
	withDemoNetwork,
} from "./demo-network";

export interface LoyaltySource {
	readonly client: LoyaltyClient;
	/** the staff-mode bill functions (migration bill_captures) */
	readonly bills: BillsClient;
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

export function createRestBillsClient(rest: RestClient): BillsClient {
	const fn = STAFF_BILL_FUNCTIONS;
	return {
		async submit(input) {
			return readSubmitAnswer(await rest.rpc(fn.submit, submitArgs(input)));
		},
		async recent(storeId) {
			return readRecentBills(await rest.rpc(fn.recent, storeArgs(storeId)));
		},
		async mode(storeId) {
			return readStoreBillMode(await rest.rpc(fn.recent, storeArgs(storeId)));
		},
		async reverse(billId, reason) {
			return readReverseAnswer(
				await rest.rpc(fn.reverse, reverseArgs(billId, reason)),
			);
		},
		async counterCode(storeId) {
			return readCounterCode(
				await rest.rpc(fn.counterCode, storeArgs(storeId)),
			);
		},
		async counterClaims(storeId) {
			return readCounterClaims(
				await rest.rpc(fn.counterClaims, storeArgs(storeId)),
			);
		},
		async answerClaim(reply) {
			return readClaimAnswer(
				await rest.rpc(fn.answerClaim, answerClaimArgs(reply)),
			);
		},
		async queue(storeId) {
			return readBillQueue(await rest.rpc(fn.queue, storeArgs(storeId)));
		},
		async decide(billId, decision, reason) {
			return readDecideAnswer(
				await rest.rpc(fn.decide, decideArgs(billId, decision, reason)),
			);
		},
		async closeAudit(auditId, result, note) {
			return readAuditAnswer(
				await rest.rpc(fn.closeAudit, closeAuditArgs(auditId, result, note)),
			);
		},
		async confirmRedemption(redemptionId) {
			return readConfirmRedemption(
				await rest.rpc(fn.confirmRedemption, redemptionArgs(redemptionId)),
			);
		},
		async voidRedemption(redemptionId, reason) {
			return readVoidRedemption(
				await rest.rpc(fn.voidRedemption, voidArgs(redemptionId, reason)),
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
	network: DemoNetwork = { fault: "none", delayMs: 0, answerDelayMs: 0 },
	requiredLevel?: 0 | 2,
): LoyaltySource & {
	readonly client: DemoLoyaltyClient;
	readonly bills: DemoBillsClient;
} {
	const storeMode = settings.storeMode ?? "pos_sync";
	const delayMs = network.fault === "none" ? settings.delayMs : 0;
	const client = withDemoNetwork(
		createDemoLoyaltyClient({
			settings: { ...settings, delayMs },
			role: session.member.role,
			storeModeOf: (storeId) =>
				storeMode === "staff" && storeId === DEMO_STAFF_STORE_ID
					? "staff"
					: "pos_sync",
			...(clock === undefined ? {} : { clock }),
		}),
		network,
	);
	const bills = withDemoBillsNetwork(
		createDemoBillsClient({
			storeMode,
			role: session.member.role,
			delayMs,
			redemptionOf: (id) => client.redemptionOf(id),
			...(requiredLevel === undefined ? {} : { requiredLevel }),
			...(clock === undefined ? {} : { clock }),
		}),
		network,
	);
	return {
		client,
		bills,
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
	const network = demoNetworkFrom(search);
	let created: LoyaltySource;
	if (endpoint.kind === "stand-in") {
		created = createDemoLoyaltySource(
			settings,
			session,
			undefined,
			undefined,
			false,
			network,
		);
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
				? {
						client: createRestLoyaltyClient(rest),
						bills: createRestBillsClient(rest),
						sampleBadge: false,
						context,
					}
				: createDemoLoyaltySource(
						settings,
						session,
						context,
						undefined,
						true,
						network,
					);
	}
	sources.set(session, created);
	return created;
}
