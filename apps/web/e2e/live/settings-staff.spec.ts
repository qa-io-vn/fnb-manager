import { expect, type Locator, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	settingsAccess,
	staffPageAccess,
	staffRowAccess,
} from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { createSupabaseSettingsSource } from "../../src/settings/supabase-settings-source";
import {
	checkPage,
	expectNoSeriousAxeViolations,
	PHONE_WIDTH,
} from "../support/checks";
import { clipboardText } from "../support/clipboard";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import {
	type ExpectedConsoleError,
	expectNoConsoleErrors,
	watchConsoleErrors,
} from "../support/reports";
import { openSettings, settingsNav } from "../support/settings";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	openFixtureDatabase,
	SETTINGS_ROLES,
	type SettingsFixture,
	type SettingsRole,
} from "../support/settings-fixture";
import {
	ensureStaffFixture,
	STAFF_APP_TITLE,
	type StaffFixture,
	staffFixtureCounts,
} from "../support/staff-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

type Sql = ReturnType<typeof openFixtureDatabase>;

const DESKTOP_WIDTH = 1280;
const SCREEN_HEIGHT = 800;
const SIX_DIGITS = /^[0-9]{6}$/;

const PAIRING_REFUSAL: ExpectedConsoleError = {
	text: /status of 40[03]/,
	url: /\/rest\/v1\/rpc\/issue_pairing_code/,
	atMost: 1,
};

let fixture: SettingsFixture | undefined;
let staff: StaffFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function created(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function staffApp(): StaffFixture {
	if (staff === undefined) throw new Error("the staff fixture was not made");
	return staff;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	staff = await ensureStaffFixture(fixture);
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	await fixture?.teardown();
});

interface RosterRow {
	readonly id: string;
	readonly display_name: string;
	readonly role: string;
	readonly store_ids: string[] | null;
	readonly status: string;
	readonly deactivated_at: Date | null;
	readonly created_by: string | null;
}

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

async function rosterRow(name: string): Promise<RosterRow | undefined> {
	return withSql(async (sql) => {
		const [row] = await sql<RosterRow[]>`
			select id, display_name, role::text as role, store_ids, status, deactivated_at, created_by
			from public.staff_roster
			where tenant_id = ${created().tenantId} and display_name = ${name}
		`;
		return row;
	});
}

async function rosterIdOf(name: string): Promise<string> {
	const found = await rosterRow(name);
	if (found === undefined) throw new Error(`no roster row ${name}`);
	return found.id;
}

async function insertRosterRow(
	name: string,
	storeIndex: 0 | 1,
): Promise<string> {
	return withSql(async (sql) => {
		const [made] = await sql<{ id: string }[]>`
			insert into public.staff_roster (tenant_id, display_name, role, store_ids, created_by)
			values (${created().tenantId}, ${name}, 'staff', ${[created().storeIds[storeIndex]]}::uuid[], ${created().logins.owner.userId})
			returning id
		`;
		if (made === undefined) throw new Error("no roster row made");
		return made.id;
	});
}

interface LiveCodes {
	readonly codes: number;
	readonly matches: boolean;
	readonly minutesLeft: number;
}

async function liveCodes(rosterId: string, code: string): Promise<LiveCodes> {
	return withSql(async (sql) => {
		const [found] = await sql<LiveCodes[]>`
			select
				count(*)::int as codes,
				coalesce(bool_or(c.code_sha256 = app.staff_pairing_code_hash(c.tenant_id, ${code})), false) as matches,
				coalesce(max(extract(epoch from c.expires_at - now()) / 60), 0)::float8 as "minutesLeft"
			from app.staff_pairing_codes c
			where c.roster_id = ${rosterId}
		`;
		if (found === undefined) throw new Error("no answer");
		return found;
	});
}

async function revenueLevel(): Promise<string | undefined> {
	return withSql(async (sql) => {
		const [row] = await sql<{ staff_revenue_visibility: string }[]>`
			select staff_revenue_visibility from public.tenants where id = ${created().tenantId}
		`;
		return row?.staff_revenue_visibility;
	});
}

function content(page: Page): Locator {
	return page.locator('section[aria-labelledby="settings-page-title"]');
}

