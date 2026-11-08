import {
	assertCapability,
	assertWindow,
	type BusinessDateWindow,
	ConnectorAuthError,
	type ConnectorFactory,
	type FetchContext,
	isWithinWindow,
	type PosConnector,
	splitWindow,
	windowInstants,
} from "@fnb/connector-core";
import type {
	CanonicalAdjustment,
	CanonicalCatalog,
	CanonicalDailyTotal,
	CanonicalSale,
	CanonicalShift,
	CanonicalStore,
	DataQualityFlag,
} from "@fnb/core";
import { createIposClient, type IposClient } from "../client.js";
import type { LoginPayload } from "../schemas/login.js";
import {
	adjustmentQueryRange,
	adjustmentQueryRanges,
	buildAdjustments,
} from "./adjustments.js";
import { toCanonicalCatalog } from "./catalog.js";
import { daysViewRange, mapDayRow } from "./control-totals.js";
import { iposCredentialsSchema } from "./credentials.js";
import { IPOS_CONNECTOR_ID, iposDescriptor } from "./descriptor.js";
import { translateErrors } from "./errors.js";
import { FLAG_CODES, flag } from "./flags.js";
import {
	buildMasterIndex,
	loadMasterData,
	type MasterData,
	type MasterIndex,
} from "./master-index.js";
import {
	type IposConnectorOptions,
	type ResolvedIposOptions,
	resolveIposOptions,
} from "./options.js";
import { buildSales } from "./sales.js";
import {
	discoverIposStores,
	StoreDirectory,
	type StoreScopeEntry,
} from "./scope.js";
import { belongsToStore, hasNoStore, mapShift } from "./shifts.js";

interface Session {
	client: IposClient;
	login: LoginPayload;
}

interface LoadedMaster {
	data: MasterData;
	index: MasterIndex;
}

function epochRange(window: BusinessDateWindow, store: CanonicalStore) {
	const range = windowInstants(window, store);
	return { startDate: range.from.getTime(), endDate: range.to.getTime() };
}

