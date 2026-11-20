import { expect, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import {
	COUNTRY,
	createLoyaltyFixture,
	LOYALTY_PHONES,
	type LoyaltyFixture,
} from "../support/loyalty-fixture";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	createSettingsFixture,
	openFixtureDatabase,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

type Login = SettingsRole | "publisher";

const METRIC_IDS = [
	"customer_capture_rate",
	"repeat_rate",
	"visit_frequency_30d",
	"visit_frequency_90d",
	"loyalty_liability",
	"breakage_rate",
	"reward_cost_rate",
	"member_frequency_uplift",
];

let fixture: SettingsFixture | undefined;
let loyalty: LoyaltyFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function seeded(): LoyaltyFixture {
	if (loyalty === undefined) throw new Error("no loyalty fixture");
	return loyalty;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	loyalty = await createLoyaltyFixture(fixture);
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	await fixture?.teardown();
});

async function clientAs(login: Login): Promise<SupabaseClient> {
	let client: SupabaseClient;
	if (login === "publisher") {
		const made = await settings().addPublisher();
		client = anonymousClient();
		const { error } = await client.auth.signInWithPassword({
			email: made.email,
			password: made.password,
		});
		if (error) throw error;
	} else {
		client = await settings().clientAs(login);
	}
	clients.push(client);
	return client;
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

test("through PostgREST, only roles that read loyalty get the customer metrics, as aggregates without phones or ids", async () => {
	const day = seeded().day;
	const stores = [...settings().storeIds];
	const outcomes: Record<string, string> = {};
	for (const login of [
		"owner",
		"manager",
		"store-manager",
		"viewer",
		"staff",
		"publisher",
	] as const) {
		const client = await clientAs(login);
		const metrics = await client.rpc("customer_metrics", {
			p_store_ids: stores,
			p_from: day,
			p_to: day,
		});
		const rfm = await client.rpc("rfm_quintiles", {
			p_store_ids: stores,
			p_as_of: day,
		});
		const text = JSON.stringify([metrics.data, rfm.data]);
		const leaked =
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(text) ||
			/\+84\d{9}/.test(text) ||
			text.includes(LOYALTY_PHONES.main.slice(COUNTRY.length));
		outcomes[login] = [
			metrics.error?.code ?? "ok",
			rfm.error?.code ?? "ok",
			leaked ? "LEAK" : "no ids",
		].join(" | ");
	}
	expect(outcomes).toEqual({
		owner: "ok | ok | no ids",
		manager: "ok | ok | no ids",
		"store-manager": "ok | ok | no ids",
		viewer: "ok | ok | no ids",
		staff: "42501 | 42501 | no ids",
		publisher: "42501 | 42501 | no ids",
	});
	const owner = await clientAs("owner");
	const { data } = await owner.rpc("customer_metrics", {
		p_store_ids: stores,
		p_from: day,
		p_to: day,
	});
	const [row] = data as {
		invoices: number;
		identified_invoices: number;
		customer_capture_rate: number | null;
		repeat_rate: number | null;
		loyalty_liability: number | null;
	}[];
	const sql = openFixtureDatabase();
	try {
		const [expected] = await sql<{ invoices: number; identified: number }[]>`
			select count(*)::int as invoices, count(*) filter (where has_customer_identity)::int as identified
			from public.invoices
			where tenant_id = ${settings().tenantId} and business_date = ${day}::date and status <> 'voided'
		`;
		expect(row?.invoices).toBe(expected?.invoices);
		expect(row?.identified_invoices).toBe(expected?.identified);
		if (expected !== undefined && expected.invoices > 0) {
			expect(Number(row?.customer_capture_rate)).toBeCloseTo(
				expected.identified / expected.invoices,
				3,
			);
		}
	} finally {
		await sql.end();
	}
	expect(row?.repeat_rate).toBeNull();
	expect(row?.loyalty_liability).not.toBeNull();
	const refused = await owner.rpc("customer_metrics", {
		p_store_ids: stores,
		p_from: day,
		p_to: "2000-01-01",
	});
	expect(refused.error?.code).toBe("22023");
});

test("the members page shows the eight metric cards, a missing input as not measured, and no phone", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await page.goto("/#/khach-hang/thanh-vien");
	const cards = page.getByTestId("customer-metric");
	await expect(cards).toHaveCount(METRIC_IDS.length);
	for (const id of METRIC_IDS) {
		await expect(
			page.locator(`[data-testid="customer-metric"][data-metric="${id}"]`),
		).toBeVisible();
	}
	await expect(
		page
			.locator('[data-testid="customer-metric"][data-metric="repeat_rate"]')
			.getByTestId("customer-metric-value"),
	).toHaveText("Chưa đo được");
	await expect(
		page
			.locator(
				'[data-testid="customer-metric"][data-metric="loyalty_liability"]',
			)
			.getByTestId("customer-metric-value"),
	).not.toHaveText("Chưa đo được");
	const shown = (await page.locator("body").textContent()) ?? "";
	expect(shown).not.toMatch(/(\+84|\b0)9\d{8}\b/);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("a viewer sees the cards and staff do not reach the page", async ({
	page,
}) => {
	await signedIn(page, "viewer");
	await page.goto("/#/khach-hang/thanh-vien");
	await expect(page.getByTestId("customer-metric")).toHaveCount(
		METRIC_IDS.length,
	);
	await page.getByRole("button", { name: "Đăng xuất" }).click();
	await expect(page).toHaveURL(/#\/dang-nhap/);
	await settings().signIn(page, "staff");
	await page.goto("/#/khach-hang/thanh-vien");
	await expect(page.getByTestId("loyalty-no-access")).toBeVisible();
	await expect(page.getByTestId("customer-metric")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("teardown leaves every real tenant as it was", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	expect(await snapshotRealTenants(before)).toEqual(before);
});
