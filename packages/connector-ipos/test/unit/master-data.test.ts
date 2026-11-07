import { describe, expect, it } from "vitest";
import { createIposClient, IposError, LOGIN_PATH } from "../../src/index.js";
import {
	BRAND_UID,
	COMPANY_UID,
	envelope,
	makeItem,
	makeLoginPayload,
	STORE_UID,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const ITEMS_PATH = "/api/mdata/v1/items";
const PROMOTIONS_PATH = "/api/mdata/v1/promotions";
const USERS_PATH = "/api/accounts/v1/users";
const scope = { companyUid: COMPANY_UID, brandUid: BRAND_UID };

function setup() {
	const fake = createFakeFetch(
		routeByPath({
			[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
			[ITEMS_PATH]: () =>
				jsonResponse(envelope([makeItem(1), makeItem(2)], { total_item: 2 })),
			[PROMOTIONS_PATH]: () =>
				jsonResponse(
					envelope([
						{
							promotion_id: "P01",
							promotion_name: "Promotion A",
							promotions: [],
						},
					]),
				),
			[USERS_PATH]: () =>
				jsonResponse(
					envelope([
						{
							id: "u-1",
							full_name: "Manager A",
							email: "manager@example.com",
							active: 1,
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

describe("master data queries", () => {
	it("always sends list_store_uid for items", async () => {
		const { fake, client } = setup();

		const items = await client.listItems({ ...scope, storeUid: STORE_UID });

		expect(items).toHaveLength(2);
		expect(items[0]?.item_name).toBe("Item 1 (M)");
		expect(
			fake.requestsTo(ITEMS_PATH)[0]?.url.searchParams.get("list_store_uid"),
		).toBe(STORE_UID);
	});

	it("never sends an empty list_store_uid", async () => {
		const { fake, client } = setup();

		await expect(
			client.listItems({ ...scope, storeUid: "" }),
		).rejects.toBeInstanceOf(IposError);
		await expect(
			client.listItems({ ...scope, storeUid: "   " }),
		).rejects.toThrow(/storeUid/);
		await expect(
			client.listPackages({ ...scope, storeUid: "" }),
		).rejects.toThrow(/storeUid/);

		expect(fake.requestsTo(ITEMS_PATH)).toHaveLength(0);
		for (const request of fake.requests) {
			expect(request.url.searchParams.get("list_store_uid")).not.toBe("");
		}
	});

	it("asks for aggregated promotions", async () => {
		const { fake, client } = setup();

		const promotions = await client.listPromotions(scope);

		expect(promotions[0]?.promotion_name).toBe("Promotion A");
		expect(
			fake.requestsTo(PROMOTIONS_PATH)[0]?.url.searchParams.get("aggregate"),
		).toBe("true");
	});

	it("lists users without the skip_limit flag the accounts API rejects", async () => {
		const { fake, client } = setup();

		const users = await client.listUsers(scope);

		expect(users).toHaveLength(1);
		const [request] = fake.requestsTo(USERS_PATH);
		expect(request?.url.searchParams.has("skip_limit")).toBe(false);
		expect(request?.url.searchParams.get("company_uid")).toBe(COMPANY_UID);
	});
});
