import { canonicalStoreSchema } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { receiptNumbersResetOf } from "../../src/connector/scope.js";
import { createIposConnector, LOGIN_PATH } from "../../src/index.js";
import {
	envelope,
	makeLoginPayload,
	makeLoginStore,
	makeStore,
	STORE_UID,
	TEST_CREDENTIALS,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const STORES_PATH = "/api/mdata/v1/stores";

async function discover(
	listedExtra: unknown,
	loginOverrides: Record<string, unknown> = {},
) {
	const login = makeLoginPayload();
	login.stores = [makeLoginStore(loginOverrides)];
	const listed =
		listedExtra === undefined
			? []
			: [{ ...makeStore(1), extra_data: listedExtra }];
	const fake = createFakeFetch(
		routeByPath({
			[LOGIN_PATH]: () => jsonResponse(envelope(login)),
			[STORES_PATH]: () => jsonResponse(envelope(listed)),
		}),
	);
	const connector = createIposConnector({ fetch: fake.fetch });
	await connector.authenticate(TEST_CREDENTIALS);
	const stores = await connector.discoverStores();
	return { stores, fake };
}

describe("the store's receipt numbering (extra_data.reset_tran_no_period)", () => {
	it("maps DAILY and YEARLY, case and spaces ignored, and anything else to unknown", () => {
		expect(
			[
				{ reset_tran_no_period: "DAILY" },
				{ reset_tran_no_period: " daily " },
				{ reset_tran_no_period: "YEARLY" },
				{ reset_tran_no_period: "MONTHLY" },
				{ reset_tran_no_period: "" },
				{ reset_tran_no_period: 1 },
				{ reset_tran_no_period: null },
				{},
				null,
				"DAILY",
				undefined,
			].map(receiptNumbersResetOf),
		).toEqual([
			"daily",
			"daily",
			"yearly",
			"unknown",
			"unknown",
			"unknown",
			"unknown",
			"unknown",
			"unknown",
			"unknown",
			"unknown",
		]);
	});

	it("gives a store whose master says DAILY the daily numbering, a canonical store", async () => {
		const { stores, fake } = await discover({
			open_at: 0,
			reset_tran_no_period: "DAILY",
		});
		expect(stores).toHaveLength(1);
		const [store] = stores;
		expect(store).toMatchObject({
			externalId: STORE_UID,
			name: "Store A",
			receiptNumbersReset: "daily",
		});
		expect(canonicalStoreSchema.parse(store)).toEqual(store);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(1);
	});

	it("reads YEARLY, and unknown for a store without the setting or with another period", async () => {
		expect(
			(await discover({ reset_tran_no_period: "YEARLY" })).stores[0]
				?.receiptNumbersReset,
		).toBe("yearly");
		expect(
			(await discover({ open_at: 0 })).stores[0]?.receiptNumbersReset,
		).toBe("unknown");
		expect(
			(await discover({ reset_tran_no_period: "WEEKLY" })).stores[0]
				?.receiptNumbersReset,
		).toBe("unknown");
		expect((await discover(undefined)).stores[0]?.receiptNumbersReset).toBe(
			"unknown",
		);
	});

	it("keeps the stores master's setting when the login payload's store row has none, and the login's when it has one", async () => {
		expect(
			(
				await discover(
					{ reset_tran_no_period: "DAILY" },
					{ extra_data: { open_at: 0 } },
				)
			).stores[0]?.receiptNumbersReset,
		).toBe("daily");
		expect(
			(
				await discover(
					{ reset_tran_no_period: "DAILY" },
					{ extra_data: { reset_tran_no_period: "YEARLY" } },
				)
			).stores[0]?.receiptNumbersReset,
		).toBe("yearly");
		expect(
			(
				await discover(undefined, {
					extra_data: { reset_tran_no_period: "DAILY" },
				})
			).stores[0]?.receiptNumbersReset,
		).toBe("daily");
	});
});
