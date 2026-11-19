import { expect, type Locator, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type AnnouncementsFixture,
	prepareAnnouncementsFixture,
	ROSTER_NAMES,
} from "../support/announcements-fixture";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
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

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const TITLES = {
	both: "Lịch trực cuối tuần E2E",
	owner: "Họp đầu tuần E2E",
	storeOne: "Ca tối cửa hàng 1 E2E",
} as const;
const LINK_BODY =
	"Xem lịch tại https://example.com/lich hoặc www.example.vn trước thứ Bảy.";

let fixture: SettingsFixture | undefined;
let extra: AnnouncementsFixture | undefined;
let before: RealTenantsSnapshot | undefined;
let bothId: string | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function both(): string {
	if (bothId === undefined)
		throw new Error("the first announcement is missing");
	return bothId;
}

type Sql = ReturnType<typeof openFixtureDatabase>;

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

function todayHere(): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(
		new Date(),
	);
}

function plusDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function endOfDayHere(date: string): string {
	return `${plusDays(date, 1)}T00:00:00+07:00`;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	extra = await prepareAnnouncementsFixture(fixture);
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	await fixture?.teardown();
	await extra?.teardown();
});

async function clientAs(
	role: SettingsRole | "publisher",
): Promise<SupabaseClient> {
	const made =
		role === "publisher"
			? await (async () => {
					const login = await settings().addPublisher();
					const client = anonymousClient();
					const { error } = await client.auth.signInWithPassword({
						email: login.email,
						password: login.password,
					});
					if (error) throw error;
					return client;
				})()
			: await settings().clientAs(role);
	clients.push(made);
	return made;
}

