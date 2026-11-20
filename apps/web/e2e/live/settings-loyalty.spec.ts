import type { SupabaseClient } from "@supabase/supabase-js";
import {
	seesLoyaltyStaffPhones,
	settingsAccess,
} from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import { COUNTRY, syntheticPhone } from "../support/loyalty-fixture";
import { expect, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import { expectCurrentSettingsPage, openSettings } from "../support/settings";
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

const STAFF_PHONE = syntheticPhone("3301");
const STAFF_PHONE_LOCAL = `0${STAFF_PHONE.slice(COUNTRY.length)}`;
const UI_NAME = "Tích dấu mùa đông E2E";

let fixture: SettingsFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
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

async function outcome(
	request: PromiseLike<{ data: unknown; error: { code?: string } | null }>,
): Promise<string> {
	const { data, error } = await request;
	if (error !== null) return error.code ?? "error";
	return Array.isArray(data) && data.length === 0 ? "none" : "saved";
}

interface ProgrammeRow {
	readonly id: string;
	readonly name: string;
	readonly status: string;
	readonly notification_decision: string;
	readonly notification_decided_at: string | null;
	readonly stamps_per_card: number;
}

async function programmeRows(): Promise<ProgrammeRow[]> {
	return withSql(
		(sql) => sql<ProgrammeRow[]>`
			select id, name, status::text, notification_decision::text,
				notification_decided_at::text, stamps_per_card
			from public.loyalty_programmes
			where tenant_id = ${settings().tenantId}
			order by created_at, id
		`,
	);
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

async function openLoyalty(page: Page): Promise<void> {
	await openSettings(page, "khach-hang-than-thiet");
	await expectCurrentSettingsPage(page, "Khách hàng thân thiết");
	await expect(page.getByTestId("loyalty-settings-page")).toBeVisible();
}

async function expectNoFullPhone(page: Page, phone: string): Promise<void> {
	const national = phone.slice(COUNTRY.length);
	const text = `${(await page.locator("body").textContent()) ?? ""} ${await page.title()} ${page.url()}`;
	expect(text).not.toContain(phone);
	expect(text).not.toContain(national);
}

test("through PostgREST, the programme is written by the owner and managers of every store only, staff phones by owners and managers, and the hold and bad values give 22023", async () => {
	const [storeOne] = settings().storeIds;
	const logins: readonly Login[] = [
		"owner",
		"manager",
		"store-manager",
		"staff",
		"viewer",
		"publisher",
	];
	const members: Readonly<Record<Login, Membership>> = {
		owner: { role: "owner", storeIds: null },
		manager: { role: "manager", storeIds: null },
		"store-manager": { role: "manager", storeIds: [storeOne] },
		staff: { role: "staff", storeIds: null },
		viewer: { role: "viewer", storeIds: null },
		publisher: { role: "publisher", storeIds: null },
	};
	const results: Record<string, Record<string, string>> = {};
	for (const [index, login] of logins.entries()) {
		const client = await clientAs(login);
		const inserted = await outcome(
			client
				.from("loyalty_programmes")
				.insert({
					tenant_id: settings().tenantId,
					name: `Quyền ${login}`,
					starts_on: "2026-12-01",
				})
				.select("id"),
		);
		const phone = await outcome(
			client
				.from("loyalty_staff_phones")
				.insert({
					tenant_id: settings().tenantId,
					phone: syntheticPhone(`34${String(index).padStart(2, "0")}`),
				})
				.select("id"),
		);
		const { data: programmes } = await client
			.from("loyalty_programmes")
			.select("id")
			.eq("tenant_id", settings().tenantId);
		const { data: phones } = await client
			.from("loyalty_staff_phones")
			.select("id")
			.eq("tenant_id", settings().tenantId);
		results[login] = {
			programme: inserted,
			phone,
			reads: `${(programmes ?? []).length > 0 ? "programmes" : "-"} ${(phones ?? []).length > 0 ? "phones" : "-"}`,
		};
		expect(inserted === "saved", login).toBe(
			settingsAccess("loyalty", members[login]).canWrite,
		);
		expect(phone === "saved", login).toBe(
			seesLoyaltyStaffPhones(members[login]),
		);
	}
	expect(results).toEqual({
		owner: { programme: "saved", phone: "saved", reads: "programmes phones" },
		manager: { programme: "saved", phone: "saved", reads: "programmes phones" },
		"store-manager": {
			programme: "42501",
			phone: "saved",
			reads: "programmes phones",
		},
		staff: { programme: "42501", phone: "42501", reads: "programmes -" },
		viewer: { programme: "42501", phone: "42501", reads: "programmes -" },
		publisher: { programme: "42501", phone: "42501", reads: "- -" },
	});
	const [first] = await programmeRows();
	if (first === undefined) throw new Error("no programme");
	const viewer = await clientAs("viewer");
	expect(
		await outcome(
			viewer
				.from("loyalty_programmes")
				.update({ name: "Người xem đổi tên" })
				.eq("id", first.id)
				.select("id"),
		),
	).toBe("none");
	const owner = await clientAs("owner");
	const update = (change: Record<string, unknown>) =>
		owner
			.from("loyalty_programmes")
			.update(change)
			.eq("id", first.id)
			.select("id");
	const { error: held } = await update({ status: "active" });
	expect(held?.code).toBe("22023");
	expect(held?.message).toContain("notification decision is pending");
	expect(await outcome(update({ stamps_per_card: 25 }))).toBe("22023");
	expect(await outcome(update({ welcome_stamps: 8 }))).toBe("22023");
	expect(await outcome(update({ notification_decision: "not_required" }))).toBe(
		"22023",
	);
	expect((await programmeRows()).map((row) => row.status)).toEqual([
		"draft",
		"draft",
	]);
	expect(
		await outcome(
			anonymousClient().from("loyalty_programmes").insert({
				tenant_id: settings().tenantId,
				name: "Ẩn danh",
				starts_on: "2026-12-01",
			}),
		),
	).toBe("42501");
	await withSql(async (sql) => {
		await sql`delete from public.loyalty_programmes where tenant_id = ${settings().tenantId}`;
		await sql`delete from public.loyalty_staff_phones where tenant_id = ${settings().tenantId}`;
	});
	await signOutAll();
});

test("the owner creates the programme, is held from activating it while the decision is pending, then records the decision and activates it", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openLoyalty(page);
	await expect(page.getByTestId("loyalty-empty")).toBeVisible();
	await page.getByTestId("loyalty-create").click();
	const form = page.getByTestId("loyalty-programme-form");
	await form.getByLabel("Tên chương trình", { exact: true }).fill(UI_NAME);
	await expect(
		form.getByLabel("Số dấu đầy một thẻ", { exact: true }),
	).toHaveValue("8");
	await page.getByTestId("settings-save").click();
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await expect
		.poll(async () => (await programmeRows()).map((row) => row.name))
		.toEqual([UI_NAME]);

	await form.getByLabel("Trạng thái", { exact: true }).selectOption("active");
	await expect(
		form
			.getByTestId("loyalty-group-status")
			.getByTestId("settings-field-error"),
	).toHaveText(
		"Chưa thể chuyển sang Đang chạy khi quyết định thông báo còn chờ. Ghi quyết định trước; chưa có gì được lưu.",
	);
	await expect(page.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await page.getByTestId("settings-save").click({ force: true });
	expect((await programmeRows()).map((row) => row.status)).toEqual(["draft"]);

	await form.getByLabel("Số dấu đầy một thẻ", { exact: true }).fill("10");
	await form
		.getByLabel("Quyết định", { exact: true })
		.selectOption("below_threshold");
	await expect(page.getByTestId("loyalty-hold")).toHaveAttribute(
		"data-held",
		"false",
	);
	await page.getByTestId("settings-save").click();
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await expect
		.poll(async () => {
			const [row] = await programmeRows();
			return row === undefined
				? null
				: {
						status: row.status,
						decision: row.notification_decision,
						decided: row.notification_decided_at !== null,
						stamps: row.stamps_per_card,
					};
		})
		.toEqual({
			status: "active",
			decision: "below_threshold",
			decided: true,
			stamps: 10,
		});

	await page.reload();
	await expect(
		page.getByTestId("loyalty-programme-form").getByLabel("Trạng thái", {
			exact: true,
		}),
	).toHaveValue("active");
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the owner adds a staff phone in national form; it is stored in E.164 and shown masked, never in full, in the page, the title or the address", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openLoyalty(page);
	const phones = page.getByTestId("loyalty-staff-phones");
	await expect(phones.getByTestId("loyalty-phones-none")).toBeVisible();
	await phones.getByTestId("loyalty-phone-input").fill(STAFF_PHONE_LOCAL);
	await phones.getByTestId("loyalty-phone-label").fill("Pha chế");
	await phones.getByTestId("loyalty-phone-add").click();
	await expect(phones.getByTestId("loyalty-phone-masked")).toHaveText(
		`${COUNTRY} ••• ••• 301`,
	);
	await expect(phones.getByTestId("loyalty-phones-status")).toHaveText(
		`Đã thêm số ${COUNTRY} ••• ••• 301.`,
	);
	await expect(phones.getByTestId("loyalty-phone-input")).toHaveValue("");
	const stored = await withSql(
		(sql) => sql<{ phone: string; label: string | null }[]>`
			select phone, label from public.loyalty_staff_phones where tenant_id = ${settings().tenantId}
		`,
	);
	expect(stored).toEqual([{ phone: STAFF_PHONE, label: "Pha chế" }]);
	await expectNoFullPhone(page, STAFF_PHONE);
	await phones.getByTestId("loyalty-phone-input").fill(STAFF_PHONE);
	await phones.getByTestId("loyalty-phone-add").click();
	await expect(phones.getByTestId("loyalty-phones-status")).toHaveText(
		"Số này đã có trong danh sách.",
	);
	await page.reload();
	await expect(
		page
			.getByTestId("loyalty-staff-phones")
			.getByTestId("loyalty-phone-masked"),
	).toHaveText(`${COUNTRY} ••• ••• 301`);
	await expectNoFullPhone(page, STAFF_PHONE);
	await checkPage(page);
	expectNoConsoleErrors(page, [
		{
			text: /status of 409/,
			url: /\/rest\/v1\/loyalty_staff_phones/,
			atMost: 1,
		},
	]);
});

test("a viewer sees the programme read only and no staff phones; staff see no write control", async ({
	page,
}) => {
	for (const role of ["viewer", "staff"] as const) {
		await signedIn(page, role);
		await openLoyalty(page);
		await expect(page.getByTestId("settings-read-only")).toHaveText(
			"Bạn chỉ xem được chương trình. Chỉ chủ và quản lý toàn chuỗi mới sửa được.",
		);
		const form = page.getByTestId("loyalty-programme-form");
		await expect(
			form.getByLabel("Tên chương trình", { exact: true }),
		).toHaveValue(UI_NAME);
		await expect(
			form.getByLabel("Tên chương trình", { exact: true }),
		).toHaveAttribute("readonly", "");
		await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
		await expect(page.locator("main select")).toHaveCount(0);
		await expect(page.getByTestId("loyalty-create")).toHaveCount(0);
		await expect(page.getByTestId("loyalty-staff-phones")).toHaveCount(0);
		await expectNoFullPhone(page, STAFF_PHONE);
		if (role === "viewer") await checkPage(page);
		expectNoConsoleErrors(page);
		await page.getByRole("button", { name: "Đăng xuất" }).click();
		await expect(page).toHaveURL(/#\/dang-nhap/);
	}
});

test("teardown leaves no fixture tenant, programme or login and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{ tenants: number; programmes: number; phones: number; users: number }[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.loyalty_programmes where tenant_id = ${settingsFixture.tenantId}) as programmes,
				(select count(*)::int from public.loyalty_staff_phones where tenant_id = ${settingsFixture.tenantId}) as phones,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({ tenants: 0, programmes: 0, phones: 0, users: 0 });
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
