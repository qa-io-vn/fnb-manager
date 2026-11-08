import { describe, expect, it } from "vitest";
import {
	createIposClient,
	type IposClient,
	vietnamDayRange,
	vietnamDaysAgo,
	vietnamRange,
} from "../../src/index.js";
import {
	hasAppAccessToken,
	IPOS_CONNECTOR_KEY,
	type LiveAccount,
	liveEnabled,
	loadLiveAccounts,
	resolveAppAccessToken,
	timed,
} from "./accounts.js";

function findFirstAccount(): LiveAccount | undefined {
	const accounts = loadLiveAccounts();
	return (
		accounts.find((candidate) => candidate.connector === IPOS_CONNECTOR_KEY) ??
		accounts[0]
	);
}

function firstAccount(): LiveAccount {
	const account = findFirstAccount();
	if (!account) {
		throw new Error("POS_ACCOUNTS_JSON holds no account");
	}
	return account;
}

function expectNonNegativeCount(value: unknown): void {
	expect(typeof value).toBe("number");
	expect(value as number).toBeGreaterThanOrEqual(0);
}

const smokeEnabled = liveEnabled && hasAppAccessToken(findFirstAccount());
if (liveEnabled && !smokeEnabled) {
	console.log(
		"[live] iPOS live smoke skipped: set IPOS_APP_KEY in .env or add appAccessToken to the POS_ACCOUNTS_JSON entry",
	);
}

describe.skipIf(!smokeEnabled)("iPOS live smoke", () => {
	let client: IposClient;
	let companyUid = "";
	let brandUid = "";
	let storeUid = "";

	it("logs in and exposes company, brand and store identifiers", {
		timeout: 60_000,
	}, async () => {
		const account = firstAccount();
		client = createIposClient({
			email: account.email,
			password: account.password,
			appAccessToken: resolveAppAccessToken(account),
		});

		const payload = await timed("login", () => client.login());

		expect(payload.token.length).toBeGreaterThan(20);
		expect(payload.brands.length).toBeGreaterThan(0);
		expect(payload.stores.length).toBeGreaterThan(0);
		companyUid = payload.company.id;
		brandUid = payload.brands[0]?.id ?? "";
		storeUid = payload.stores[0]?.id ?? "";
		expect(companyUid).not.toBe("");
		expect(brandUid).not.toBe("");
		expect(storeUid).not.toBe("");
		console.log(
			`[live] login: brands=${payload.brands.length} stores=${payload.stores.length}`,
		);
	});

	it("lists stores", { timeout: 60_000 }, async () => {
		const stores = await timed("listStores", () =>
			client.listStores({ companyUid, brandUid }),
		);

		expect(Array.isArray(stores)).toBe(true);
		expect(stores.length).toBeGreaterThan(0);
		for (const store of stores) {
			expect(typeof store.id).toBe("string");
			expect(typeof store.store_name).toBe("string");
		}
		console.log(`[live] listStores: count=${stores.length}`);
	});

	it("fetches daily sales for the last 7 days", {
		timeout: 60_000,
	}, async () => {
		const range = vietnamRange(vietnamDaysAgo(7), vietnamDaysAgo(1));

		const days = await timed("saleSummary.days", () =>
			client.saleSummary.days({ companyUid, brandUid, ...range }),
		);

		expect(Array.isArray(days.list_data)).toBe(true);
		expectNonNegativeCount(days.total_sales);
		expectNonNegativeCount(days.revenue_net);
		for (const day of days.list_data) {
			expect(Number.isInteger(day.tran_date)).toBe(true);
			expectNonNegativeCount(day.total_sales);
		}
		console.log(`[live] saleSummary.days: days=${days.list_data.length}`);
	});

	it("fetches yesterday's invoices for the first store", {
		timeout: 120_000,
	}, async () => {
		const range = vietnamDayRange(vietnamDaysAgo(1));

		const result = await timed("accounting.listInvoices", () =>
			client.accounting.listInvoices({
				companyUid,
				brandUid,
				storeUid,
				...range,
			}),
		);

		expect(Array.isArray(result.rows)).toBe(true);
		expectNonNegativeCount(result.rows.length);
		expect(result.pages).toBeGreaterThanOrEqual(1);
		for (const invoice of result.rows) {
			expect(typeof invoice.tran_id).toBe("string");
			expect(Number.isInteger(invoice.tran_date)).toBe(true);
			expect(typeof invoice.total_amount).toBe("number");
		}
		console.log(
			`[live] accounting.listInvoices: invoices=${result.rows.length} pages=${result.pages}`,
		);
	});
});