async function code(
	request: PromiseLike<{ error: { code?: string } | null }>,
): Promise<string> {
	const { error } = await request;
	return error === null ? "saved" : (error.code ?? "error");
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

async function openAnnouncements(page: Page): Promise<Locator> {
	await page.goto("/#/van-hanh/thong-bao");
	await expect(page.getByTestId("operations-page")).toHaveAttribute(
		"data-page",
		"thong-bao",
	);
	const list = page.getByTestId("announcement-list");
	await expect(list).toBeVisible({ timeout: 30_000 });
	await expect(list).not.toHaveAttribute("data-state", /loading|error/, {
		timeout: 30_000,
	});
	return list;
}

function announcement(page: Page, title: string): Locator {
	return page.getByTestId("announcement").filter({
		has: page.getByRole("heading", { level: 3, name: title, exact: true }),
	});
}

async function readerNames(scope: Locator): Promise<string[]> {
	return (await scope.getByTestId("announcement-reader").allTextContents())
		.map((text) => text.split(" · ")[0] ?? "")
		.sort();
}

interface RpcCall {
	readonly name: string;
	readonly body: Record<string, unknown>;
}

function watchRpcs(page: Page): RpcCall[] {
	const calls: RpcCall[] = [];
	page.on("request", (request) => {
		const name = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(request.url())?.[1];
		if (name === undefined) return;
		calls.push({
			name,
			body: (request.postDataJSON() ?? {}) as Record<string, unknown>,
		});
	});
	return calls;
}

async function checkFromTop(page: Page): Promise<void> {
	await page.evaluate(() =>
		window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
	);
	await checkPage(page);
}

test("through PostgREST, the owner publishes to both stores, a store-2 staff member reads it, and each login gets the rate and the readers of its own stores only", async () => {
	const [storeOne, storeTwo] = settings().storeIds;
	const owner = await clientAs("owner");
	const published = await owner.rpc("publish_announcement", {
		p_tenant_id: settings().tenantId,
		p_title: TITLES.both,
		p_body: LINK_BODY,
		p_store_ids: [storeOne, storeTwo],
	});
	expect(published.error).toBeNull();
	const made = published.data as {
		announcement_id: string;
		recipients: number;
	};
	expect(made.recipients).toBe(4);
	bothId = made.announcement_id;
	const staff = await clientAs("staff");
	expect(
		await code(
			staff.rpc("mark_announcement_read", { p_announcement_id: both() }),
		),
	).toBe("saved");
	const rates: Record<string, unknown> = {};
	const names: Record<string, string[]> = {};
	for (const login of ["owner", "manager", "store-manager"] as const) {
		const client = login === "owner" ? owner : await clientAs(login);
		const rate = await client.rpc("announcement_read_rate", {
			p_announcement_id: both(),
		});
		expect(rate.error).toBeNull();
		const [row] = rate.data as { recipients: number; readers: number }[];
		rates[login] = { recipients: row?.recipients, readers: row?.readers };
		const readers = await client.rpc("announcement_readers", {
			p_announcement_id: both(),
		});
		expect(readers.error).toBeNull();
		names[login] = (readers.data as { display_name: string | null }[])
			.map((reader) => reader.display_name ?? "")
			.sort();
	}
	expect(rates).toEqual({
		owner: { recipients: 4, readers: 1 },
		manager: { recipients: 4, readers: 1 },
		"store-manager": { recipients: 3, readers: 0 },
	});
	expect(names.owner).toEqual(
		[
			ROSTER_NAMES.manager,
			ROSTER_NAMES.storeManager,
			ROSTER_NAMES.storeOneStaff,
			ROSTER_NAMES.storeTwoStaff,
		].sort(),
	);
	expect(names["store-manager"]).toHaveLength(3);
	expect(names["store-manager"]).toContain(ROSTER_NAMES.storeOneStaff);
	expect(names["store-manager"]).not.toContain(ROSTER_NAMES.storeTwoStaff);

	const other = await owner.rpc("announcement_feed_page", {
		p_tenant_id: settings().tenantId,
		p_limit: 1,
	});
	expect(other.error).toBeNull();
	const [firstRow] = other.data as {
		announcement_id: string;
		tenant_id: string;
	}[];
	expect(firstRow).toMatchObject({
		announcement_id: both(),
		tenant_id: settings().tenantId,
	});
	const counts = await owner.rpc("announcement_read_counts", {
		p_announcement_ids: [both()],
	});
	expect(counts.error).toBeNull();
	expect(counts.data).toMatchObject([
		{ announcement_id: both(), recipients: 4, readers: 1 },
	]);

	const limited = await clientAs("store-manager");
	expect(
		await code(
			limited.rpc("publish_announcement", {
				p_tenant_id: settings().tenantId,
				p_title: "Không được",
				p_body: "Gửi cả hai cửa hàng",
				p_store_ids: [storeOne, storeTwo],
			}),
		),
	).toBe("42501");
	expect(
		await code(
			limited.rpc("set_announcement_pin", {
				p_announcement_id: both(),
				p_pinned_until: null,
			}),
		),
	).toBe("42501");
	for (const login of ["staff", "viewer", "publisher"] as const) {
		const client = login === "staff" ? staff : await clientAs(login);
		expect(
			await code(
				client.rpc("publish_announcement", {
					p_tenant_id: settings().tenantId,
					p_title: "Không được",
					p_body: "Không được",
					p_store_ids: [storeOne],
				}),
			),
			login,
		).toBe("42501");
		expect(
			await code(
				client.rpc("announcement_read_rate", { p_announcement_id: both() }),
			),
			login,
		).toBe("42501");
	}
});

test("the owner sees the read rate and who has not read, publishes to every store with a pin, unpins and pins, and a link stays text", async ({
	page,
}) => {
	const rpcs = watchRpcs(page);
	await signedIn(page, "owner");
	const list = await openAnnouncements(page);
	await expect(page.getByTestId("range-picker")).toHaveCount(0);
	const first = announcement(page, TITLES.both);
	await expect(first.getByTestId("announcement-text")).toHaveText(LINK_BODY);
	await expect(list.locator("a")).toHaveCount(0);
	await expect(first.getByTestId("announcement-rate-value")).toHaveText(
		/^1\/4 người \(25(,0)?\s?%\)$/,
		{ timeout: 30_000 },
	);
	await first
		.getByRole("button", { name: `Xem ai chưa đọc: ${TITLES.both}` })
		.click();
	const unread = first.getByTestId("announcement-unread");
	await expect(unread).toContainText("Chưa đọc (3)");
	expect(await readerNames(unread)).toEqual(
		[
			ROSTER_NAMES.manager,
			ROSTER_NAMES.storeManager,
			ROSTER_NAMES.storeOneStaff,
		].sort(),
	);
	const read = first.getByTestId("announcement-read");
	await expect(read).toContainText("Đã đọc (1)");
	await expect(read.getByTestId("announcement-reader")).toContainText(
		`${ROSTER_NAMES.storeTwoStaff} · Nhân viên · đọc lúc`,
	);

	const pinDate = plusDays(todayHere(), 3);
	const compose = page.getByTestId("announcement-compose");
	await compose.getByLabel("Tiêu đề").fill(TITLES.owner);
	await compose
		.getByLabel("Nội dung")
		.fill("Sáng thứ Hai 8 giờ họp ở cửa hàng 1.\nXem www.example.vn");
	await expect(
		compose.getByLabel("Mọi cửa hàng, kể cả cửa hàng mở sau này"),
	).toBeChecked();
	await compose.getByLabel("Ghim đến hết ngày").fill(pinDate);
	await compose.getByRole("button", { name: "Đăng thông báo" }).click();
	await expect(page.getByTestId("announcement-publish-status")).toHaveText(
		"Đã đăng tới 4 người.",
	);
	await expect(compose.getByLabel("Tiêu đề")).toHaveValue("");
	const ownerItem = announcement(page, TITLES.owner);
	await expect(ownerItem).toHaveAttribute("data-pinned", "true");
	await expect(page.getByTestId("announcement").first()).toHaveAttribute(
		"data-pinned",
		"true",
	);
	const pinnedUntil = async (title: string) =>
		withSql(async (sql) => {
			const [row] = await sql<
				{ store_ids: string[] | null; pinned: boolean; until: string | null }[]
			>`
				select store_ids, pinned_until is not null as pinned,
					to_char(pinned_until at time zone ${TIME_ZONE}, 'YYYY-MM-DD"T"HH24:MI:SS') as until
				from public.announcements
				where tenant_id = ${settings().tenantId} and title = ${title}
			`;
			return row;
		});
	expect(await pinnedUntil(TITLES.owner)).toEqual({
		store_ids: null,
		pinned: true,
		until: endOfDayHere(pinDate).slice(0, 19),
	});

	await ownerItem
		.getByRole("button", { name: `Bỏ ghim: ${TITLES.owner}` })
		.click();
	await expect(page.getByTestId("announcement-pin-status")).toHaveText(
		"Đã bỏ ghim thông báo.",
	);
	await expect(ownerItem).toHaveAttribute("data-pinned", "false");
	expect((await pinnedUntil(TITLES.owner))?.pinned).toBe(false);
	await first.getByRole("button", { name: `Ghim: ${TITLES.both}` }).click();
	await expect(page.getByTestId("announcement-pin-status")).toHaveText(
		"Đã ghim thông báo.",
	);
	await expect(first).toHaveAttribute("data-pinned", "true");
	expect(await pinnedUntil(TITLES.both)).toEqual({
		store_ids: [...settings().storeIds].sort(),
		pinned: true,
		until: endOfDayHere(plusDays(todayHere(), 6)).slice(0, 19),
	});
	await expect(list.locator("a")).toHaveCount(0);
	const names = new Set(rpcs.map((call) => call.name));
	expect(names.has("announcement_feed")).toBe(false);
	expect(names.has("announcement_read_rate")).toBe(false);
	const feeds = rpcs.filter((call) => call.name === "announcement_feed_page");
	expect(feeds.length).toBeGreaterThan(0);
	for (const feed of feeds) {
		expect(feed.body).toMatchObject({
			p_tenant_id: settings().tenantId,
			p_include_expired: true,
			p_after_id: null,
		});
	}
	const counted = rpcs
		.filter((call) => call.name === "announcement_read_counts")
		.map((call) => (call.body.p_announcement_ids as string[]).length);
	expect(counted.length).toBeGreaterThan(0);
	expect(Math.max(...counted)).toBeGreaterThanOrEqual(2);
	await checkFromTop(page);
	expectNoConsoleErrors(page);
});

test("the manager limited to store 1 publishes to store 1 only, counts only the staff of store 1, and cannot pin an announcement beyond it", async ({
	page,
}) => {
	const [storeOne, storeTwo] = settings().storeIds;
	await signedIn(page, "store-manager");
	await openAnnouncements(page);
	const compose = page.getByTestId("announcement-compose");
	await expect(
		compose.getByLabel("Mọi cửa hàng, kể cả cửa hàng mở sau này"),
	).toHaveCount(0);
	await expect(compose.locator(`[data-store-id="${storeOne}"]`)).toBeChecked();
	await expect(compose.locator(`[data-store-id="${storeTwo}"]`)).toHaveCount(0);
	await expect(page.getByTestId("announcement-scope-note")).toBeVisible();

	const first = announcement(page, TITLES.both);
	await expect(first.getByTestId("announcement-rate-value")).toHaveText(
		/^0\/3 người \(0(,0)?\s?%\)$/,
		{ timeout: 30_000 },
	);
	await expect(first.getByTestId("announcement-not-managed")).toBeVisible();
	await expect(first.getByTestId("announcement-pin")).toHaveCount(0);
	await expect(first.getByTestId("announcement-unpin")).toHaveCount(0);
	await first
		.getByRole("button", { name: `Xem ai chưa đọc: ${TITLES.both}` })
		.click();
	const unread = first.getByTestId("announcement-unread");
	await expect(unread).toContainText("Chưa đọc (3)");
	await expect(unread).toContainText(ROSTER_NAMES.storeOneStaff);
	await expect(first.getByTestId("announcement-readers")).not.toContainText(
		ROSTER_NAMES.storeTwoStaff,
	);
	await expect(first.getByTestId("announcement-read")).toContainText(
		"Đã đọc (0)",
	);

	await compose.getByLabel("Tiêu đề").fill(TITLES.storeOne);
	await compose.getByLabel("Nội dung").fill("Ca tối nay thêm một người.");
	await compose.getByRole("button", { name: "Đăng thông báo" }).click();
	await expect(page.getByTestId("announcement-publish-status")).toHaveText(
		"Đã đăng tới 2 người.",
	);
	const own = announcement(page, TITLES.storeOne);
	await expect(own.getByTestId("announcement-pin")).toBeVisible();
	await expect(own.getByTestId("announcement-rate-value")).toHaveText(
		/^0\/2 người/,
	);
	const rows = await withSql(
		(sql) => sql<{ store_ids: string[] | null; recipients: number }[]>`
			select a.store_ids,
				(select count(*)::int from public.announcement_recipients r where r.announcement_id = a.id) as recipients
			from public.announcements a
			where a.tenant_id = ${settings().tenantId} and a.title = ${TITLES.storeOne}
		`,
	);
	expect(rows).toEqual([{ store_ids: [storeOne], recipients: 2 }]);
	await checkFromTop(page);
	expectNoConsoleErrors(page);
});

test("staff and the viewer get the reason and no announcement", async ({
	browser,
}) => {
	for (const role of ["staff", "viewer"] as const) {
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await signedIn(page, role);
			await page.goto("/#/van-hanh/thong-bao");
			await expect(page.getByTestId("operations-read-only")).toHaveText(
				"Trang Vận hành chỉ dành cho chủ và quản lý.",
			);
			await expect(page.getByTestId("announcement-compose")).toHaveCount(0);
			await expect(page.getByTestId("announcement-list")).toHaveCount(0);
			await checkFromTop(page);
			expectNoConsoleErrors(page);
		} finally {
			await context.close();
		}
	}
});

test("teardown leaves no fixture tenant, announcement or login and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await extra?.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{ tenants: number; announcements: number; users: number; extra: number }[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.announcements where tenant_id = ${settingsFixture.tenantId}) as announcements,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users,
				(select count(*)::int from auth.users where id = ${extra?.storeOneStaffId ?? settingsFixture.tenantId}) as extra
		`;
		expect(left).toEqual({ tenants: 0, announcements: 0, users: 0, extra: 0 });
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
