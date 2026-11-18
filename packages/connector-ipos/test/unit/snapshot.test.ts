import { collectSales, type PosConnector } from "@fnb/connector-core";
import type { CanonicalStore } from "@fnb/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createIposConnector,
	type FetchLike,
	LOGIN_PATH,
	toStoredToken,
} from "../../src/index.js";
import {
	createMemorySnapshotStorage,
	createRecordingFetch,
	createSnapshotReplay,
	describeSnapshotRequest,
	type SnapshotStorage,
	snapshotKey,
	writeSnapshot,
} from "../../src/snapshot/index.js";
import { STORE_UID, TEST_CREDENTIALS } from "../fixtures/factories.js";
import { createFakeFetch } from "../fixtures/fake-fetch.js";
import {
	FIXTURE_DELIVERY_SOURCES,
	fixtureResponder,
	renderFixtureShop,
} from "../fixtures/ipos-fixture-renderer.js";

const WINDOW = { fromDate: "2026-01-27", toDate: "2026-02-03" };
const shop = renderFixtureShop({ seed: 21, ...WINDOW });

function connectorOver(fetch: FetchLike): PosConnector {
	return createIposConnector({
		fetch,
		deliverySources: FIXTURE_DELIVERY_SOURCES,
		resultsPerPage: 40,
		batchDays: 3,
	});
}

async function pullEverything(connector: PosConnector) {
	await connector.authenticate(TEST_CREDENTIALS);
	const stores = await connector.discoverStores();
	const store = stores[0] as CanonicalStore;
	return {
		stores,
		catalog: await connector.fetchCatalog(store),
		sales: await collectSales(connector.fetchSales(store, WINDOW)),
		shifts: await connector.fetchShifts?.(store, WINDOW),
		adjustments: await connector.fetchAdjustments?.(store, WINDOW),
		totals: await connector.fetchControlTotals?.(store, WINDOW),
	};
}

