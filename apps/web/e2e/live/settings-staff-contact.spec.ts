import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsAccess } from "../../src/settings/access";
import type { Membership } from "../../src/settings/source";
import { checkPage } from "../support/checks";
import {
	anonymousClient,
	isLocalStackConfigured,
} from "../support/local-stack";
import { expect, type Page, test } from "../support/policy-test";
import {
	type RealTenantsSnapshot,
	snapshotRealTenants,
} from "../support/real-tenants";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import { openSettings } from "../support/settings";
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

const NOTE =
	"Gặp quản lý ca ở quầy để nhận mã ghép nối.\nNgoài giờ, nhắn quản lý.";

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

async function storedNote(): Promise<string | null> {
	const sql = openFixtureDatabase();
	try {
		const [row] = await sql<{ note: string | null }[]>`
			select staff_contact_instructions as note from public.tenants where id = ${settings().tenantId}
		`;
		return row?.note ?? null;
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

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

test("through PostgREST only an owner with every store sets the contact note, a link or a long note gives 22023, and every member reads it", async () => {
	const [storeOne] = settings().storeIds;
	const members: Readonly<Record<Login, Membership>> = {
		owner: { role: "owner", storeIds: null },
		manager: { role: "manager", storeIds: null },
		"store-manager": { role: "manager", storeIds: [storeOne] },
		staff: { role: "staff", storeIds: null },
		viewer: { role: "viewer", storeIds: null },
		publisher: { role: "publisher", storeIds: null },
	};
	const results: Record<string, string> = {};
	for (const login of Object.keys(members) as Login[]) {
		const client = await clientAs(login);
		results[login] = await outcome(
			client.rpc("set_staff_contact_instructions", {
				p_tenant_id: settings().tenantId,
				p_text: `Ghi chú của ${login}`,
			}),
		);
		expect(results[login] === "saved", login).toBe(
			settingsAccess("staffContact", members[login]).canWrite,
		);
	}
	expect(results).toEqual({
		owner: "saved",
		manager: "42501",
		"store-manager": "42501",
		staff: "42501",
		viewer: "42501",
		publisher: "42501",
	});
	expect(
		await outcome(
			anonymousClient().rpc("set_staff_contact_instructions", {
				p_tenant_id: settings().tenantId,
				p_text: "Ẩn danh",
			}),
		),
	).toBe("42501");
	const owner = await clientAs("owner");
	const set = (text: string | null) =>
		outcome(
			owner.rpc("set_staff_contact_instructions", {
				p_tenant_id: settings().tenantId,
				p_text: text,
			}),
		);
	expect(await set("Xem www.example.com")).toBe("22023");
	expect(await set("x".repeat(501))).toBe("22023");
	expect(await set("Gặp\u0007quản lý")).toBe("22023");
	expect(await storedNote()).toBe("Ghi chú của owner");
	for (const login of ["manager", "staff", "viewer"] as const) {
		const client = await clientAs(login);
		const { data } = await client
			.from("tenants")
			.select("staff_contact_instructions")
			.eq("id", settings().tenantId);
		expect(data, login).toEqual([
			{ staff_contact_instructions: "Ghi chú của owner" },
		]);
	}
});

test("the owner writes the note on Nhân viên, a link held back before sending, and a manager reads it with the reason", async ({
	page,
	browser,
}) => {
	await signedIn(page, "owner");
	await openSettings(page, "nhan-vien");
	const section = page.getByTestId("staff-contact");
	const field = section.getByLabel("Lời nhắn", { exact: true });
	await expect(field).toHaveValue("Ghi chú của owner");
	await field.fill("Nhắn qua zalo.me/quan-ly");
	await expect(section.getByTestId("settings-field-error")).toHaveText(
		"Lời nhắn không được chứa đường link; ghi tên người hoặc số điện thoại thay vào.",
	);
	await field.fill(`  ${NOTE}\n`);
	await section.getByRole("button", { name: "Lưu" }).click();
	await expect(section.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	expect(await storedNote()).toBe(NOTE);
	await checkPage(page);
	expectNoConsoleErrors(page);

	const context = await browser.newContext();
	try {
		const manager = await context.newPage();
		await signedIn(manager, "manager");
		await openSettings(manager, "nhan-vien");
		const read = manager.getByTestId("staff-contact");
		await expect(read.getByTestId("staff-contact-read-only")).toHaveText(
			"Chỉ chủ quán quản lý tất cả cửa hàng sửa lời nhắn này.",
		);
		await expect(read.getByTestId("staff-contact-current")).toHaveText(NOTE);
		await expect(read.getByRole("textbox")).toHaveCount(0);
		await checkPage(manager);
		expectNoConsoleErrors(manager);
	} finally {
		await context.close();
	}
});

test("teardown leaves no fixture tenant or login and every real tenant's rows and logins are as they were", async () => {
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settings().teardown();
	expect(await snapshotRealTenants(before)).toEqual(before);
});