function row(page: Page, name: string): Locator {
	return page
		.getByTestId("staff-roster")
		.getByTestId("staff-row")
		.filter({
			has: page
				.getByTestId("staff-name")
				.filter({ hasText: new RegExp(`^${name}$`) }),
		});
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await created().signIn(page, role);
}

async function openStaff(page: Page): Promise<void> {
	await settingsNavFrom(page);
	await settingsNav(page).getByRole("link", { name: "Nhân viên" }).click();
	await expect(
		page.getByRole("heading", { level: 2, name: "Nhân viên", exact: true }),
	).toBeVisible();
	await expect(page.getByTestId("staff-roster-list")).toBeVisible();
}

async function settingsNavFrom(page: Page): Promise<void> {
	await openSettings(page, "cua-hang");
	await expect(page.getByTestId("store-page")).toBeVisible();
}

async function addPerson(
	page: Page,
	name: string,
	stores: readonly string[],
): Promise<void> {
	await page.getByRole("button", { name: "Thêm nhân viên" }).click();
	const form = page.getByTestId("staff-form");
	await form.getByLabel("Tên hiển thị").fill(name);
	for (const store of stores) await form.getByLabel(store).check();
	await form.getByRole("button", { name: "Thêm" }).click();
	await expect(page.getByTestId("staff-roster-status")).toHaveText(
		`Đã thêm ${name}.`,
	);
}

async function deactivate(page: Page, name: string): Promise<void> {
	const target = row(page, name);
	await target.getByRole("button", { name: `Ngừng quyền của ${name}` }).click();
	await target
		.getByRole("button", { name: "Ngừng quyền", exact: true })
		.click();
	await expect(page.getByTestId("staff-roster-status")).toHaveText(
		`Đã ngừng quyền của ${name}.`,
	);
	await expect(target).toHaveAttribute("data-status", "inactive");
}

async function issueCode(page: Page, name: string): Promise<string> {
	const target = row(page, name);
	await target
		.getByRole("button", { name: `Tạo mã ghép nối cho ${name}` })
		.click();
	const value = target.getByTestId("pairing-code-value");
	await expect(value).toHaveText(SIX_DIGITS);
	return (await value.textContent()) ?? "";
}

function watchConsole(page: Page): string[] {
	const messages: string[] = [];
	page.on("console", (message) => messages.push(message.text()));
	return messages;
}

async function expectCodeKeptNowhere(
	page: Page,
	code: string,
	messages: readonly string[],
): Promise<void> {
	const stored = await page.evaluate(() =>
		JSON.stringify([
			Object.entries(window.localStorage),
			Object.entries(window.sessionStorage),
			document.cookie,
			window.location.href,
			window.history.state,
		]),
	);
	expect(stored).not.toContain(code);
	expect(page.url()).not.toContain(code);
	expect(messages.filter((message) => message.includes(code))).toEqual([]);
}

test("the fixture helper adds its roster rows, brand, Zalo App and staff app once, so a run on a long-lived stack adds nothing twice", async () => {
	const first = await staffFixtureCounts(created());
	expect(first).toEqual({ roster: 3, brands: 1, zaloApps: 1, miniApps: 1 });
	const again = await ensureStaffFixture(created());
	expect(again).toEqual(staffApp());
	expect(await staffFixtureCounts(created())).toEqual(first);
});

