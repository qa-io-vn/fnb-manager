import { describe, expect, it } from "vitest";
import {
	createIposClient,
	IposHttpError,
	IposSchemaError,
	LOGIN_PATH,
	OUT_OF_STOCK_PATH,
	REMOVED_ITEMS_PAGE_SIZE,
	REMOVED_ITEMS_PATH,
	SALE_CHANGE_LOG_PAGE_SIZE,
	SALE_CHANGE_LOG_PATH,
	SALE_EDIT_DELETE_PATH,
	SALE_SNAPSHOT_PATH,
	sameCalendarMonth,
	vietnamRange,
} from "../../src/index.js";
import {
	BRAND_UID,
	CITY_UID,
	COMPANY_UID,
	envelope,
	errorEnvelope,
	fakeUuid,
	makeChangeLogLine,
	makeEditDeleteRow,
	makeLoginPayload,
	makeRemovedItemEvent,
	STORE_UID,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	type RecordedRequest,
	type Responder,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const OCTOBER = vietnamRange("2026-10-08", "2026-10-31");
const CROSS_MONTH = vietnamRange("2026-10-08", "2026-11-07");
const NOVEMBER_START = vietnamRange("2026-11-01", "2026-11-01").startDate;
const scope = {
	companyUid: COMPANY_UID,
	brandUid: BRAND_UID,
	storeUid: STORE_UID,
};

function clientWithRoutes(routes: Record<string, Responder>) {
	const fake = createFakeFetch(
		routeByPath({
			[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
			...routes,
		}),
	);
	const client = createIposClient({
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
		appAccessToken: TEST_APP_ACCESS_TOKEN,
		fetch: fake.fetch,
		retry: { attempts: 1, baseDelayMs: 0 },
	});
	return { fake, client };
}

function param(request: RecordedRequest | undefined, name: string) {
	return request?.url.searchParams.get(name) ?? null;
}

function pageOf(request: RecordedRequest): number {
	return Number(param(request, "page") ?? "1");
}

function monthGuard(request: RecordedRequest) {
	const start = Number(param(request, "start_date"));
	const end = Number(param(request, "end_date"));
	return sameCalendarMonth({ startDate: start, endDate: end })
		? null
		: jsonResponse(
				{
					error: {
						code: 0,
						message: "Truyền thiếu dữ liệu",
						debug_message:
							"chọn ngày bắt đầu và ngày kết thúc trong cùng 1 tháng",
					},
					track_id: "track-err-0400",
				},
				400,
			);
}

function removalEvents(count: number, firstLogDate: number) {
	return Array.from({ length: count }, (_, index) =>
		makeRemovedItemEvent(index + 1, firstLogDate + index * 60_000, [
			makeChangeLogLine(`${fakeUuid(7200 + index)}_REMOVE`, {
				quantity: -1,
			}),
		]),
	);
}

describe("posCms.listEditedOrDeletedSales", () => {
	it("sends the C05 parameters in epoch milliseconds and returns rows and shifts", async () => {
		const rows = [
			makeEditDeleteRow(1, OCTOBER.startDate + 3_600_000),
			makeEditDeleteRow(2, OCTOBER.startDate + 7_200_000, {
				status: "EDIT",
				origin_tran_id: fakeUuid(699),
				total_amount_origin: 90_000,
				total_amount: 60_000,
			}),
		];
		const { fake, client } = clientWithRoutes({
			[SALE_EDIT_DELETE_PATH]: () =>
				jsonResponse({
					data: rows,
					data_shift: [{ shift_id: "SH001", user_name: "Cashier" }],
					track_id: "track-0005",
				}),
		});

		const result = await client.posCms.listEditedOrDeletedSales({
			...scope,
			...OCTOBER,
		});

		expect(result.rows.map((row) => row.status)).toEqual(["DELETE", "EDIT"]);
		expect(result.shifts).toHaveLength(1);
		const request = fake.requestsTo(SALE_EDIT_DELETE_PATH)[0];
		expect(param(request, "company_uid")).toBe(COMPANY_UID);
		expect(param(request, "brand_uid")).toBe(BRAND_UID);
		expect(param(request, "store_uid")).toBe(STORE_UID);
		expect(param(request, "list_store_uid")).toBeNull();
		expect(param(request, "start_date")).toBe(String(OCTOBER.startDate));
		expect(param(request, "end_date")).toBe(String(OCTOBER.endDate));
		expect(param(request, "page")).toBe("1");
		expect(param(request, "store_open_at")).toBe("0");
		expect(fake.requestsTo(SALE_EDIT_DELETE_PATH)).toHaveLength(1);
	});

	it("accepts a response without data_shift and rejects rows missing the amounts", async () => {
		const { client } = clientWithRoutes({
			[SALE_EDIT_DELETE_PATH]: () =>
				jsonResponse({ data: [makeEditDeleteRow(1, OCTOBER.startDate)] }),
		});
		const result = await client.posCms.listEditedOrDeletedSales({
			...scope,
			...OCTOBER,
		});
		expect(result.shifts).toEqual([]);

		const broken = clientWithRoutes({
			[SALE_EDIT_DELETE_PATH]: () =>
				jsonResponse({
					data: [
						makeEditDeleteRow(1, OCTOBER.startDate, {
							total_amount_origin: "60000",
						}),
					],
				}),
		});
		await expect(
			broken.client.posCms.listEditedOrDeletedSales({ ...scope, ...OCTOBER }),
		).rejects.toBeInstanceOf(IposSchemaError);
	});
});

describe("posCms.getSaleSnapshot", () => {
	it("asks for one tran_id with the store scope and returns lines and payments", async () => {
		const tranId = fakeUuid(601);
		const { fake, client } = clientWithRoutes({
			[SALE_SNAPSHOT_PATH]: () =>
				jsonResponse(
					envelope({
						tran_id: tranId,
						tran_no: "TN00001",
						tran_date: OCTOBER.startDate + 3_600_000,
						total_amount: 60_000,
						amount_origin: 60_000,
						state_action_bill: 1,
						sale_detail: [
							{
								id: fakeUuid(7300),
								id_sale_detail: fakeUuid(7300),
								item_id: "I001",
								item_name: "Item 1 (M)",
								quantity: 1,
								price: 60_000,
								amount: 60_000,
							},
						],
						sale_payment_method: [
							{
								payment_method_id: "PM01",
								payment_method_name: "Cash",
								amount: 60_000,
								is_paid: 1,
							},
						],
					}),
				),
		});

		const snapshot = await client.posCms.getSaleSnapshot({
			...scope,
			...OCTOBER,
			tranId,
		});

		expect(snapshot.sale_detail).toHaveLength(1);
		expect(snapshot.sale_payment_method?.[0]?.amount).toBe(60_000);
		const request = fake.requestsTo(SALE_SNAPSHOT_PATH)[0];
		expect(param(request, "tran_id")).toBe(tranId);
		expect(param(request, "store_uid")).toBe(STORE_UID);
		expect(param(request, "start_date")).toBe(String(OCTOBER.startDate));
	});
});

describe("posCms.listRemovedItemEvents", () => {
	it("splits a range spanning two months into two month-bounded call sequences", async () => {
		const octoberEvents = removalEvents(3, OCTOBER.startDate + 3_600_000);
		const novemberEvents = removalEvents(2, NOVEMBER_START + 3_600_000);
		const { fake, client } = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: (request) =>
				monthGuard(request) ??
				jsonResponse(
					envelope(
						Number(param(request, "start_date")) < NOVEMBER_START
							? octoberEvents
							: novemberEvents,
					),
				),
		});

		const result = await client.posCms.listRemovedItemEvents({
			...scope,
			...CROSS_MONTH,
		});

		expect(result.rows).toHaveLength(5);
		expect(result.pages).toBe(2);
		expect(result.ranges).toEqual([
			{ startDate: CROSS_MONTH.startDate, endDate: NOVEMBER_START - 1 },
			{ startDate: NOVEMBER_START, endDate: CROSS_MONTH.endDate },
		]);
		const requests = fake.requestsTo(REMOVED_ITEMS_PATH);
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(param(request, "list_store_uid")).toBe(STORE_UID);
			expect(param(request, "store_uid")).toBeNull();
			expect(param(request, "page")).toBe("1");
			expect(param(request, "store_open_at")).toBe("0");
		}
		expect(param(requests[0], "start_date")).toBe(
			String(CROSS_MONTH.startDate),
		);
		expect(param(requests[0], "end_date")).toBe(String(NOVEMBER_START - 1));
		expect(param(requests[1], "start_date")).toBe(String(NOVEMBER_START));
		expect(param(requests[1], "end_date")).toBe(String(CROSS_MONTH.endDate));
	});

	it("reads 20-row pages until a short page and concatenates them", async () => {
		const events = removalEvents(45, OCTOBER.startDate + 3_600_000);
		const { fake, client } = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: (request) => {
				const page = pageOf(request);
				return jsonResponse(
					envelope(
						events.slice(
							(page - 1) * REMOVED_ITEMS_PAGE_SIZE,
							page * REMOVED_ITEMS_PAGE_SIZE,
						),
					),
				);
			},
		});

		const result = await client.posCms.listRemovedItemEvents({
			...scope,
			...OCTOBER,
		});

		expect(result.rows).toHaveLength(45);
		expect(result.pages).toBe(3);
		expect(
			fake
				.requestsTo(REMOVED_ITEMS_PATH)
				.map((request) => param(request, "page")),
		).toEqual(["1", "2", "3"]);
	});

	it("asks for one more page when a page is exactly full", async () => {
		const events = removalEvents(20, OCTOBER.startDate + 3_600_000);
		const { fake, client } = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: (request) =>
				jsonResponse(envelope(pageOf(request) === 1 ? events : [])),
		});

		const result = await client.posCms.listRemovedItemEvents({
			...scope,
			...OCTOBER,
		});

		expect(result.rows).toHaveLength(20);
		expect(fake.requestsTo(REMOVED_ITEMS_PATH)).toHaveLength(2);
	});

	it("surfaces the server's cross-month refusal as IposHttpError 400", async () => {
		const { client } = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: () =>
				jsonResponse(
					errorEnvelope(0, "Truyền thiếu dữ liệu", "track-err-0400"),
					400,
				),
		});

		const failure = await client.posCms
			.listRemovedItemEvents({ ...scope, ...CROSS_MONTH })
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		expect((failure as IposHttpError).status).toBe(400);
		expect((failure as IposHttpError).endpoint).toBe(REMOVED_ITEMS_PATH);
	});

	it("validates removed and kept lines and rejects a line without an id", async () => {
		const event = makeRemovedItemEvent(1, OCTOBER.startDate + 3_600_000, [
			makeChangeLogLine(`${fakeUuid(7201)}_REMOVE`, {
				quantity: -2,
				amount: 100_000,
			}),
			makeChangeLogLine(fakeUuid(7202), { sort_index: 1 }),
		]);
		const { client } = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: () => jsonResponse(envelope([event])),
		});
		const result = await client.posCms.listRemovedItemEvents({
			...scope,
			...OCTOBER,
		});
		expect(result.rows[0]?.sale_detail?.map((line) => line.quantity)).toEqual([
			-2, 1,
		]);
		expect(result.rows[0]?.updated_at).toBe(
			Math.floor((OCTOBER.startDate + 3_600_000) / 1000) + 25_200,
		);

		const broken = clientWithRoutes({
			[REMOVED_ITEMS_PATH]: () =>
				jsonResponse(
					envelope([
						makeRemovedItemEvent(1, OCTOBER.startDate, [
							makeChangeLogLine(fakeUuid(7203), { id_sale_detail: null }),
						]),
					]),
				),
		});
		await expect(
			broken.client.posCms.listRemovedItemEvents({ ...scope, ...OCTOBER }),
		).rejects.toBeInstanceOf(IposSchemaError);
	});
});

