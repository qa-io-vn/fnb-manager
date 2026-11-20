import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsAccess } from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import {
	type ExpectedConsoleError,
	expectNoConsoleErrors,
	watchConsoleErrors,
} from "../support/reports";
import {
	createRewardsFixture,
	MAPPED_DISCOUNT_NAME,
	MAPPED_REWARD_KEY,
	type RewardsFixture,
	retireActiveRewards,
} from "../support/rewards-fixture";
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

const STORE_REWARD = "Ly trà sữa thành viên E2E";
const CHAIN_REWARD = "Giảm 15% cả chuỗi E2E";
const REFUSED_ACTIVATION: ExpectedConsoleError = {
	text: /status of 400/,
	url: /\/rest\/v1\/coupons/,
	atMost: 1,
};

let fixture: SettingsFixture | undefined;
let rewards: RewardsFixture | undefined;
let before: RealTenantsSnapshot | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function rewardsFixture(): RewardsFixture {
	if (rewards === undefined) throw new Error("the rewards were not created");
	return rewards;
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	rewards = await createRewardsFixture(fixture);
});

async function signOutAll(): Promise<void> {
	for (const client of clients.splice(0)) await client.auth.signOut();
}

test.afterAll(async () => {
	await signOutAll();
	if (fixture !== undefined) await retireActiveRewards(fixture);
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

interface RewardRow {
	readonly name: string;
	readonly status: string;
	readonly active: boolean;
	readonly reward_percent: string | null;
	readonly approved_by: string | null;
	readonly store_ids: string[] | null;
}

async function rewardRow(name: string): Promise<RewardRow | undefined> {
	const [row] = await withSql(
		(sql) => sql<RewardRow[]>`
			select name, status::text, active, reward_percent::text, approved_by, store_ids
			from public.coupons
			where tenant_id = ${settings().tenantId} and name = ${name}
		`,
	);
	return row;
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

async function openRewards(page: Page): Promise<void> {
	await openSettings(page, "khach-hang-than-thiet", "tab=uu-dai");
	await expectCurrentSettingsPage(page, "Khách hàng thân thiết");
	await expect(page.getByTestId("rewards-tab")).toBeVisible();
	await expect(
		page.getByTestId("loyalty-tabs").getByRole("link", { name: "Ưu đãi" }),
	).toHaveAttribute("aria-current", "page");
}

function form(page: Page): Locator {
	return page.getByTestId("reward-form");
}

async function retype(scope: Locator, label: string, text: string) {
	const input = scope.getByLabel(label, { exact: true });
	await input.fill(text);
	await input.blur();
}

async function chooseReward(page: Page, name: string): Promise<void> {
	await page.getByTestId("reward-row").filter({ hasText: name }).click();
	await expect(page.getByTestId("reward-form-title")).toContainText(name);
}

async function act(page: Page, name: string): Promise<void> {
	await page
		.getByTestId("reward-actions")
		.getByRole("button", { name, exact: true })
		.click();
}

test("through PostgREST, rewards are drafted by the owner and managers of every store, approved by the owner only, and an over-cap or unmapped reward gives 22023", async () => {
	const [storeOne] = settings().storeIds;
	const programmeId = rewardsFixture().programmeId;
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
	const ownerClient = await clientAs("owner");
	const results: Record<string, Record<string, string>> = {};
	for (const login of logins) {
		const client = login === "owner" ? ownerClient : await clientAs(login);
		const drafted = await outcome(
			client
				.from("coupons")
				.insert({
					tenant_id: settings().tenantId,
					programme_id: programmeId,
					reward_key: `quyen-${login}`,
					name: `Quyền ${login}`,
					reward_kind: "free_upgrade",
					cost_stamps: 3,
				})
				.select("id"),
		);
		const { data: target } = await ownerClient
			.from("coupons")
			.insert({
				tenant_id: settings().tenantId,
				programme_id: programmeId,
				reward_key: `duyet-${login}`,
				name: `Duyệt ${login}`,
				reward_kind: "free_upgrade",
				cost_stamps: 3,
			})
			.select("id")
			.single();
		const approved = await outcome(
			client
				.from("coupons")
				.update({ status: "approved" })
				.eq("id", (target as { id: string }).id)
				.select("id"),
		);
		const { data: read } = await client
			.from("coupons")
			.select("id")
			.eq("tenant_id", settings().tenantId);
		results[login] = {
			drafted,
			approved,
			reads: (read ?? []).length > 0 ? "rewards" : "-",
		};
		expect(drafted === "saved", login).toBe(
			settingsAccess("rewards", members[login]).canWrite,
		);
		expect(approved === "saved", login).toBe(
			settingsAccess("rewardApproval", members[login]).canWrite,
		);
	}
	expect(results).toEqual({
		owner: { drafted: "saved", approved: "saved", reads: "rewards" },
		manager: { drafted: "saved", approved: "42501", reads: "rewards" },
		"store-manager": { drafted: "42501", approved: "none", reads: "rewards" },
		staff: { drafted: "42501", approved: "none", reads: "rewards" },
		viewer: { drafted: "42501", approved: "none", reads: "rewards" },
		publisher: { drafted: "42501", approved: "none", reads: "-" },
	});
	const overCap = await ownerClient
		.from("coupons")
		.insert({
			tenant_id: settings().tenantId,
			programme_id: programmeId,
			reward_key: "qua-muc",
			name: "Quá mức",
			reward_kind: "percent_off",
			reward_percent: 60,
			cost_stamps: 3,
		})
		.select("id");
	expect(overCap.error?.code).toBe("22023");
	expect(overCap.error?.message).toContain("at most 50 % off");
	const unmapped = await ownerClient
		.from("coupons")
		.insert({
			tenant_id: settings().tenantId,
			programme_id: programmeId,
			reward_key: "chua-gan",
			name: "Chưa gắn",
			reward_kind: "free_upgrade",
			cost_stamps: 3,
			status: "active",
		})
		.select("id");
	expect(unmapped.error?.code).toBe("22023");
	await withSql(
		(sql) => sql`
			delete from public.coupons
			where tenant_id = ${settings().tenantId}
				and (reward_key like 'quyen-%' or reward_key like 'duyet-%')
		`,
	);
	await signOutAll();
});

test("the owner drafts a reward, cannot save it over the cap, approves it and activates it where its store is mapped, and is told why a chain-wide reward cannot be activated", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openRewards(page);
	await expect(page.getByTestId("rewards-empty")).toContainText(
		"Chưa có ưu đãi nào.",
	);
	await page.getByTestId("reward-create").click();
	const editor = form(page);
	await expect(editor).toHaveAttribute("data-new", "true");
	const kinds = await editor
		.getByLabel("Loại phần thưởng", { exact: true })
		.locator("option")
		.allTextContents();
	expect(kinds).toEqual([
		"Tặng món",
		"Giảm theo phần trăm",
		"Giảm một số tiền",
		"Lên size hoặc thêm topping",
	]);
	await retype(editor, "Tên ưu đãi", STORE_REWARD);
	await expect(editor.getByLabel("Mã ưu đãi", { exact: true })).toHaveValue(
		"ly-tra-sua-thanh-vien-e2e",
	);
	await retype(editor, "Mã ưu đãi", MAPPED_REWARD_KEY);
	await editor
		.getByLabel("Loại phần thưởng", { exact: true })
		.selectOption({ label: "Giảm theo phần trăm" });
	await retype(editor, "Mức giảm", "60");
	const percentField = editor
		.getByTestId("settings-field")
		.filter({ has: page.getByLabel("Mức giảm", { exact: true }) });
	await expect(percentField.getByTestId("settings-field-error")).toHaveText(
		"Vượt mức giảm tối đa 50% giá được giảm (Thông tư 39/2025/TT-BCT, Điều 4). Ưu đãi này không lưu được.",
	);
	await retype(editor, "Số dấu", "5");
	await editor.getByRole("radio", { name: "Chọn cửa hàng" }).check();
	await editor.getByRole("checkbox", { name: "Cửa hàng thử 1" }).check();
	await expect(page.getByTestId("reward-rails-summary")).toHaveText(
		"Mọi cửa hàng áp dụng đã sẵn sàng.",
	);
	await expect(page.getByTestId("reward-rails")).toContainText(
		`Chiết khấu: ${MAPPED_DISCOUNT_NAME}`,
	);
	const save = page.getByTestId("settings-save");
	await expect(save).toHaveAttribute("aria-disabled", "true");
	await save.click({ force: true });
	await expect(page.getByTestId("settings-save-bar")).toContainText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	expect(await rewardRow(STORE_REWARD)).toBeUndefined();
	await retype(editor, "Mức giảm", "20");
	await save.click();
	await expect(page.getByTestId("settings-save-bar")).toContainText("Đã lưu");
	await expect(page.getByTestId("reward-status-panel")).toHaveAttribute(
		"data-status",
		"draft",
	);
	expect(await rewardRow(STORE_REWARD)).toMatchObject({
		status: "draft",
		reward_percent: "20.00",
		approved_by: null,
		store_ids: [rewardsFixture().storeOne],
	});
	await expect(page.getByTestId("reward-approval")).toHaveText(
		"Chờ chủ quán duyệt.",
	);
	await act(page, "Duyệt");
	await expect(page.getByTestId("reward-status-panel")).toHaveAttribute(
		"data-status",
		"approved",
	);
	await expect(page.getByTestId("reward-approval")).toContainText(
		"Bạn đã duyệt lúc",
	);
	await act(page, "Kích hoạt");
	await expect(page.getByTestId("reward-status-panel")).toHaveAttribute(
		"data-status",
		"active",
	);
	expect(await rewardRow(STORE_REWARD)).toMatchObject({
		status: "active",
		active: true,
		approved_by: settings().logins.owner.userId,
	});
	await page.getByTestId("reward-create").click();
	await retype(editor, "Tên ưu đãi", CHAIN_REWARD);
	await editor
		.getByLabel("Loại phần thưởng", { exact: true })
		.selectOption({ label: "Giảm theo phần trăm" });
	await retype(editor, "Mức giảm", "15");
	await retype(editor, "Số điểm", "200");
	await expect(page.getByTestId("reward-rails-summary")).toHaveText(
		"2 cửa hàng chưa sẵn sàng nên chưa kích hoạt được.",
	);
	await save.click();
	await expect(page.getByTestId("reward-status-panel")).toHaveAttribute(
		"data-status",
		"draft",
	);
	await act(page, "Duyệt");
	await expect(page.getByTestId("reward-activation-blocked")).toContainText(
		"Chưa kích hoạt được: Cửa hàng thử 1, Cửa hàng thử 2 chưa sẵn sàng.",
	);
	await act(page, "Kích hoạt");
	await expect(page.getByTestId("reward-status-refusal")).toHaveText(
		"Chưa kích hoạt được: có cửa hàng áp dụng chưa có kênh ưu đãi đang dùng.",
	);
	expect(await rewardRow(CHAIN_REWARD)).toMatchObject({ status: "approved" });
	await checkPage(page);
	expectNoConsoleErrors(page, [REFUSED_ACTIVATION]);
});

test("a manager of every store is never offered the approval, and changing the terms of the active reward sends it back to the owner as a draft", async ({
	page,
}) => {
	await signedIn(page, "manager");
	await openRewards(page);
	await chooseReward(page, STORE_REWARD);
	const panel = page.getByTestId("reward-status-panel");
	await expect(panel).toHaveAttribute("data-status", "active");
	await expect(page.getByTestId("reward-owner-approves")).toHaveText(
		"Chỉ chủ quán quản lý mọi cửa hàng mới duyệt được ưu đãi. Quản lý soạn bản nháp và kích hoạt ưu đãi đã duyệt.",
	);
	await expect(
		page.getByTestId("reward-actions").getByRole("button"),
	).toHaveText(["Tạm ngưng", "Ngừng hẳn"]);
	await retype(form(page), "Mức giảm", "15");
	await expect(page.getByTestId("reward-back-to-draft")).toBeVisible();
	await page.getByTestId("settings-save").click();
	await expect(panel).toHaveAttribute("data-status", "draft");
	await expect(page.getByTestId("reward-approval")).toHaveText(
		"Chờ chủ quán duyệt.",
	);
	await expect(
		page.getByTestId("reward-actions").getByRole("button"),
	).toHaveText(["Ngừng hẳn"]);
	expect(await rewardRow(STORE_REWARD)).toMatchObject({
		status: "draft",
		active: false,
		reward_percent: "15.00",
		approved_by: null,
	});
	expectNoConsoleErrors(page);
});

test("a viewer and a manager of one store see the catalogue read only with the reason, and a retired reward stays retired", async ({
	page,
}) => {
	for (const [role, reason] of [
		[
			"viewer",
			"Bạn chỉ xem được danh mục ưu đãi. Chỉ chủ và quản lý toàn chuỗi mới soạn được; chỉ chủ quán mới duyệt.",
		],
		[
			"store-manager",
			"Bạn quản lý một số cửa hàng nên chỉ xem được danh mục ưu đãi. Ưu đãi áp dụng cho cả chuỗi, chỉ chủ hoặc quản lý toàn chuỗi mới soạn được.",
		],
	] as const) {
		await signedIn(page, role);
		await openRewards(page);
		await expect(page.getByTestId("settings-read-only")).toHaveText(reason);
		await expect(page.getByTestId("reward-row")).toHaveCount(2);
		await expect(page.getByTestId("reward-actions")).toHaveCount(0);
		await expect(page.getByTestId("reward-create")).toHaveCount(0);
		await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
		await expect(page.locator("main select")).toHaveCount(0);
		if (role === "viewer") await checkPage(page);
		expectNoConsoleErrors(page);
		await page.getByRole("button", { name: "Đăng xuất" }).click();
		await expect(page).toHaveURL(/#\/dang-nhap/);
	}
	await signedIn(page, "owner");
	await openRewards(page);
	await chooseReward(page, CHAIN_REWARD);
	await act(page, "Ngừng hẳn");
	await page
		.getByTestId("reward-retire-confirm")
		.getByRole("button", { name: "Ngừng hẳn ưu đãi" })
		.click();
	await expect(page.getByTestId("reward-status-panel")).toHaveAttribute(
		"data-status",
		"retired",
	);
	await expect(page.getByTestId("reward-retired-note")).toBeVisible();
	await expect(page.getByTestId("reward-actions")).toHaveCount(0);
	await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
	const owner = await clientAs("owner");
	const reopened = await owner
		.from("coupons")
		.update({ status: "draft" })
		.eq("tenant_id", settings().tenantId)
		.eq("name", CHAIN_REWARD)
		.select("id");
	expect(reopened.error?.code).toBe("22023");
	await signOutAll();
	expectNoConsoleErrors(page);
});

test("teardown leaves no fixture tenant, reward, rail or login and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await retireActiveRewards(settingsFixture);
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{ tenants: number; rewards: number; rails: number; users: number }[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.coupons where tenant_id = ${settingsFixture.tenantId}) as rewards,
				(select count(*)::int from public.coupon_rails where tenant_id = ${settingsFixture.tenantId}) as rails,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({ tenants: 0, rewards: 0, rails: 0, users: 0 });
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