test("the owner adds, edits, deactivates and reactivates a person through the roster functions, prints each store's QR code and sets the revenue staff see", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openStaff(page);
	for (const name of ["Nhân viên E2E 1", "Nhân viên E2E 2", "Quản lý E2E 1"]) {
		await expect(row(page, name)).toHaveCount(1);
		await expect(row(page, name).getByTestId("staff-pairing")).toHaveText(
			"Chưa ghép nối",
		);
	}
	await expect(
		row(page, "Quản lý E2E 1").getByTestId("staff-stores"),
	).toHaveText("Cửa hàng thử 1, Cửa hàng thử 2");

	await addPerson(page, "Nhân viên E2E 3", ["Cửa hàng thử 1"]);
	const added = await rosterRow("Nhân viên E2E 3");
	expect(added).toMatchObject({
		role: "staff",
		store_ids: [created().storeIds[0]],
		status: "invited",
		created_by: created().logins.owner.userId,
	});
	await expect(
		row(page, "Nhân viên E2E 3").getByTestId("settings-audit-line"),
	).toContainText("Bạn sửa lần cuối");

	const target = row(page, "Nhân viên E2E 3");
	await target.getByRole("button", { name: "Sửa Nhân viên E2E 3" }).click();
	await target
		.getByTestId("staff-form")
		.getByLabel("Vai trò")
		.selectOption("manager");
	await target
		.getByTestId("staff-form")
		.getByRole("button", { name: "Lưu" })
		.click();
	await expect(page.getByTestId("staff-roster-status")).toHaveText(
		"Đã lưu thay đổi của Nhân viên E2E 3.",
	);
	expect((await rosterRow("Nhân viên E2E 3"))?.role).toBe("manager");

	await deactivate(page, "Nhân viên E2E 3");
	const stopped = await rosterRow("Nhân viên E2E 3");
	expect(stopped?.status).toBe("inactive");
	expect(stopped?.deactivated_at).not.toBeNull();
	await expect(
		target.getByRole("button", { name: "Tạo mã ghép nối cho Nhân viên E2E 3" }),
	).toHaveCount(0);
	await target
		.getByRole("button", { name: "Mở lại quyền của Nhân viên E2E 3" })
		.click();
	await expect(target).toHaveAttribute("data-status", "invited");
	expect((await rosterRow("Nhân viên E2E 3"))?.status).toBe("invited");

	const cards = page.getByTestId("staff-app-store");
	await expect(cards).toHaveCount(2);
	const { miniAppId } = staffApp();
	for (const [index, code] of [
		[0, "E1"],
		[1, "E2"],
	] as const) {
		const card = cards.nth(index);
		await expect(card.getByTestId("staff-app-title")).toHaveText(
			`Ứng dụng: ${STAFF_APP_TITLE}`,
		);
		await expect(card.getByTestId("staff-app-link")).toHaveText(
			`https://zalo.me/s/${miniAppId}/?store=${code}`,
		);
		await expect(card.getByRole("img")).toHaveAttribute(
			"aria-label",
			`Mã QR mở ứng dụng nhân viên cho Cửa hàng thử ${index + 1}`,
		);
	}
	await expect(page.locator("main img[src], main iframe")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "In mã QR" })).toBeVisible();

	const revenue = page.getByTestId("staff-revenue");
	await expect(
		revenue.getByLabel("Toàn bộ doanh thu của cửa hàng mình"),
	).toBeChecked();
	await revenue.getByLabel("Không xem doanh thu").check();
	await revenue.getByRole("button", { name: "Lưu" }).click();
	await expect(revenue.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	expect(await revenueLevel()).toBe("none");
	await revenue.getByLabel("Toàn bộ doanh thu của cửa hàng mình").check();
	await revenue.getByRole("button", { name: "Lưu" }).click();
	await expect(revenue).toHaveAttribute("data-saved", "all");
	expect(await revenueLevel()).toBe("all");

	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the owner issues a pairing code that the database keeps only as its hash, sees it once, large, with its countdown and a copy button, and a new code replaces it", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const messages = watchConsole(page);
	const refusedId = await insertRosterRow("Ghép nối thử 1", 0);
	await signedIn(page, "owner");
	await openStaff(page);
	const rosterId = await rosterIdOf("Nhân viên E2E 1");

	const code = await issueCode(page, "Nhân viên E2E 1");
	const panel = row(page, "Nhân viên E2E 1").getByTestId("pairing-code");
	await expect(panel).toContainText("Mã ghép nối cho Nhân viên E2E 1");
	await expect(panel.getByRole("timer")).toHaveText(
		/^Còn hiệu lực (10:00|09:[0-5][0-9])$/,
	);
	const issued = await liveCodes(rosterId, code);
	expect(issued.codes).toBe(1);
	expect(issued.matches).toBe(true);
	expect(issued.minutesLeft).toBeGreaterThan(9);
	expect(issued.minutesLeft).toBeLessThanOrEqual(10);
	const copy = panel.getByRole("button", { name: "Chép mã" });
	await expect(copy).toBeFocused();
	await copy.click();
	await expect(panel.getByTestId("pairing-code-copy-status")).toHaveText(
		"Đã chép mã.",
	);
	expect(await clipboardText(page)).toBe(code);
	await checkPage(page);
	await expectCodeKeptNowhere(page, code, messages);
	await panel.getByRole("button", { name: "Đóng" }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.locator("main")).not.toContainText(code);

	const next = await issueCode(page, "Nhân viên E2E 1");
	const replaced = await liveCodes(rosterId, next);
	expect(replaced.codes).toBe(1);
	expect(replaced.matches).toBe(true);
	if (next !== code) {
		expect((await liveCodes(rosterId, code)).matches).toBe(false);
	}
	await expectCodeKeptNowhere(page, next, messages);

	const owner = await created().clientAs("owner");
	clients.push(owner);
	const { error } = await owner.rpc("deactivate_staff", {
		p_roster_id: refusedId,
	});
	expect(error).toBeNull();
	await row(page, "Ghép nối thử 1")
		.getByRole("button", { name: "Tạo mã ghép nối cho Ghép nối thử 1" })
		.click();
	await expect(
		row(page, "Ghép nối thử 1").getByTestId("pairing-refused"),
	).toHaveText(
		"Không tạo được mã: người này đã ngừng, hoặc tài khoản của họ là chủ, người xem hay tài khoản đăng báo cáo.",
	);
	expect((await liveCodes(refusedId, "000000")).codes).toBe(0);
	expectNoConsoleErrors(page, [PAIRING_REFUSAL]);
});