describe("posCms.listSaleChangeLog", () => {
	it("splits a cross-month range per calendar month and reads 100-row pages until a short page with store_uid", async () => {
		const rows = Array.from({ length: 150 }, (_, index) => ({
			tran_id: fakeUuid(8000 + index),
			created_at: Math.floor(OCTOBER.startDate / 1000) + index,
			updated_at: Math.floor(OCTOBER.startDate / 1000) + index,
			fmt_created_at: "08/10/2026 08:00",
			device_code: "POS-1",
			start_date: OCTOBER.startDate + index * 1000,
			log_type: "SALE_CHANGE",
			table_name: "CARD 1",
			change_data: {
				tran_no: "",
				total_amount: 50_000,
				sale_detail: [makeChangeLogLine(fakeUuid(7400 + index))],
				sale_payment_method: [],
			},
			sale_current: {},
		}));
		const { fake, client } = clientWithRoutes({
			[SALE_CHANGE_LOG_PATH]: (request) => {
				const guarded = monthGuard(request);
				if (guarded) {
					return guarded;
				}
				const page = pageOf(request);
				const monthRows =
					Number(param(request, "start_date")) < NOVEMBER_START ? rows : [];
				return jsonResponse(
					envelope(
						monthRows.slice(
							(page - 1) * SALE_CHANGE_LOG_PAGE_SIZE,
							page * SALE_CHANGE_LOG_PAGE_SIZE,
						),
					),
				);
			},
		});

		const result = await client.posCms.listSaleChangeLog({
			...scope,
			...CROSS_MONTH,
		});

		expect(result.rows).toHaveLength(150);
		expect(result.pages).toBe(3);
		expect(result.ranges).toEqual([
			{ startDate: CROSS_MONTH.startDate, endDate: NOVEMBER_START - 1 },
			{ startDate: NOVEMBER_START, endDate: CROSS_MONTH.endDate },
		]);
		const requests = fake.requestsTo(SALE_CHANGE_LOG_PATH);
		expect(requests.map((request) => param(request, "page"))).toEqual([
			"1",
			"2",
			"1",
		]);
		expect(requests.map((request) => param(request, "start_date"))).toEqual([
			String(CROSS_MONTH.startDate),
			String(CROSS_MONTH.startDate),
			String(NOVEMBER_START),
		]);
		expect(param(requests[1], "end_date")).toBe(String(NOVEMBER_START - 1));
		expect(param(requests[2], "end_date")).toBe(String(CROSS_MONTH.endDate));
		for (const request of requests) {
			expect(param(request, "store_uid")).toBe(STORE_UID);
			expect(param(request, "list_store_uid")).toBeNull();
		}
	});

	it("surfaces the server's cross-month refusal as IposHttpError 400", async () => {
		const { client } = clientWithRoutes({
			[SALE_CHANGE_LOG_PATH]: () =>
				jsonResponse(
					errorEnvelope(0, "Truyền thiếu dữ liệu", "track-err-0400"),
					400,
				),
		});

		const failure = await client.posCms
			.listSaleChangeLog({ ...scope, ...CROSS_MONTH })
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		expect((failure as IposHttpError).status).toBe(400);
		expect((failure as IposHttpError).endpoint).toBe(SALE_CHANGE_LOG_PATH);
	});
});