export function createIposConnector(
	options: IposConnectorOptions = {},
): PosConnector {
	const resolved: ResolvedIposOptions = resolveIposOptions(options);
	const directory = new StoreDirectory();
	const masterCache = new Map<string, Promise<LoadedMaster>>();
	let session: Session | null = null;

	const requireSession = (): Session => {
		if (!session) {
			throw new ConnectorAuthError(
				IPOS_CONNECTOR_ID,
				"authenticate() was not called",
			);
		}
		return session;
	};

	const emitFlags = (
		flags: readonly DataQualityFlag[],
		context: FetchContext | undefined,
	): void => {
		for (const dataQualityFlag of flags) {
			resolved.onFlag(dataQualityFlag);
			context?.onFlag?.(dataQualityFlag);
		}
	};

	const discoverStores = async (): Promise<CanonicalStore[]> => {
		const { client, login } = requireSession();
		return translateErrors(() =>
			discoverIposStores(client, login, resolved, directory),
		);
	};

	const scopeFor = async (store: CanonicalStore): Promise<StoreScopeEntry> => {
		const known = directory.get(store.externalId);
		if (known) {
			return known;
		}
		await discoverStores();
		return directory.require(store.externalId);
	};

	const masterFor = (store: CanonicalStore): Promise<LoadedMaster> => {
		const cached = masterCache.get(store.externalId);
		if (cached) {
			return cached;
		}
		const loading = (async () => {
			const scope = await scopeFor(store);
			const data = await translateErrors(() =>
				loadMasterData(requireSession().client, scope),
			);
			return { data, index: buildMasterIndex(data) };
		})();
		loading.catch(() => masterCache.delete(store.externalId));
		masterCache.set(store.externalId, loading);
		return loading;
	};

	return {
		describe: () => iposDescriptor,

		async authenticate(credentials) {
			const parsed = iposCredentialsSchema.safeParse(credentials);
			if (!parsed.success) {
				throw new ConnectorAuthError(
					IPOS_CONNECTOR_ID,
					parsed.error.issues[0]?.message ?? "invalid credentials",
				);
			}
			const client = createIposClient({
				email: parsed.data.email,
				password: parsed.data.password,
				appAccessToken: parsed.data.appAccessToken,
				...(options.fetch ? { fetch: options.fetch } : {}),
				...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
				...(options.logger ? { logger: options.logger } : {}),
				...(options.tokenStore ? { tokenStore: options.tokenStore } : {}),
				...(options.retry ? { retry: options.retry } : {}),
			});
			const login = await translateErrors(() => client.login());
			session = { client, login };
			masterCache.clear();
		},

		discoverStores,

		async fetchCatalog(store): Promise<CanonicalCatalog> {
			const { data, index } = await masterFor(store);
			return toCanonicalCatalog(data, index, resolved);
		},

		async *fetchSales(store, window, context): AsyncIterable<CanonicalSale[]> {
			assertWindow(window);
			const scope = await scopeFor(store);
			const { index } = await masterFor(store);
			const { client } = requireSession();
			for (const chunk of splitWindow(window, resolved.batchDays)) {
				const params = {
					companyUid: scope.companyUid,
					brandUid: scope.brandUid,
					storeUid: scope.storeUid,
					...epochRange(chunk, store),
					...(resolved.resultsPerPage === undefined
						? {}
						: { resultsPerPage: resolved.resultsPerPage }),
				};
				const [invoices, lines, payments] = await translateErrors(() =>
					Promise.all([
						client.accounting.listInvoices(params),
						client.accounting.listInvoiceLines(params),
						client.accounting.listPayments(params),
					]),
				);
				const built = buildSales(
					{
						invoices: invoices.rows,
						lines: lines.rows,
						payments: payments.rows,
					},
					store,
					index,
					resolved,
				);
				emitFlags(built.flags, context);
				yield built.sales;
			}
		},

		async fetchShifts(store, window, context): Promise<CanonicalShift[]> {
			assertCapability(iposDescriptor, "shifts");
			assertWindow(window);
			const scope = await scopeFor(store);
			const { client } = requireSession();
			const result = await translateErrors(() =>
				client.reports.listShifts({
					companyUid: scope.companyUid,
					brandUid: scope.brandUid,
					storeUid: scope.storeUid,
					...epochRange(window, store),
				}),
			);
			emitFlags(
				result.rows
					.filter(hasNoStore)
					.map((row) =>
						flag(
							FLAG_CODES.shiftWithoutStore,
							`shift ${row.shift_id} carries no store id and was not attributed to store ${store.externalId}`,
							"warn",
						),
					),
				context,
			);
			return result.rows
				.filter((row) => belongsToStore(row, scope.storeUid))
				.map(mapShift);
		},

		async fetchAdjustments(
			store,
			window,
			context,
		): Promise<CanonicalAdjustment[]> {
			assertCapability(iposDescriptor, "adjustments");
			assertWindow(window);
			const scope = await scopeFor(store);
			const { client } = requireSession();
			const storeScope = {
				companyUid: scope.companyUid,
				brandUid: scope.brandUid,
				storeUid: scope.storeUid,
			};
			const [editedOrDeleted, removedItemEvents] = await translateErrors(() =>
				Promise.all([
					Promise.all(
						adjustmentQueryRanges(window, store).map((range) =>
							client.posCms.listEditedOrDeletedSales({
								...storeScope,
								...range,
							}),
						),
					),
					client.posCms.listRemovedItemEvents({
						...storeScope,
						...adjustmentQueryRange(window, store),
						timezone: store.timezone,
					}),
				]),
			);
			const built = buildAdjustments(
				{
					editedOrDeleted: editedOrDeleted.flatMap((report) => report.rows),
					removedItemEvents: removedItemEvents.rows,
				},
				store,
				window,
			);
			emitFlags(built.flags, context);
			return built.adjustments;
		},

		async fetchControlTotals(store, window): Promise<CanonicalDailyTotal[]> {
			assertCapability(iposDescriptor, "controlTotals");
			assertWindow(window);
			const scope = await scopeFor(store);
			const { client } = requireSession();
			const days = await translateErrors(() =>
				client.saleSummary.days({
					companyUid: scope.companyUid,
					brandUid: scope.brandUid,
					storeUid: scope.storeUid,
					...daysViewRange(window, store),
				}),
			);
			return days.list_data
				.map((row) => mapDayRow(row, store))
				.filter((total) => isWithinWindow(total.businessDate, window));
		},
	};
}

export const iposConnectorFactory: ConnectorFactory<IposConnectorOptions> = {
	id: IPOS_CONNECTOR_ID,
	create: (options) => createIposConnector(options ?? {}),
};