test("the manager limited to store 1 sees, adds and pairs only staff of store 1, is refused a code for a person moved to another store, and has no revenue setting", async ({
	page,
}) => {
	const movedId = await insertRosterRow("Ghép nối thử 2", 0);
	await signedIn(page, "store-manager");
	await openStaff(page);
	await expect(row(page, "Nhân viên E2E 1")).toHaveCount(1);
	await expect(row(page, "Nhân viên E2E 3")).toHaveCount(1);
	await expect(row(page, "Nhân viên E2E 2")).toHaveCount(0);
	await expect(row(page, "Quản lý E2E 1")).toHaveCount(0);
	await page.getByRole("button", { name: "Thêm nhân viên" }).click();
	const stores = page.getByTestId("staff-form-stores");
	await expect(stores.getByRole("checkbox")).toHaveCount(1);
	await expect(stores.getByLabel("Cửa hàng thử 1")).toBeChecked();
	await page
		.getByTestId("staff-form")
		.getByLabel("Tên hiển thị")
		.fill("Nhân viên E2E 4");
	await page
		.getByTestId("staff-form")
		.getByRole("button", { name: "Thêm" })
		.click();
	await expect(page.getByTestId("staff-roster-status")).toHaveText(
		"Đã thêm Nhân viên E2E 4.",
	);
	expect(await rosterRow("Nhân viên E2E 4")).toMatchObject({
		store_ids: [created().storeIds[0]],
		created_by: created().logins["store-manager"].userId,
	});
	const code = await issueCode(page, "Nhân viên E2E 4");
	expect(
		(await liveCodes(await rosterIdOf("Nhân viên E2E 4"), code)).matches,
	).toBe(true);
	await deactivate(page, "Nhân viên E2E 4");
	expect((await rosterRow("Nhân viên E2E 4"))?.status).toBe("inactive");
	await expect(page.getByTestId("pairing-code")).toHaveCount(0);
	expect(
		(await liveCodes(await rosterIdOf("Nhân viên E2E 4"), code)).codes,
	).toBe(0);

	const owner = await created().clientAs("owner");
	clients.push(owner);
	const { error } = await owner.rpc("update_staff", {
		p_roster_id: movedId,
		p_display_name: "Ghép nối thử 2",
		p_role: "staff",
		p_store_ids: [created().storeIds[1]],
	});
	expect(error).toBeNull();
	await row(page, "Ghép nối thử 2")
		.getByRole("button", { name: "Tạo mã ghép nối cho Ghép nối thử 2" })
		.click();
	await expect(
		row(page, "Ghép nối thử 2").getByTestId("pairing-refused"),
	).toHaveText(
		"Không tạo được mã: người này làm ở cửa hàng ngoài phạm vi của bạn.",
	);
	expect((await liveCodes(movedId, "000000")).codes).toBe(0);

	await expect(page.getByTestId("staff-revenue")).toHaveCount(0);
	await expect(page.getByTestId("staff-app-store")).toHaveCount(1);
	await expect(page.getByTestId("staff-app-link")).toHaveText(
		`https://zalo.me/s/${staffApp().miniAppId}/?store=E1`,
	);
	await checkPage(page);
	expectNoConsoleErrors(page, [PAIRING_REFUSAL]);
});

