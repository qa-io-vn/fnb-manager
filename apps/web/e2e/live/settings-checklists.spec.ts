import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsAccess, staffPageAccess } from "../../src/settings/access";
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
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import { openSettings, settingsNav } from "../support/settings";
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

const ITEMS = [
	{ label: "Mở ca trên POS", requires_photo: false, number_unit: null },
];

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
	request: PromiseLike<{ error: { code?: string } | null }>,
): Promise<string> {
	const { error } = await request;
	return error === null ? "saved" : (error.code ?? "error");
}

interface TemplateRow {
	readonly id: string;
	readonly store_id: string | null;
	readonly shift_phase: string;
	readonly title: string;
	readonly active: boolean;
	readonly version: number;
	readonly labels: string[];
}

async function templateRows(title: string): Promise<TemplateRow[]> {
	return withSql(
		(sql) => sql<TemplateRow[]>`
			select t.id, t.store_id, t.shift_phase, t.title, t.active, t.version,
				array(
					select i.label from public.checklist_items i
					where i.template_id = t.id and i.template_version = t.version
					order by i.position
				) as labels
			from public.checklist_templates t
			where t.tenant_id = ${settings().tenantId} and t.title = ${title}
			order by t.created_at, t.id
		`,
	);
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

async function openChecklists(page: Page): Promise<void> {
	await openSettings(page, "checklist");
	await expect(page.getByTestId("checklist-page")).toBeVisible();
}

function templateCard(page: Page, title: string): Locator {
	return page.getByTestId("checklist-template").filter({
		has: page
			.getByTestId("checklist-title")
			.filter({ hasText: new RegExp(`^${title}$`) }),
	});
}

function status(page: Page): Locator {
	return page.getByTestId("checklist-status");
}

test("through PostgREST, every login's checklist saves are saved or refused as the access helper says, and bad checklists give 22023", async () => {
	const [storeOne, storeTwo] = settings().storeIds;
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
	const scopes = [
		["store 1", storeOne],
		["store 2", storeTwo],
		["every store", null],
	] as const;
	const results: Record<string, Record<string, string>> = {};
	for (const login of logins) {
		const client = await clientAs(login);
		results[login] = {};
		for (const [name, storeId] of scopes) {
			const saved = await outcome(
				client.rpc("save_checklist_template", {
					p_tenant_id: settings().tenantId,
					p_store_id: storeId,
					p_shift_phase: "opening",
					p_title: `Quyền ${login} ${name}`,
					p_items: ITEMS,
				}),
			);
			results[login][name] = saved;
			expect(saved === "saved", `${login} on ${name}`).toBe(
				settingsAccess("checklists", members[login], storeId).canWrite,
			);
		}
	}
	expect(results).toEqual({
		owner: { "store 1": "saved", "store 2": "saved", "every store": "saved" },
		manager: { "store 1": "saved", "store 2": "saved", "every store": "saved" },
		"store-manager": {
			"store 1": "saved",
			"store 2": "42501",
			"every store": "42501",
		},
		staff: { "store 1": "42501", "store 2": "42501", "every store": "42501" },
		viewer: { "store 1": "42501", "store 2": "42501", "every store": "42501" },
		publisher: {
			"store 1": "42501",
			"store 2": "42501",
			"every store": "42501",
		},
	});
	expect(
		Object.fromEntries(
			logins.map((login) => [login, staffPageAccess(members[login]).canWrite]),
		),
	).toEqual({
		owner: true,
		manager: true,
		"store-manager": true,
		staff: false,
		viewer: false,
		publisher: false,
	});
	const anon = anonymousClient();
	expect(
		await outcome(
			anon.rpc("save_checklist_template", {
				p_tenant_id: settings().tenantId,
				p_store_id: storeOne,
				p_shift_phase: "opening",
				p_title: "Ẩn danh",
				p_items: ITEMS,
			}),
		),
	).toBe("42501");
	const owner = await clientAs("owner");
	const invalid = (args: Record<string, unknown>) =>
		outcome(
			owner.rpc("save_checklist_template", {
				p_tenant_id: settings().tenantId,
				p_store_id: storeOne,
				p_shift_phase: "opening",
				p_title: "Hợp lệ",
				p_items: ITEMS,
				...args,
			}),
		);
	expect(await invalid({ p_title: " " })).toBe("22023");
	expect(await invalid({ p_items: [] })).toBe("22023");
	expect(
		await invalid({
			p_items: Array.from({ length: 61 }, (_, index) => ({
				label: `Mục ${index + 1}`,
				requires_photo: false,
				number_unit: null,
			})),
		}),
	).toBe("22023");
	expect(await invalid({ p_shift_phase: "night" })).toBe("22023");
	const [storeTwoTemplate] = await templateRows("Quyền owner store 2");
	if (storeTwoTemplate === undefined) throw new Error("no store 2 template");
	const limited = await clientAs("store-manager");
	expect(
		await outcome(
			limited.rpc("set_checklist_template_active", {
				p_template_id: storeTwoTemplate.id,
				p_active: false,
			}),
		),
	).toBe("42501");
	const staff = await clientAs("staff");
	expect(
		await outcome(
			staff.rpc("set_checklist_template_active", {
				p_template_id: storeTwoTemplate.id,
				p_active: false,
			}),
		),
	).toBe("42501");
});

test("the owner creates a checklist from the outline, saves a new version that the next run reads while the past run keeps its wording, retires and reactivates it and copies it to store 2", async ({
	page,
}) => {
	const [storeOne, storeTwo] = settings().storeIds;
	await signedIn(page, "owner");
	await openChecklists(page);
	await page.getByRole("button", { name: "Tạo checklist" }).click();
	const form = page.getByTestId("checklist-form");
	await form.getByTestId("checklist-form-store").selectOption(storeOne);
	await form.getByTestId("checklist-form-phase").selectOption("closing");
	await form.getByRole("button", { name: "Tạo từ khung" }).click();
	await expect(form.getByLabel("Tên checklist", { exact: true })).toHaveValue(
		"Checklist đóng ca",
	);
	await form.getByRole("button", { name: "Đưa mục 5 lên" }).click();
	await checkPage(page);
	await form.getByRole("button", { name: "Tạo checklist" }).click();
	await expect(status(page)).toHaveText("Đã tạo checklist Checklist đóng ca.");
	const [created] = await templateRows("Checklist đóng ca");
	expect(created).toMatchObject({
		store_id: storeOne,
		shift_phase: "closing",
		version: 1,
		active: true,
	});
	expect(created?.labels).toEqual([
		"Kiểm đếm hàng hủy trong ca",
		"Vệ sinh khu pha chế và sàn",
		"Báo sự cố nếu có",
		"Đóng ca trên POS và đếm két",
		"Viết ghi chú bàn giao cho ca sau",
	]);
	if (created === undefined) throw new Error("no checklist");

	const staff = await clientAs("staff");
	const firstRun = await staff.rpc("start_checklist_run", {
		p_template_id: created.id,
		p_store_id: storeOne,
	});
	expect(firstRun.error).toBeNull();
	const firstRunId = (firstRun.data as { run_id: string }).run_id;
	expect(
		(await staff.rpc("finish_checklist_run", { p_run_id: firstRunId })).error,
	).toBeNull();

	const card = templateCard(page, "Checklist đóng ca");
	await card
		.getByRole("button", { name: "Sửa checklist Checklist đóng ca" })
		.click();
	const edit = card.getByTestId("checklist-form");
	await expect(edit.getByTestId("checklist-form-fixed")).toContainText(
		"Đóng ca",
	);
	await edit
		.getByLabel("Mục 3", { exact: true })
		.fill("Báo sự cố hoặc máy hỏng nếu có");
	await edit.getByRole("button", { name: "Lưu phiên bản mới" }).click();
	await expect(status(page)).toHaveText(
		"Đã lưu phiên bản 2 của Checklist đóng ca; áp dụng từ lần làm tiếp theo.",
	);
	await expect(card.getByTestId("checklist-facts")).toContainText(
		"Phiên bản 2",
	);
	const [saved] = await templateRows("Checklist đóng ca");
	expect(saved?.version).toBe(2);
	expect(saved?.labels[2]).toBe("Báo sự cố hoặc máy hỏng nếu có");

	const nextRun = await staff.rpc("start_checklist_run", {
		p_template_id: created.id,
		p_store_id: storeOne,
	});
	expect(nextRun.error).toBeNull();
	const next = nextRun.data as {
		run_id: string;
		template_version: number;
		items: { label: string }[];
	};
	expect(next.run_id).not.toBe(firstRunId);
	expect(next.template_version).toBe(2);
	expect(next.items.map((item) => item.label)[2]).toBe(
		"Báo sự cố hoặc máy hỏng nếu có",
	);
	const owner = await clientAs("owner");
	const past = await owner.rpc("checklist_run_detail", {
		p_run_id: firstRunId,
	});
	const pastRun = past.data as {
		template_version: number;
		items: { label: string }[];
	};
	expect(pastRun.template_version).toBe(1);
	expect(pastRun.items.map((item) => item.label)[2]).toBe("Báo sự cố nếu có");

	await card
		.getByRole("button", { name: "Ngừng dùng checklist Checklist đóng ca" })
		.click();
	await expect(status(page)).toHaveText(
		"Đã ngừng dùng Checklist đóng ca; checklist này không còn đến hạn.",
	);
	await expect(card).toHaveAttribute("data-active", "false");
	const due = await staff.rpc("due_checklists", { p_store_id: storeOne });
	expect(
		((due.data ?? []) as { template_id: string }[]).some(
			(row) => row.template_id === created.id,
		),
	).toBe(false);
	await card
		.getByRole("button", { name: "Dùng lại checklist Checklist đóng ca" })
		.click();
	await expect(status(page)).toHaveText("Đã dùng lại Checklist đóng ca.");
	expect((await templateRows("Checklist đóng ca"))[0]?.version).toBe(2);

	await card
		.getByRole("button", {
			name: "Sao chép checklist Checklist đóng ca sang cửa hàng khác",
		})
		.click();
	const copy = card.getByTestId("checklist-copy");
	await copy.getByTestId("checklist-copy-store").selectOption(storeTwo);
	await copy.getByRole("button", { name: "Sao chép" }).click();
	await expect(status(page)).toHaveText(
		"Đã sao chép Checklist đóng ca sang Cửa hàng thử 2.",
	);
	const copies = await templateRows("Checklist đóng ca");
	expect(copies.map((row) => [row.store_id, row.version])).toEqual([
		[storeOne, 2],
		[storeTwo, 1],
	]);
	expect(copies[1]?.labels).toEqual(copies[0]?.labels);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the manager limited to store 1 edits only store 1's checklists and reads every store's and store 2's are not listed", async ({
	page,
}) => {
	const [storeOne] = settings().storeIds;
	await signedIn(page, "store-manager");
	await openChecklists(page);
	const groups = page.getByTestId("checklist-group");
	await expect(groups.first()).toHaveAttribute("data-store-id", "all");
	await expect(
		page.locator(
			`[data-testid="checklist-group"][data-store-id="${settings().storeIds[1]}"]`,
		),
	).toHaveCount(0);
	const everyStore = templateCard(page, "Quyền owner every store");
	await expect(everyStore.getByTestId("checklist-read-only")).toHaveAttribute(
		"data-reason",
		"scope",
	);
	await expect(everyStore.getByRole("button")).toHaveCount(0);
	await expect(
		templateCard(page, "Checklist đóng ca").getByRole("button", {
			name: "Sửa checklist Checklist đóng ca",
		}),
	).toBeVisible();
	await page.getByRole("button", { name: "Tạo checklist" }).click();
	await expect(
		page.getByTestId("checklist-form-store").locator("option"),
	).toHaveText(["Cửa hàng thử 1"]);
	await expect(page.getByTestId("checklist-form-store")).toHaveValue(storeOne);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("staff and the viewer find no Checklist in the menu and only the reason at its address", async ({
	browser,
}) => {
	for (const role of ["staff", "viewer"] as const) {
		const pageContext = await browser.newContext();
		const page = await pageContext.newPage();
		try {
			await signedIn(page, role);
			await openSettings(page, "checklist");
			await expect(
				settingsNav(page).getByRole("link", { name: "Checklist" }),
			).toHaveCount(0);
			await expect(page.getByTestId("settings-read-only")).toHaveText(
				"Trang Checklist chỉ dành cho chủ và quản lý.",
			);
			await expect(page.getByTestId("checklist-settings")).toHaveCount(0);
			await checkPage(page);
			expectNoConsoleErrors(page);
		} finally {
			await pageContext.close();
		}
	}
});

test("teardown leaves no fixture tenant, checklist or login, and every real tenant's rows and logins are as they were", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const hex = settingsFixture.slug.slice(FIXTURE_SLUG_PREFIX.length);
		const [left] = await sql<
			{ tenants: number; templates: number; users: number }[]
		>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.checklist_templates where tenant_id = ${settingsFixture.tenantId}) as templates,
				(select count(*)::int from auth.users where email like ${`e2e-%-${hex}@example.com`}) as users
		`;
		expect(left).toEqual({ tenants: 0, templates: 0, users: 0 });
	});
	expect(await snapshotRealTenants(before)).toEqual(before);
});
