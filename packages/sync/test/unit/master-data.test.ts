import { createMockConnector } from "@fnb/connector-mock";
import { describe, expect, it } from "vitest";
import {
	createFakeConnector,
	EMPTY_CATALOG,
} from "../support/fake-connector.js";
import { createTestBed } from "../support/setup.js";

describe("syncMasterData", () => {
	it("writes stores with their timezone and day start and the account catalogue", async () => {
		const bed = await createTestBed({ storeExternalId: "MOCK-S1" });
		const connector = createMockConnector({
			profile: { dayStartMinutes: 240 },
		});
		await connector.authenticate({ seed: 3, storeCount: 2 });
		const summary = await bed.engine(connector).syncMasterData(bed.account);
		expect(summary.status).toBe("succeeded");
		expect(summary.stores).toEqual({
			discovered: 2,
			active: 2,
			deactivated: 0,
		});
		const stores = await bed.repository.listStores(bed.account.id);
		expect(
			stores.map((store) => [
				store.external_id,
				store.business_day_start_minutes,
				store.timezone,
				store.opened_on,
			]),
		).toEqual([
			["MOCK-S1", 240, "Asia/Ho_Chi_Minh", "2024-01-01"],
			["MOCK-S2", 240, "Asia/Ho_Chi_Minh", "2024-01-01"],
		]);
		const methods = bed.repository.catalogRows("payment_methods");
		expect(methods.length).toBeGreaterThan(0);
		expect(methods.every((row) => typeof row.values.kind === "string")).toBe(
			true,
		);
		expect(bed.repository.catalogRows("items").length).toBe(
			summary.tables.items,
		);
		expect(summary.tables.units).toBeUndefined();
		expect(bed.repository.tables.runs[0]).toMatchObject({
			kind: "master_data",
			status: "succeeded",
			range_start: null,
		});
		const kinds = await bed.repository.paymentMethodKinds(bed.account.id);
		expect(Object.values(kinds)).toContain("cash");
	});

	it("deactivates stores and catalogue rows the POS no longer lists", async () => {
		const bed = await createTestBed({ storeExternalId: "OLD-STORE" });
		const connector = createFakeConnector({
			stores: [
				{
					externalId: "NEW-STORE",
					name: "Mới",
					timezone: "Asia/Ho_Chi_Minh",
					dayStartMinutes: 0,
					currency: "VND",
				},
			],
			catalog: {
				...EMPTY_CATALOG,
				sources: [{ externalId: "SRC-1", name: "Tại chỗ", isDelivery: false }],
			},
		});
		await bed.engine(connector).syncMasterData(bed.account);
		connector.data.catalog = EMPTY_CATALOG;
		const second = await bed.engine(connector).syncMasterData(bed.account);
		const stores = await bed.repository.listStores(bed.account.id);
		expect(stores.map((store) => [store.external_id, store.active])).toEqual([
			["NEW-STORE", true],
			["OLD-STORE", false],
		]);
		expect(second.stores).toEqual({ discovered: 1, active: 1, deactivated: 1 });
		expect(
			bed.repository.catalogRows("sources").map((row) => row.active),
		).toEqual([false]);
	});

	it("flags a store whose currency differs from the tenant", async () => {
		const bed = await createTestBed();
		const connector = createFakeConnector({
			stores: [
				{
					externalId: "STORE-1",
					name: "Cửa hàng",
					timezone: "Asia/Ho_Chi_Minh",
					dayStartMinutes: 0,
					currency: "USD",
				},
			],
		});
		const summary = await bed.engine(connector).syncMasterData(bed.account);
		expect(summary.flags).toContainEqual({
			code: "store_currency_differs_from_tenant",
			severity: "warn",
			count: 1,
		});
	});
});