async function recordedShop(): Promise<SnapshotStorage> {
	const storage = createMemorySnapshotStorage();
	const fake = createFakeFetch(fixtureResponder(shop));
	await pullEverything(
		connectorOver(createRecordingFetch(fake.fetch, storage)),
	);
	return storage;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("iPOS snapshot keys", () => {
	it("keep the store and brand scope and leave out dates, cursors, pages and the company", () => {
		const key = snapshotKey("get", "/api/v1/accounting/report/sale", {
			company_uid: "c-1",
			brand_uid: "b-1",
			list_store_uid: "s-1",
			start_date: 1,
			end_date: 2,
			last_tran_date: 3,
			results_per_page: 5000,
			skip_limit: 1,
		});
		expect(key).toBe(
			"GET /api/v1/accounting/report/sale?brand_uid=b-1&list_store_uid=s-1",
		);
		expect(
			snapshotKey("GET", "/api/v3/reports/shifts", {
				list_store_uid: "s-1",
				page: 2,
				brand_uid: "b-1",
				list_brand_uid: "b-1",
				store_open_at: 0,
			}),
		).toBe("GET /api/v3/reports/shifts?brand_uid=b-1&list_store_uid=s-1");
		expect(
			snapshotKey("GET", "/api/mdata/v1/promotions", {
				brand_uid: "b-1",
				aggregate: true,
				company_uid: "c-1",
				skip_limit: true,
			}),
		).toBe("GET /api/mdata/v1/promotions?aggregate=true&brand_uid=b-1");
	});

	it("never put the login body into the key and keep every parameter of an unknown path", () => {
		const login = describeSnapshotRequest(
			`https://posapi.ipos.vn${LOGIN_PATH}`,
			{
				method: "POST",
				body: JSON.stringify({ email: "a@example.com", password: "secret" }),
			},
		);
		expect(login.key).toBe(`POST ${LOGIN_PATH}`);
		expect(login.route.kind).toBe("login");
		expect(
			describeSnapshotRequest(
				"https://posapi.ipos.vn/api/v3/reports/sale-summary/overview?start_date=2&company_uid=c&end_date=3",
			).key,
		).toBe(
			"GET /api/v3/reports/sale-summary/overview?company_uid=c&end_date=3&start_date=2",
		);
	});
});

describe("iPOS snapshot recording and replay", () => {
	it("replays exactly what the recorded API answered, without the network", async () => {
		const live = await pullEverything(
			connectorOver(createFakeFetch(fixtureResponder(shop)).fetch),
		);
		const storage = await recordedShop();
		const network = vi.spyOn(globalThis, "fetch");
		const replayed = await pullEverything(
			connectorOver(createSnapshotReplay(storage)),
		);
		expect(network).not.toHaveBeenCalled();
		expect(replayed.sales.length).toBeGreaterThan(100);
		expect(replayed.adjustments?.length).toBeGreaterThan(0);
		expect(replayed).toEqual(live);
	});

	it("stores the login without its token and records no request secret", async () => {
		const storage = await recordedShop();
		const login = await storage.readResponse(`POST ${LOGIN_PATH}`);
		const data =
			(login?.body as { data?: Record<string, unknown> } | undefined)?.data ??
			{};
		expect(data.token).toBeUndefined();
		expect(data.company).toBeDefined();
		const keys = (storage as ReturnType<typeof createMemorySnapshotStorage>)
			.responseKeys()
			.concat(
				(storage as ReturnType<typeof createMemorySnapshotStorage>).rowKeys(),
			);
		for (const key of keys) {
			expect(key).not.toContain(TEST_CREDENTIALS.password);
			expect(key).not.toContain(TEST_CREDENTIALS.appAccessToken);
			expect(key).not.toContain("start_date");
		}
		const manifest = await storage.readManifest();
		expect(manifest?.origin).toBe("api");
		expect(manifest?.coveredFrom).toBe(WINDOW.fromDate);
		expect(manifest?.coveredTo).toBe(WINDOW.toDate);
	});

	it("answers the login with a local token that the client accepts", async () => {
		const storage = await recordedShop();
		const replay = createSnapshotReplay(storage);
		const response = await replay(`https://posapi.ipos.vn${LOGIN_PATH}`, {
			method: "POST",
			body: "{}",
		});
		const body = (await response.json()) as { data: { token: string } };
		const token = toStoredToken(body.data.token);
		expect(token.expiresAt).toBeGreaterThan(Date.now());
	});

	it("serves an empty answer after the snapshot date and warns once", async () => {
		const storage = await recordedShop();
		const warnings: string[] = [];
		const connector = connectorOver(
			createSnapshotReplay(storage, {
				onWarning: (line) => warnings.push(line),
			}),
		);
		await connector.authenticate(TEST_CREDENTIALS);
		const [store] = await connector.discoverStores();
		const later = { fromDate: "2026-03-02", toDate: "2026-03-04" };
		expect(
			await collectSales(connector.fetchSales(store as CanonicalStore, later)),
		).toEqual([]);
		expect(
			await connector.fetchControlTotals?.(store as CanonicalStore, later),
		).toEqual([]);
		expect(warnings).toEqual([
			`iPOS snapshot has no data after ${WINDOW.toDate}`,
		]);
	});

	it("serves an empty list for an endpoint the snapshot never saw", async () => {
		const storage = createMemorySnapshotStorage();
		const warnings: string[] = [];
		const replay = createSnapshotReplay(storage, {
			onWarning: (line) => warnings.push(line),
		});
		const response = await replay(
			"https://posapi.ipos.vn/api/mdata/v1/units?brand_uid=b",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: [] });
		expect(warnings).toHaveLength(1);
	});

	it("replaces the rows of a re-recorded range instead of keeping stale ones", async () => {
		const storage = createMemorySnapshotStorage();
		let rows = [
			{ tran_id: "a", tran_date: 1_000 },
			{ tran_id: "b", tran_date: 2_000 },
		];
		const upstream: FetchLike = async () =>
			new Response(JSON.stringify({ data: rows, next_cursor: null }), {
				status: 200,
			});
		const record = createRecordingFetch(upstream, storage);
		const url =
			"https://posapi.ipos.vn/api/v1/accounting/report/sale?brand_uid=b&list_store_uid=s&start_date=0&end_date=5000";
		await record(url);
		rows = [{ tran_id: "b", tran_date: 2_000 }];
		await record(url);
		const replay = createSnapshotReplay(storage);
		const body = (await (await replay(url)).json()) as { data: unknown[] };
		expect(body.data).toEqual(rows);
	});
});

