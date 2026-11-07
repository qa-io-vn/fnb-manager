import { describe, expect, it } from "vitest";
import { createIposClient, LOGIN_PATH, vietnamRange } from "../../src/index.js";
import {
	BRAND_UID,
	COMPANY_UID,
	envelope,
	makeDaysPayload,
	makeLoginPayload,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const DAYS_PATH = "/api/v3/reports/sale-summary/days";
const ITEMS_PATH = "/api/v3/reports/sale-summary/items";
const TREND_PATH = "/api/v3/reports/sale-trend/day-of-week";
const range = vietnamRange("2026-01-01", "2026-01-07");

function setup() {
	const fake = createFakeFetch(
		routeByPath({
			[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
			[DAYS_PATH]: () =>
				jsonResponse(envelope(makeDaysPayload(7, range.startDate))),
			[ITEMS_PATH]: () =>
				jsonResponse(
					envelope({
						list_data_item_return: [
							{
								item_id: "I001",
								item_name: "Item 1 (M)",
								item_type_id: "T01",
								item_type_name: "Type A",
								quantity_sold: 10,
								revenue_gross: 500_000,
								revenue_net: 500_000,
								discount_amount: 0,
							},
						],
						other_data: [{ item_type_id: "T01", item_type_name: "Type A" }],
					}),
				),
			[TREND_PATH]: () =>
				jsonResponse(
					envelope([
						{
							start_date: range.startDate,
							end_date: range.endDate,
							store: "all",
							list_data: [],
						},
						{
							start_date: range.startDate - 7 * 86_400_000,
							end_date: range.startDate - 1,
							store: "all",
							list_data: [],
						},
					]),
				),
		}),
	);
	const client = createIposClient({
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
		appAccessToken: TEST_APP_ACCESS_TOKEN,
		fetch: fake.fetch,
	});
	return { fake, client };
}

describe("sale summary", () => {
	it("requests days with the by_days flag and brand parameters", async () => {
		const { fake, client } = setup();

		const days = await client.saleSummary.days({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			...range,
		});

		expect(days.list_data).toHaveLength(7);
		expect(days.revenue_net).toBe(7_000_000);
		const [request] = fake.requestsTo(DAYS_PATH);
		expect(request?.url.searchParams.get("by_days")).toBe("1");
		expect(request?.url.searchParams.get("list_brand_uid")).toBe(BRAND_UID);
		expect(request?.url.searchParams.get("brand_uid")).toBe(BRAND_UID);
		expect(request?.url.searchParams.get("start_date")).toBe(
			String(range.startDate),
		);
		expect(request?.url.searchParams.get("end_date")).toBe(
			String(range.endDate),
		);
		expect(request?.url.searchParams.get("store_open_at")).toBe("0");
	});

	it("ranks items with limit and order_by", async () => {
		const { fake, client } = setup();

		const items = await client.saleSummary.items({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			...range,
			limit: 20,
		});

		expect(items.list_data_item_return[0]?.quantity_sold).toBe(10);
		const [request] = fake.requestsTo(ITEMS_PATH);
		expect(request?.url.searchParams.get("limit")).toBe("20");
		expect(request?.url.searchParams.get("order_by")).toBe("revenue_net");
	});

	it("sends both comparison ranges for trends", async () => {
		const { fake, client } = setup();
		const previous = vietnamRange("2025-12-25", "2025-12-31");

		const series = await client.saleTrend.dayOfWeek({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			first: range,
			second: previous,
		});

		expect(series).toHaveLength(2);
		const [request] = fake.requestsTo(TREND_PATH);
		expect(request?.url.searchParams.get("first_start_date")).toBe(
			String(range.startDate),
		);
		expect(request?.url.searchParams.get("first_end_date")).toBe(
			String(range.endDate),
		);
		expect(request?.url.searchParams.get("second_start_date")).toBe(
			String(previous.startDate),
		);
		expect(request?.url.searchParams.get("second_end_date")).toBe(
			String(previous.endDate),
		);
		expect(request?.url.searchParams.get("list_brand_uid")).toBe(BRAND_UID);
	});
});
