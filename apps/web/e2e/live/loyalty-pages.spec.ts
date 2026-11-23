import type { SupabaseClient } from "@supabase/supabase-js";
import { loyaltyReadAccess } from "../../src/loyalty/access";
import type { Membership } from "../../src/settings/source";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import {
	ADJUSTMENT_REASON,
	BULK_MEMBERS,
	COUNTRY,
	createLoyaltyFixture,
	LOYALTY_PHONES,
	type LoyaltyFixture,
} from "../support/loyalty-fixture";
import { expect, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import {
	csvTextOf,
	expectNoConsoleErrors,
	watchConsoleErrors,
} from "../support/reports";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

type Sql = ReturnType<typeof openFixtureDatabase>;
type Login = SettingsRole | "publisher";

const RESOLUTION = "Khách đưa hóa đơn giấy";
const ALL_PHONES = Object.values(LOYALTY_PHONES);
const MASK = "•••• •••";
const ANY_E164_VN = new RegExp(`\\${COUNTRY}\\d{9}`);

let fixture: SettingsFixture | undefined;
let loyalty: LoyaltyFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function seeded(): LoyaltyFixture {
	if (loyalty === undefined)
		throw new Error("the loyalty fixture was not made");
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

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

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

async function expectNoFullPhone(page: Page, text = ""): Promise<void> {
	const shown = `${(await page.locator("body").textContent()) ?? ""} ${await page.title()} ${page.url()} ${text}`;
	for (const phone of ALL_PHONES) {
		expect(shown).not.toContain(phone);
		expect(shown).not.toContain(phone.slice(COUNTRY.length));
	}
	expect(shown).not.toMatch(/(\+84|\b0)9\d{8}\b/);
}

interface Exchange {
	readonly method: string;
	readonly url: string;
	readonly body: string;
}

/**
 * Records every Data API answer the page receives, with the URL it asked;
 * the returned function waits for the bodies read so far.
 */
function recordDataApi(page: Page): () => Promise<Exchange[]> {
	const pending: Promise<Exchange>[] = [];
	page.on("response", (response) => {
		const url = response.url();
		if (!/\/rest\/v1\//.test(url)) return;
		const method = response.request().method();
		pending.push(
			response.text().then(
				(body) => ({ method, url, body }),
				() => ({ method, url, body: "" }),
			),
		);
	});
	return () => Promise.all(pending);
}

function expectNoFullPhoneIn(exchanges: readonly Exchange[]): void {
	expect(exchanges.length).toBeGreaterThan(0);
	for (const { url, body } of exchanges) {
		const text = `${decodeURIComponent(url)} ${body}`;
		for (const phone of ALL_PHONES) {
			expect(text, url).not.toContain(phone);
			expect(text, url).not.toContain(phone.slice(COUNTRY.length));
		}
		expect(text, url).not.toMatch(ANY_E164_VN);
	}
}

function csvRows(csv: string): string[][] {
	const [header = "", ...lines] = csv.trim().split(/\r?\n/);
	const separator = header.includes(";") ? ";" : ",";
	return [header, ...lines].map((line) => line.split(separator));
}

const MEMBERSHIPS: Readonly<Record<Login, (storeOne: string) => Membership>> = {
	owner: () => ({ role: "owner", storeIds: null }),
	manager: () => ({ role: "manager", storeIds: null }),
	"store-manager": (storeOne) => ({ role: "manager", storeIds: [storeOne] }),
	staff: () => ({ role: "staff", storeIds: null }),
	viewer: () => ({ role: "viewer", storeIds: null }),
	publisher: () => ({ role: "publisher", storeIds: null }),
};

test("through PostgREST, each login reads the fixture's loyalty rows its role allows, and only owners and managers of the store may resolve the queue", async () => {
	const [storeOne, storeTwo] = settings().storeIds;
	const logins: readonly Login[] = [
		"owner",
		"manager",
		"store-manager",
		"staff",
		"viewer",
		"publisher",
	];
	const reads: Record<string, string> = {};
	const phones: Record<string, string> = {};
	const local = `0${LOYALTY_PHONES.main.slice(COUNTRY.length)}`;
	for (const login of logins) {
		const client = await clientAs(login);
		const { error: phoneError } = await client
			.from("customers")
			.select("phone")
			.eq("tenant_id", settings().tenantId)
			.limit(1);
		const { data: found, error: lookupError } = await client.rpc(
			"loyalty_member_lookup",
			{ p_phone: local },
		);
		const [hit] = (found ?? []) as {
			phone_full: string | null;
			phone_masked: string | null;
		}[];
		phones[login] = [
			phoneError?.code ?? "read",
			lookupError?.code ??
				(hit === undefined
					? "none"
					: `${hit.phone_full === LOYALTY_PHONES.main ? "full" : hit.phone_full === null ? "no-full" : "other"} ${hit.phone_masked}`),
		].join(" | ");
		const count = async (table: string, storeId?: string) => {
			let query = client
				.from(table)
				.select("id", { count: "exact", head: true })
				.eq("tenant_id", settings().tenantId);
			if (storeId !== undefined) query = query.eq("store_id", storeId);
			const { count: rows, error } = await query;
			if (error !== null) return error.code ?? "error";
			return String(rows ?? 0);
		};
		reads[login] = [
			await count("memberships"),
			await count("loyalty_ledger", storeOne),
			await count("loyalty_ledger", storeTwo),
			await count("loyalty_queue"),
		].join(" ");
		const access = loyaltyReadAccess(MEMBERSHIPS[login](storeOne));
		expect(reads[login]?.startsWith("0 "), login).toBe(!access.canRead);
	}
	const members = String(seeded().memberCount);
	expect(seeded().memberCount).toBe(BULK_MEMBERS + 3);
	expect(reads).toMatchObject({
		owner: expect.stringMatching(
			new RegExp(`^${members} [1-9]\\d* [1-9]\\d* 5$`),
		),
		manager: expect.stringMatching(
			new RegExp(`^${members} [1-9]\\d* [1-9]\\d* 5$`),
		),
		"store-manager": expect.stringMatching(
			new RegExp(`^${members} [1-9]\\d* 0 5$`),
		),
		staff: "0 0 0 0",
		viewer: expect.stringMatching(
			new RegExp(`^${members} [1-9]\\d* [1-9]\\d* 0$`),
		),
		publisher: "0 0 0 0",
	});
	expect(phones).toEqual({
		owner: `42501 | full ${MASK} 201`,
		manager: `42501 | no-full ${MASK} 201`,
		"store-manager": `42501 | no-full ${MASK} 201`,
		staff: "42501 | 42501",
		viewer: `42501 | no-full ${MASK} 201`,
		publisher: "42501 | 42501",
	});
	const [choice] = seeded().queueInvoices;
	for (const login of ["staff", "viewer", "publisher"] as const) {
		const client = await clientAs(login);
		const { error } = await client.rpc("resolve_loyalty_queue_item", {
			p_item_id: seeded().queueItemId,
			p_choice: choice,
			p_reason: RESOLUTION,
		});
		expect(error?.code, login).toBe("42501");
	}
	const { error: anonymous } = await anonymousClient().rpc(
		"resolve_loyalty_queue_item",
		{ p_item_id: seeded().queueItemId, p_choice: choice, p_reason: RESOLUTION },
	);
	expect(anonymous?.code).toBe("42501");
	const [state] = await withSql(
		(sql) => sql<{ state: string }[]>`
			select state::text from public.loyalty_queue where id = ${seeded().queueItemId}
		`,
	);
	expect(state?.state).toBe("open");
	await signOutAll();
});

test("the owner lists the members masked in pages under the 1,000-row limit, looks one up by phone and opens the ledger", async ({
	page,
}) => {
	await signedIn(page, "owner");
	const answers = recordDataApi(page);
	await page.goto("/#/khach-hang");
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Khách hàng · Thành viên" }),
	).toBeVisible();
	const rows = page.getByTestId("loyalty-member-row");
	await expect(rows).toHaveCount(100);
	await expect(page.getByTestId("loyalty-members-count")).toContainText(
		"Đang hiện 100 thành viên mới nhất",
	);
	await expect(page.getByTestId("loyalty-metrics-slot")).toBeVisible();
	await expect(rows.first().getByRole("link")).toHaveText(/^•••• ••• \d{3}$/);
	await page.getByTestId("loyalty-members-more").click();
	await expect(rows).toHaveCount(seeded().memberCount);
	await expect(page.getByTestId("loyalty-members-more")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-members-count")).toHaveText(
		`${seeded().memberCount} thành viên.`,
	);
	const csv = await csvTextOf(page, "loyalty-members");
	expect(csvRows(csv)).toHaveLength(seeded().memberCount + 1);
	expect(csv).toContain(`${MASK} 201`);
	await expectNoFullPhone(page, csv);
	await checkPage(page);

	const local = `0${LOYALTY_PHONES.main.slice(COUNTRY.length)}`;
	await page.getByTestId("loyalty-lookup-input").fill(local);
	await page.getByTestId("loyalty-lookup-submit").click();
	await expect(page.getByTestId("loyalty-lookup-phone")).toHaveText(
		`${COUNTRY} 90 000 1201`,
	);
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	expect(await page.title()).not.toContain("1201");
	const exchanges = await answers();
	const lookups = exchanges.filter((exchange) =>
		exchange.url.includes("/rpc/loyalty_member_lookup"),
	);
	expect(lookups.map((exchange) => exchange.method)).toEqual(["POST"]);
	expect(lookups[0]?.body).toContain(LOYALTY_PHONES.main);
	expectNoFullPhoneIn(
		exchanges
			.filter((exchange) => !lookups.includes(exchange))
			.concat(lookups.map((exchange) => ({ ...exchange, body: "" }))),
	);
	await page.getByTestId("loyalty-lookup-open").click();
	await expect(page).toHaveURL(
		new RegExp(`#/khach-hang/thanh-vien/${seeded().members.main}$`),
	);
	await expect(page.getByTestId("loyalty-member")).toContainText(
		`Thành viên ${MASK} 201`,
	);
	const ledger = page.getByTestId("loyalty-ledger");
	await expect(ledger).toContainText("A · Số điện thoại trên hóa đơn");
	await expect(ledger).toContainText("Quà tham gia");
	await expect(ledger).toContainText(ADJUSTMENT_REASON);
	await expect(page.getByTestId("loyalty-balance-stamps")).not.toHaveText("0");
	const ledgerCsv = await csvTextOf(page, "loyalty-ledger");
	expect(csvRows(ledgerCsv).length).toBeGreaterThanOrEqual(6);
	await expectNoFullPhone(page, ledgerCsv);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("a store manager reads the four kinds of path D item below the queue, read only, with no code and no phone on the page (G-100)", async ({
	page,
}) => {
	await signedIn(page, "store-manager");
	await page.goto("/#/khach-hang/doi-soat");
	const section = page.getByTestId("loyalty-reconciliation");
	await expect(section).toContainText("Chênh lệch voucher và giảm giá (4)");
	const items = section.getByTestId("loyalty-reconciliation-item");
	await expect(items).toHaveCount(4);
	// oldest first: an invoice voided after its voucher was confirmed, the verified redemption, the amount that
	// differs, the bill discount with no redemption
	const reasons = [
		"confirmed_invoice_voided",
		"verified_without_invoice",
		"amount_mismatch",
		"discount_without_redemption",
	];
	for (const [index, reason] of reasons.entries()) {
		await expect(items.nth(index)).toHaveAttribute("data-reason", reason);
	}
	await expect(items.nth(0)).toContainText(
		"Hóa đơn đã dùng voucher bị hủy sau khi xác nhận",
	);
	await expect(items.nth(0)).toContainText("Hóa đơn số Q2");
	await expect(items.nth(1)).toContainText(
		"Voucher đã dùng nhưng chưa thấy hóa đơn",
	);
	await expect(items.nth(1)).toContainText(
		`Tên giảm giá trên POS: ${seeded().reconciliation.entryName}`,
	);
	await expect(items.nth(1)).toContainText("Chưa có hóa đơn.");
	await expect(items.nth(2)).toContainText("Hóa đơn số Q2");
	await expect(items.nth(3)).toContainText(
		`Tên giảm giá trên POS: ${seeded().reconciliation.billDiscountName}`,
	);
	await expect(items.nth(3)).toContainText("Hóa đơn số Q1");
	// read only: nothing in the section can be pressed
	await expect(section.getByRole("button")).toHaveCount(0);
	// the code of the redemption behind two of the items never reaches the page
	expect(await page.content()).not.toContain(
		seeded().reconciliation.redemptionCode,
	);
	await expectNoFullPhone(page);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("a store manager resolves the manufactured double-candidate item from the queue with a reason", async ({
	page,
}) => {
	await signedIn(page, "store-manager");
	await page.goto("/#/khach-hang/doi-soat");
	const item = page.getByTestId("loyalty-queue-item");
	await expect(item).toHaveCount(1);
	await expect(item).toContainText("Hai hóa đơn gần như nhau");
	await expect(item).toContainText(`Thành viên ${MASK} 202`);
	await expect(item.getByTestId("loyalty-queue-candidate")).toHaveCount(2);
	await expectNoFullPhone(page);
	await checkPage(page);
	await item.getByTestId("loyalty-queue-choose").click();
	await expect(item).toContainText("Chọn một hóa đơn trước.");
	await item.getByTestId("loyalty-queue-candidate").first().check();
	await item.getByTestId("loyalty-queue-reason").fill(RESOLUTION);
	await item.getByTestId("loyalty-queue-choose").click();
	await expect(page.getByTestId("loyalty-queue-status")).toHaveText(
		"Đã tích cho hóa đơn được chọn.",
	);
	await expect(page.getByTestId("loyalty-queue-none")).toBeVisible();
	await expect(page.getByTestId("loyalty-queue-history")).toContainText(
		RESOLUTION,
	);
	const [row] = await withSql(
		(sql) => sql<
			{
				state: string;
				chosen: string | null;
				entry: string | null;
				approved: string | null;
				reason: string | null;
			}[]
		>`
			select q.state::text, q.chosen_invoice_id as chosen, q.entry_id as entry,
				l.approved_by as approved, q.resolution_reason as reason
			from public.loyalty_queue q
			left join public.loyalty_ledger l on l.id = q.entry_id
			where q.id = ${seeded().queueItemId}
		`,
	);
	expect(row?.state).toBe("resolved");
	expect(seeded().queueInvoices).toContain(row?.chosen);
	expect(row?.entry).not.toBeNull();
	expect(row?.approved).toBe(settings().logins["store-manager"].userId);
	expect(row?.reason).toBe(RESOLUTION);
	expectNoConsoleErrors(page);
});

test("the anomaly page counts the fixture's earns, refusals, manual adjustment and check-in without an invoice per shift", async ({
	page,
}) => {
	await signedIn(page, "owner");
	const day = seeded().day;
	await page.goto(`/#/khach-hang/bat-thuong?from=${day}&to=${day}`);
	await expect(page.getByTestId("loyalty-anomalies-summary")).toContainText(
		"ca cần xem",
	);
	const csv = await csvTextOf(page, "loyalty-anomalies");
	const [header = [], ...lines] = csvRows(csv);
	const cell = (line: readonly string[], label: string) =>
		line[header.indexOf(label)];
	const shift = (label: string) =>
		lines.find(
			(line) =>
				cell(line, "Cửa hàng") === "Cửa hàng thử 1" &&
				cell(line, "Ca") === label,
		);
	const first = shift("Ca 1");
	const second = shift("Ca 2");
	if (first === undefined || second === undefined) {
		throw new Error(`no shift rows in ${csv}`);
	}
	expect(cell(first, "Lượt tích")).toBe("3");
	expect(cell(first, "Vượt số hóa đơn mỗi ngày")).toBe("1");
	expect(cell(first, "Số điện thoại nhân viên")).toBe("1");
	expect(cell(second, "Lượt tích")).toBe("1");
	expect(cell(second, "Điều chỉnh tay")).toBe("1");
	expect(cell(second, "Check-in không có hóa đơn")).toBe("1");
	expect(Number(cell(second, "Tín hiệu cần xem"))).toBe(2);
	await expectNoFullPhone(page, csv);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("a viewer reads the members but not the queue, and staff get the reason only", async ({
	page,
}) => {
	await signedIn(page, "viewer");
	const answers = recordDataApi(page);
	await page.goto("/#/khach-hang/thanh-vien");
	await expect(page.getByTestId("loyalty-member-row")).toHaveCount(100);
	await page.getByTestId("loyalty-members-more").click();
	await expect(page.getByTestId("loyalty-member-row")).toHaveCount(
		seeded().memberCount,
	);
	await page
		.getByTestId("loyalty-lookup-input")
		.fill(`0${LOYALTY_PHONES.main.slice(COUNTRY.length)}`);
	await page.getByTestId("loyalty-lookup-submit").click();
	await expect(page.getByTestId("loyalty-lookup-phone")).toHaveText(
		`${MASK} 201`,
	);
	await page.getByTestId("loyalty-lookup-open").click();
	await expect(page.getByTestId("loyalty-member")).toContainText(
		`Thành viên ${MASK} 201`,
	);
	await expect(page.getByTestId("loyalty-ledger")).toContainText(
		ADJUSTMENT_REASON,
	);
	await page.goto(
		`/#/khach-hang/bat-thuong?from=${seeded().day}&to=${seeded().day}`,
	);
	await expect(page.getByTestId("loyalty-anomalies-summary")).toContainText(
		"ca cần xem",
	);
	const exchanges = await answers();
	expect(
		exchanges
			.filter((exchange) => exchange.url.includes("/rpc/loyalty_member_lookup"))
			.map((exchange) => exchange.method),
	).toEqual(["POST"]);
	expect(
		exchanges.some((exchange) =>
			exchange.url.includes("/rpc/loyalty_members_page"),
		),
	).toBe(true);
	expectNoFullPhoneIn(exchanges);
	await expectNoFullPhone(page);
	await page.goto("/#/khach-hang/thanh-vien");
	await page
		.getByTestId("loyalty-tabs")
		.getByRole("link", { name: "Hàng chờ đối soát" })
		.click();
	await expect(page.getByTestId("loyalty-queue-denied")).toHaveText(
		"Chỉ chủ và quản lý cửa hàng xem và xử lý hàng chờ đối soát.",
	);
	await expect(page.getByTestId("loyalty-queue-item")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-reconciliation")).toHaveCount(0);
	await checkPage(page);
	expectNoConsoleErrors(page);
	await page.getByRole("button", { name: "Đăng xuất" }).click();
	await expect(page).toHaveURL(/#\/dang-nhap/);
	await settings().signIn(page, "staff");
	await page.goto("/#/khach-hang/thanh-vien");
	await expect(page.getByTestId("loyalty-no-access")).toHaveText(
		"Trang này chỉ dành cho chủ, quản lý và người xem số liệu.",
	);
	await expect(page.getByTestId("loyalty-member-row")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-lookup")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("teardown leaves no fixture tenant, member or login and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{
				tenants: number;
				members: number;
				ledger: number;
				customers: number;
				users: number;
			}[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.memberships where tenant_id = ${settingsFixture.tenantId}) as members,
				(select count(*)::int from public.loyalty_ledger where tenant_id = ${settingsFixture.tenantId}) as ledger,
				(select count(*)::int from public.customers where tenant_id = ${settingsFixture.tenantId}) as customers,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({
			tenants: 0,
			members: 0,
			ledger: 0,
			customers: 0,
			users: 0,
		});
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