describe("iPOS snapshot written from stored rows", () => {
	it("serves the stores, sales and control totals the connector expects", async () => {
		const storage = createMemorySnapshotStorage();
		const brandUid = "00000000-0000-4000-8000-000000000b01";
		const companyUid = "00000000-0000-4000-8000-000000000c01";
		const soldAt = Date.UTC(2026, 0, 28, 3, 0);
		const invoice = {
			tran_id: "T1",
			tran_no: "1",
			tran_date: soldAt,
			store_uid: STORE_UID,
			sale_type: "OTS",
			total_amount: 50_000,
			amount_origin: 50_000,
			payment_method_id: "CASH",
			payment_method_name: "Tiền mặt",
		};
		await writeSnapshot(
			storage,
			{
				login: {
					user: { id: "u1", email: "owner@example.com" },
					company: { id: companyUid },
					brands: [{ id: brandUid, brand_name: "Brand", currency: "VND" }],
					cities: [],
					stores: [
						{
							id: STORE_UID,
							brand_uid: brandUid,
							company_uid: companyUid,
							store_name: "Store",
							open_at: 0,
						},
					],
				},
				brands: [
					{
						brandUid,
						stores: [],
						itemTypes: [],
						itemClasses: [],
						units: [],
						sources: [],
						paymentMethods: [],
						promotions: [],
						storeContents: [
							{
								storeUid: STORE_UID,
								items: [],
								customizations: [],
								packages: [],
								invoices: [invoice],
								lines: [
									{
										...invoice,
										id: "L1",
										item_id: "I1",
										item_name: "Trà (M)",
										quantity: 1,
										price: 50_000,
										amount: 50_000,
									},
								],
								payments: [{ ...invoice, amount: 50_000 }],
								shifts: [],
								days: [
									{
										date: "2026-01-28",
										tran_date: Date.UTC(2026, 0, 27, 17, 0),
										total_sales: 1,
										revenue_gross: 50_000,
										revenue_net: 50_000,
									},
								],
								editedOrDeleted: [],
								removedItemEvents: [],
							},
						],
					},
				],
				coveredFrom: "2026-01-01",
				coveredTo: "2026-01-31",
			},
			{ origin: "database" },
		);
		const network = vi.spyOn(globalThis, "fetch");
		const connector = createIposConnector({
			fetch: createSnapshotReplay(storage),
		});
		await connector.authenticate({
			email: "anyone@example.com",
			password: "anything",
			appAccessToken: "0123456789abcdef0123456789abcdef",
		});
		const [store] = await connector.discoverStores();
		expect(store?.externalId).toBe(STORE_UID);
		const window = { fromDate: "2026-01-28", toDate: "2026-01-28" };
		const sales = await collectSales(
			connector.fetchSales(store as CanonicalStore, window),
		);
		expect(sales.map((sale) => sale.externalId)).toEqual(["T1"]);
		expect(sales[0]?.lines.map((line) => line.externalId)).toEqual(["L1"]);
		expect(sales[0]?.payments.map((payment) => payment.amount)).toEqual([
			50_000,
		]);
		expect(
			await connector.fetchControlTotals?.(store as CanonicalStore, window),
		).toMatchObject([{ businessDate: "2026-01-28", invoiceCount: 1 }]);
		expect(network).not.toHaveBeenCalled();
	});
});