describe("posCms.listOutOfStockEvents", () => {
	it("sends the range in epoch seconds and walks page/total_pages", async () => {
		const { fake, client } = clientWithRoutes({
			[OUT_OF_STOCK_PATH]: (request) => {
				const page = pageOf(request);
				return jsonResponse(
					envelope([{ item_id: `I00${page}`, item_name: `Item ${page}` }], {
						page,
						total_pages: 2,
						num_results: 2,
					}),
				);
			},
		});

		const result = await client.posCms.listOutOfStockEvents({
			...scope,
			...CROSS_MONTH,
			cityUid: CITY_UID,
		});

		expect(result.rows.map((row) => row.item_id)).toEqual(["I001", "I002"]);
		expect(result.pages).toBe(2);
		const request = fake.requestsTo(OUT_OF_STOCK_PATH)[0];
		expect(param(request, "start_date")).toBe(
			String(Math.floor(CROSS_MONTH.startDate / 1000)),
		);
		expect(param(request, "end_date")).toBe(
			String(Math.floor(CROSS_MONTH.endDate / 1000)),
		);
		expect(param(request, "store_uid")).toBe(STORE_UID);
		expect(param(request, "city_uid")).toBe(CITY_UID);
	});

	it("stops after one page when the server reports no results", async () => {
		const { fake, client } = clientWithRoutes({
			[OUT_OF_STOCK_PATH]: () =>
				jsonResponse(envelope([], { page: 1, total_pages: 0, num_results: 0 })),
		});

		const result = await client.posCms.listOutOfStockEvents({
			...scope,
			...OCTOBER,
		});

		expect(result).toEqual({ rows: [], pages: 1 });
		expect(fake.requestsTo(OUT_OF_STOCK_PATH)).toHaveLength(1);
	});
});
