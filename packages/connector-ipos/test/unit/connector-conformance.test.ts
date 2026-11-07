import { collectSales } from "@fnb/connector-core";
import { runConnectorConformanceSuite } from "@fnb/connector-core/conformance";
import type { DataQualityFlag } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { createIposConnector } from "../../src/index.js";
import { TEST_CREDENTIALS } from "../fixtures/factories.js";
import { createFakeFetch } from "../fixtures/fake-fetch.js";
import {
	FIXTURE_DELIVERY_SOURCES,
	fixtureResponder,
	renderFixtureShop,
} from "../fixtures/ipos-fixture-renderer.js";

const credentials = TEST_CREDENTIALS;
const WINDOW = { fromDate: "2026-10-26", toDate: "2026-11-01" };

const shop = renderFixtureShop({ seed: 11, ...WINDOW });

runConnectorConformanceSuite(
	"iPOS adapter over synthetic Fabi fixtures",
	() =>
		createIposConnector({
			fetch: createFakeFetch(fixtureResponder(shop)).fetch,
			deliverySources: FIXTURE_DELIVERY_SOURCES,
			resultsPerPage: 40,
			batchDays: 3,
		}),
	{ credentials, window: WINDOW, expectFullyPaid: true },
);

const lateShop = renderFixtureShop({
	seed: 12,
	fromDate: "2026-01-30",
	toDate: "2026-02-02",
	profile: { dayStartMinutes: 5 * 60 },
});

runConnectorConformanceSuite(
	"iPOS adapter with a 05:00 day start taken from the store's open_at",
	() =>
		createIposConnector({
			fetch: createFakeFetch(fixtureResponder(lateShop)).fetch,
			deliverySources: FIXTURE_DELIVERY_SOURCES,
		}),
	{
		credentials,
		window: { fromDate: "2026-01-30", toDate: "2026-02-02" },
		expectFullyPaid: true,
	},
);

describe("iPOS adapter data-quality flags on clean fixtures", () => {
	it("raises no flags and reproduces the generated sales one to one", async () => {
		const flags: DataQualityFlag[] = [];
		const fake = createFakeFetch(fixtureResponder(shop));
		const connector = createIposConnector({
			fetch: fake.fetch,
			deliverySources: FIXTURE_DELIVERY_SOURCES,
			onFlag: (flag) => flags.push(flag),
		});
		await connector.authenticate(credentials);
		const [store] = await connector.discoverStores();
		if (!store) {
			throw new Error("fixture login returned no store");
		}
		const sales = await collectSales(connector.fetchSales(store, WINDOW));
		const expected = shop.sales.filter(
			(sale) =>
				sale.businessDate >= WINDOW.fromDate &&
				sale.businessDate <= WINDOW.toDate,
		);

		expect(flags).toEqual([]);
		expect(sales.map((sale) => sale.externalId).sort()).toEqual(
			expected.map((sale) => sale.externalId).sort(),
		);
		const byId = new Map(expected.map((sale) => [sale.externalId, sale]));
		for (const sale of sales) {
			const source = byId.get(sale.externalId);
			expect(source).toBeDefined();
			expect(sale.netAmount).toBe(source?.netAmount);
			expect(sale.grossAmount).toBe(source?.grossAmount);
			expect(sale.itemDiscountAmount).toBe(source?.itemDiscountAmount);
			expect(sale.billDiscountAmount).toBe(source?.billDiscountAmount);
			expect(sale.voucherAmount).toBe(source?.voucherAmount);
			expect(sale.channel).toBe(source?.channel);
			expect(sale.payments.map((payment) => payment.kind).sort()).toEqual(
				source?.payments.map((payment) => payment.kind).sort(),
			);
			expect(
				sale.lines.filter((line) => line.lineKind === "modifier").length,
			).toBe(
				source?.lines.filter((line) => line.lineKind === "modifier").length,
			);
		}
		const typed = sales
			.flatMap((sale) => sale.lines)
			.filter((line) => line.lineKind === "item");
		expect(typed.every((line) => line.itemTypeName !== undefined)).toBe(true);
		const detailCalls = fake.requestsTo(
			"/api/v1/accounting/report/sale-detail",
		);
		expect(detailCalls.length).toBeGreaterThan(0);
	});
});