test("the manager with every store deactivates staff of any store and has no revenue setting", async ({
	page,
}) => {
	await signedIn(page, "manager");
	await openStaff(page);
	await expect(row(page, "Quản lý E2E 1")).toHaveCount(1);
	await deactivate(page, "Nhân viên E2E 2");
	expect((await rosterRow("Nhân viên E2E 2"))?.status).toBe("inactive");
	await expect(page.getByTestId("staff-revenue")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

for (const role of ["staff", "viewer"] as const) {
	test(`${role === "staff" ? "staff do" : "the viewer does"} not see Nhân viên in Settings, and the address alone shows the reason and no control`, async ({
		page,
	}) => {
		await signedIn(page, role);
		await settingsNavFrom(page);
		await expect(
			page.getByTestId("tenant-profile").getByTestId("settings-read-only"),
		).toHaveAttribute("data-reason", "ownerOnly");
		await expect(
			settingsNav(page).getByRole("link", { name: "Pháp lý" }),
		).toBeVisible();
		await expect(
			settingsNav(page).getByRole("link", { name: "Nhân viên" }),
		).toHaveCount(0);
		await openSettings(page, "nhan-vien");
		const notice = content(page).getByTestId("settings-read-only");
		await expect(notice).toHaveAttribute("data-reason", "role");
		await expect(notice).toHaveText(
			"Trang Nhân viên chỉ dành cho chủ và quản lý.",
		);
		await expect(content(page).getByTestId("staff-roster")).toHaveCount(0);
		await expect(
			content(page).locator("button, input, select, textarea"),
		).toHaveCount(0);
		await page.setViewportSize({ width: PHONE_WIDTH, height: SCREEN_HEIGHT });
		await expectNoSeriousAxeViolations(page);
		await page.setViewportSize({ width: DESKTOP_WIDTH, height: SCREEN_HEIGHT });
		await expectNoSeriousAxeViolations(page);
		expectNoConsoleErrors(page);
	});
}

type Login = SettingsRole | "publisher" | "anon";

type Outcome = "saved" | "42501" | "22023";

const LOGINS: readonly Login[] = [...SETTINGS_ROLES, "publisher", "anon"];

async function clientOf(login: Login): Promise<SupabaseClient> {
	if (login === "anon") return anonymousClient();
	const settings = created();
	const client =
		login === "publisher"
			? await (async () => {
					const publisher = await settings.addPublisher();
					const made = anonymousClient();
					const { error } = await made.auth.signInWithPassword({
						email: publisher.email,
						password: publisher.password,
					});
					if (error) throw error;
					return made;
				})()
			: await settings.clientAs(login);
	clients.push(client);
	return client;
}

function outcomeOf(reply: {
	error: { code?: string } | null;
}): Outcome | string {
	return reply.error === null ? "saved" : (reply.error.code ?? "unknown");
}

test("through PostgREST, every login's roster, pairing code and revenue writes are saved or refused as the access helpers say, and reads follow the store scope", async () => {
	const settings = created();
	const [store1, store2] = settings.storeIds;
	const store1Row = staffApp().rosterIds["Nhân viên E2E 1"];
	const store2Row = staffApp().rosterIds["Nhân viên E2E 2"];
	if (store1Row === undefined || store2Row === undefined) {
		throw new Error("no fixture rows");
	}
	const expected: Readonly<Record<Login, readonly Outcome[]>> = {
		owner: [
			"saved",
			"saved",
			"saved",
			"22023",
			"saved",
			"saved",
			"saved",
			"saved",
			"22023",
		],
		manager: [
			"saved",
			"saved",
			"saved",
			"22023",
			"saved",
			"saved",
			"42501",
			"saved",
			"22023",
		],
		"store-manager": [
			"saved",
			"42501",
			"42501",
			"22023",
			"42501",
			"saved",
			"42501",
			"saved",
			"42501",
		],
		staff: Array<Outcome>(9).fill("42501"),
		viewer: Array<Outcome>(9).fill("42501"),
		publisher: Array<Outcome>(9).fill("42501"),
		anon: Array<Outcome>(9).fill("42501"),
	};
	for (const login of LOGINS) {
		const client = await clientOf(login);
		const target = await insertRosterRow(`Ngừng thử ${login}`, 0);
		const add = (storeIds: string[] | null, role = "staff") =>
			client.rpc("add_staff", {
				p_tenant_id: settings.tenantId,
				p_display_name: `Thêm thử ${login}`,
				p_role: role,
				p_store_ids: storeIds,
			});
		const issued = await client.rpc("issue_pairing_code", {
			p_roster_id: store1Row,
		});
		const outcomes = [
			outcomeOf(await add([store1])),
			outcomeOf(await add([store2])),
			outcomeOf(await add(null)),
			outcomeOf(await add([store1], "owner")),
			outcomeOf(
				await client.rpc("update_staff", {
					p_roster_id: store2Row,
					p_display_name: "Nhân viên E2E 2",
					p_role: "staff",
					p_store_ids: [store2],
				}),
			),
			outcomeOf(await client.rpc("deactivate_staff", { p_roster_id: target })),
			outcomeOf(
				await client.rpc("set_staff_revenue_visibility", {
					p_tenant_id: settings.tenantId,
					p_visibility: "all",
				}),
			),
			outcomeOf(issued),
			outcomeOf(
				await client.rpc("issue_pairing_code", { p_roster_id: store2Row }),
			),
		];
		expect(outcomes, login).toEqual(expected[login]);
		if (issued.error === null) {
			expect(issued.data, login).toMatch(SIX_DIGITS);
			const held = await liveCodes(store1Row, String(issued.data));
			expect(held, login).toMatchObject({ codes: 1, matches: true });
		}
		const stopped = await withSql(
			async (sql) =>
				(
					await sql<{ status: string }[]>`
						select status from public.staff_roster where id = ${target}
					`
				)[0]?.status,
		);
		expect(stopped, login).toBe(
			expected[login][5] === "saved" ? "inactive" : "invited",
		);
		if (login === "anon") continue;
		const membership = (await createSupabaseSettingsSource(client).membership(
			settings.tenantId,
		)) as Membership | null;
		const allowed = (outcome: Outcome | undefined) => outcome === "saved";
		expect(staffRowAccess(membership, [store1]).canWrite, login).toBe(
			allowed(expected[login][0]),
		);
		expect(staffRowAccess(membership, [store1]).canWrite, login).toBe(
			allowed(expected[login][7]),
		);
		expect(staffRowAccess(membership, [store2]).canWrite, login).toBe(
			allowed(expected[login][1]),
		);
		expect(staffRowAccess(membership, null).canWrite, login).toBe(
			allowed(expected[login][2]),
		);
		expect(settingsAccess("staffRevenue", membership).canWrite, login).toBe(
			allowed(expected[login][6]),
		);
		expect(staffPageAccess(membership).canWrite, login).toBe(
			allowed(expected[login][0]),
		);
		const { data, error } = await client
			.from("staff_roster")
			.select("display_name,store_ids")
			.eq("tenant_id", settings.tenantId);
		expect(error, login).toBeNull();
		const visible = (data ?? []) as {
			display_name: string;
			store_ids: string[] | null;
		}[];
		if (login === "staff" || login === "viewer" || login === "publisher") {
			expect(visible, login).toEqual([]);
			continue;
		}
		const scoped = login === "store-manager";
		expect(
			visible.every(
				(entry) =>
					!scoped ||
					entry.store_ids?.every((storeId) => storeId === store1) === true,
			),
			login,
		).toBe(true);
		expect(
			visible.some((entry) => entry.display_name === "Quản lý E2E 1"),
			login,
		).toBe(!scoped);
	}
	const bound = await insertRosterRow("Gắn người xem thử", 0);
	await withSql(
		(sql) => sql`
			update public.staff_roster set user_id = ${settings.logins.viewer.userId} where id = ${bound}
		`,
	);
	const owner = await clientOf("owner");
	expect(
		outcomeOf(await owner.rpc("issue_pairing_code", { p_roster_id: bound })),
	).toBe("22023");
	const anon = anonymousClient();
	const { error } = await anon
		.from("staff_roster")
		.select("id")
		.eq("tenant_id", settings.tenantId);
	expect(error?.code).toBe("42501");
	expect(await revenueLevel()).toBe("all");
});

test("a person shows as paired only while a Zalo identity of their login remains, so a withdrawn consent reads as not paired on an active row", async ({
	page,
}) => {
	const settings = created();
	const hex = settings.slug.slice(FIXTURE_SLUG_PREFIX.length);
	const zaloUserId = `e2e-zalo-user-${hex}`;
	const pairedName = "Đã ghép nối thử";
	const rosterId = await withSql(async (sql) => {
		const [made] = await sql<{ id: string }[]>`
			insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at, created_by)
			values (${settings.tenantId}, ${pairedName}, 'staff', ${[settings.storeIds[0]]}::uuid[], 'active',
				${settings.logins.staff.userId}, now(), ${settings.logins.owner.userId})
			returning id
		`;
		await sql`
			insert into public.zalo_identities (tenant_id, zalo_app_id, zalo_user_id, user_id)
			values (${settings.tenantId}, ${staffApp().zaloAppId}, ${zaloUserId}, ${settings.logins.staff.userId})
		`;
		if (made === undefined) throw new Error("no paired row");
		return made.id;
	});
	await signedIn(page, "owner");
	await openStaff(page);
	const paired = row(page, pairedName);
	await expect(paired.getByTestId("staff-status")).toHaveText("Đang hoạt động");
	await expect(paired.getByTestId("staff-pairing")).toHaveText(
		/^Đã ghép nối ngày \d{2}\/\d{2}\/\d{4}$/,
	);
	await expect(page.locator("main")).not.toContainText(zaloUserId);

	await withSql(
		(sql) => sql`
			delete from public.zalo_identities
			where tenant_id = ${settings.tenantId} and user_id = ${settings.logins.staff.userId}
		`,
	);
	await openStaff(page);
	await expect(paired).toHaveAttribute("data-status", "active");
	await expect(paired.getByTestId("staff-status")).toHaveText("Đang hoạt động");
	await expect(paired.getByTestId("staff-pairing")).toHaveText("Chưa ghép nối");
	const code = await issueCode(page, pairedName);
	expect((await liveCodes(rosterId, code)).matches).toBe(true);
	expectNoConsoleErrors(page);
});

test("teardown leaves no fixture tenant, roster row, pairing code, Zalo row or login, and every real tenant's rows and logins are as they were", async () => {
	const settings = created();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settings.teardown();
	await withSql(async (sql) => {
		const hex = settings.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{
				tenants: number;
				roster: number;
				codes: number;
				apps: number;
				identities: number;
				users: number;
			}[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settings.tenantId}) as tenants,
				(select count(*)::int from public.staff_roster where tenant_id = ${settings.tenantId}) as roster,
				(select count(*)::int from app.staff_pairing_codes where tenant_id = ${settings.tenantId}) as codes,
				(select count(*)::int from public.mini_apps where tenant_id = ${settings.tenantId})
					+ (select count(*)::int from public.zalo_apps where tenant_id = ${settings.tenantId}) as apps,
				(select count(*)::int from public.zalo_identities where tenant_id = ${settings.tenantId}) as identities,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({
			tenants: 0,
			roster: 0,
			codes: 0,
			apps: 0,
			identities: 0,
			users: 0,
		});
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
