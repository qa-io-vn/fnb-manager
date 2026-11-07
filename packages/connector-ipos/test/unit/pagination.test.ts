import { describe, expect, it } from "vitest";
import { createIposClient, LOGIN_PATH } from "../../src/index.js";
import {
	BRAND_UID,
	COMPANY_UID,
	DAY_MS,
	envelope,
	HOUR_MS,
	makeInvoice,
	makeLoginPayload,
	makePayment,
	makeShift,
	STORE_UID,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	type Responder,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const SALE_PATH = "/api/v1/accounting/report/sale";
const PAYMENT_PATH = "/api/v1/accounting/report/payment-method";
const SHIFTS_PATH = "/api/v3/reports/shifts";
const RANGE_START = Date.UTC(2026, 0, 1) - 7 * HOUR_MS;
const RANGE_END = RANGE_START + DAY_MS - 1;

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

describe("accounting cursor pagination", () => {
	const invoices = Array.from({ length: 5 }, (_, index) =>
		makeInvoice(index + 1, RANGE_START + (index + 1) * HOUR_MS),
	);

	function pageFor(cursor: string | null) {
		const startIndex =
			cursor === null
				? 0
				: invoices.findIndex((invoice) => invoice.tran_date >= Number(cursor));
		const page = invoices.slice(startIndex, startIndex + 2);
		const last = page.at(-1);
		const hasMore = last !== undefined && last !== invoices.at(-1);
		return envelope(page, { next_cursor: hasMore ? last.tran_date : null });
	}

	it("follows next_cursor via last_tran_date until null and drops the repeated boundary row", async () => {
		const { fake, client } = clientWithRoutes({
			[SALE_PATH]: (request) =>
				jsonResponse(pageFor(request.url.searchParams.get("last_tran_date"))),
		});

		const result = await client.accounting.listInvoices({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
			resultsPerPage: 2,
		});

		expect(result.rows.map((row) => row.tran_id)).toEqual(
			invoices.map((invoice) => invoice.tran_id),
		);
		expect(result.pages).toBe(4);

		const requests = fake.requestsTo(SALE_PATH);
		expect(requests).toHaveLength(4);
		expect(requests[0]?.url.searchParams.has("last_tran_date")).toBe(false);
		expect(requests[1]?.url.searchParams.get("last_tran_date")).toBe(
			String(invoices[1]?.tran_date),
		);
		for (const request of requests) {
			expect(request.url.searchParams.get("skip_limit")).toBe("1");
			expect(request.url.searchParams.get("results_per_page")).toBe("2");
			expect(request.url.searchParams.get("list_store_uid")).toBe(STORE_UID);
			expect(request.url.searchParams.get("start_date")).toBe(
				String(RANGE_START),
			);
			expect(request.url.searchParams.get("end_date")).toBe(String(RANGE_END));
		}
	});

	it("defaults results_per_page to 5000 and returns one page when next_cursor is null", async () => {
		const { fake, client } = clientWithRoutes({
			[SALE_PATH]: () =>
				jsonResponse(envelope(invoices, { next_cursor: null })),
		});

		const result = await client.accounting.listInvoices({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.pages).toBe(1);
		expect(result.rows).toHaveLength(5);
		expect(
			fake.requestsTo(SALE_PATH)[0]?.url.searchParams.get("results_per_page"),
		).toBe("5000");
	});

	it("stops when a page repeats the same cursor instead of looping forever", async () => {
		const { fake, client } = clientWithRoutes({
			[SALE_PATH]: () =>
				jsonResponse(
					envelope(invoices.slice(0, 2), {
						next_cursor: invoices[1]?.tran_date,
					}),
				),
		});

		const result = await client.accounting.listInvoices({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.pages).toBe(2);
		expect(fake.requestsTo(SALE_PATH)).toHaveLength(2);
	});

	it("keeps two identical payment rows that arrive on the same page", async () => {
		const tranDate = RANGE_START + HOUR_MS;
		const splitCash = [
			makePayment(1, tranDate, { index: 1 }),
			makePayment(1, tranDate, { index: 2 }),
		];
		const { client } = clientWithRoutes({
			[PAYMENT_PATH]: () =>
				jsonResponse(envelope(splitCash, { next_cursor: null })),
		});

		const result = await client.accounting.listPayments({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.rows).toHaveLength(2);
		expect(result.rows.map((row) => row.index)).toEqual([1, 2]);
	});

	it("drops only the boundary rows repeated from the previous page, keeping same-looking rows beyond the cursor", async () => {
		const boundaryDate = RANGE_START + 2 * HOUR_MS;
		const laterDate = RANGE_START + 3 * HOUR_MS;
		const firstPage = [
			makePayment(1, RANGE_START + HOUR_MS),
			makePayment(2, boundaryDate),
			makePayment(2, boundaryDate),
		];
		const secondPage = [
			makePayment(2, boundaryDate),
			makePayment(2, boundaryDate),
			makePayment(2, boundaryDate),
			makePayment(2, laterDate),
			makePayment(3, laterDate),
		];
		const { client } = clientWithRoutes({
			[PAYMENT_PATH]: (request) =>
				request.url.searchParams.has("last_tran_date")
					? jsonResponse(envelope(secondPage, { next_cursor: null }))
					: jsonResponse(envelope(firstPage, { next_cursor: boundaryDate })),
		});

		const result = await client.accounting.listPayments({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.pages).toBe(2);
		expect(result.rows).toHaveLength(6);
		expect(
			result.rows.filter((row) => row.tran_date === boundaryDate),
		).toHaveLength(3);
		expect(
			result.rows.filter((row) => row.tran_date === laterDate),
		).toHaveLength(2);
	});

	it("stops paginating and rejects with AbortError when the signal aborts between pages", async () => {
		const controller = new AbortController();
		const { fake, client } = clientWithRoutes({
			[SALE_PATH]: () => {
				controller.abort();
				return jsonResponse(
					envelope(invoices.slice(0, 2), {
						next_cursor: invoices[1]?.tran_date,
					}),
				);
			},
		});

		await expect(
			client.accounting.listInvoices({
				companyUid: COMPANY_UID,
				brandUid: BRAND_UID,
				storeUid: STORE_UID,
				startDate: RANGE_START,
				endDate: RANGE_END,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fake.requestsTo(SALE_PATH)).toHaveLength(1);
	});

	it("handles an empty range", async () => {
		const { client } = clientWithRoutes({
			[SALE_PATH]: () => jsonResponse(envelope([], { next_cursor: null })),
		});

		const result = await client.accounting.listInvoices({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			storeUid: STORE_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result).toEqual({ rows: [], pages: 1 });
	});

	it("refuses an empty storeUid before sending anything", async () => {
		const { fake, client } = clientWithRoutes({
			[SALE_PATH]: () => jsonResponse(envelope([], { next_cursor: null })),
		});

		await expect(
			client.accounting.listInvoices({
				companyUid: COMPANY_UID,
				brandUid: BRAND_UID,
				storeUid: "",
				startDate: RANGE_START,
				endDate: RANGE_END,
			}),
		).rejects.toThrow(/storeUid/);
		expect(fake.requests).toHaveLength(0);
	});
});

describe("shift page pagination", () => {
	it("follows page/total_pages and concatenates the rows", async () => {
		const shifts = Array.from({ length: 5 }, (_, index) =>
			makeShift(index + 1, RANGE_START + index * 8 * HOUR_MS),
		);
		const { fake, client } = clientWithRoutes({
			[SHIFTS_PATH]: (request) => {
				const page = Number(request.url.searchParams.get("page"));
				return jsonResponse(
					envelope(shifts.slice((page - 1) * 2, page * 2), {
						page,
						num_results: shifts.length,
						total_pages: 3,
					}),
				);
			},
		});

		const result = await client.reports.listShifts({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.pages).toBe(3);
		expect(result.rows.map((row) => row.shift_id)).toEqual(
			shifts.map((shift) => shift.shift_id),
		);
		const requests = fake.requestsTo(SHIFTS_PATH);
		expect(
			requests.map((request) => request.url.searchParams.get("page")),
		).toEqual(["1", "2", "3"]);
		expect(requests[0]?.url.searchParams.get("list_brand_uid")).toBe(BRAND_UID);
		expect(requests[0]?.url.searchParams.get("store_open_at")).toBe("0");
		for (const request of requests) {
			expect(request.url.searchParams.get("results_per_page")).toBe("500");
		}
	});

	it("sends a custom results_per_page", async () => {
		const { fake, client } = clientWithRoutes({
			[SHIFTS_PATH]: () =>
				jsonResponse(
					envelope([makeShift(1, RANGE_START)], {
						page: 1,
						num_results: 1,
						total_pages: 1,
					}),
				),
		});

		await client.reports.listShifts({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
			resultsPerPage: 100,
		});

		expect(
			fake.requestsTo(SHIFTS_PATH)[0]?.url.searchParams.get("results_per_page"),
		).toBe("100");
	});

	it("stops walking pages and rejects with AbortError when the signal aborts mid-walk", async () => {
		const controller = new AbortController();
		const { fake, client } = clientWithRoutes({
			[SHIFTS_PATH]: () => {
				controller.abort();
				return jsonResponse(
					envelope([makeShift(1, RANGE_START)], {
						page: 1,
						num_results: 3,
						total_pages: 3,
					}),
				);
			},
		});

		await expect(
			client.reports.listShifts({
				companyUid: COMPANY_UID,
				brandUid: BRAND_UID,
				startDate: RANGE_START,
				endDate: RANGE_END,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fake.requestsTo(SHIFTS_PATH)).toHaveLength(1);
	});

	it("stops after a single page when total_pages is 1", async () => {
		const { fake, client } = clientWithRoutes({
			[SHIFTS_PATH]: () =>
				jsonResponse(
					envelope([makeShift(1, RANGE_START)], {
						page: 1,
						num_results: 1,
						total_pages: 1,
					}),
				),
		});

		const result = await client.reports.listShifts({
			companyUid: COMPANY_UID,
			brandUid: BRAND_UID,
			startDate: RANGE_START,
			endDate: RANGE_END,
		});

		expect(result.pages).toBe(1);
		expect(fake.requestsTo(SHIFTS_PATH)).toHaveLength(1);
	});
});
