import type { SupabaseClient } from "@supabase/supabase-js";
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
	return error === null ? "ok" : (error.code ?? "error");
}

async function signedIn(page: Page, role: SettingsRole): Promise<void> {
	watchConsoleErrors(page);
	await settings().signIn(page, role);
}

async function query<T>(
	run: (sql: ReturnType<typeof openFixtureDatabase>) => Promise<T>,
): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

test("through PostgREST the notification functions follow the role rules, and refused calls write nothing", async () => {
	const tenant = settings().tenantId;
	const results: Record<string, string[]> = {};
	for (const login of [
		"owner",
		"manager",
		"store-manager",
		"staff",
		"viewer",
		"publisher",
	] as const) {
		const client = await clientAs(login);
		results[login] = [
			await outcome(client.rpc("notify_overview", { p_tenant_id: tenant })),
			await outcome(
				client.from("alert_rules").insert({
					tenant_id: tenant,
					store_id: null,
					rule_key: "ticket_drop",
					enabled: false,
				}),
			),
			await outcome(
				client
					.from("notification_channels")
					.select("*")
					.eq("tenant_id", tenant),
			),
			await outcome(
				client.rpc("start_channel_link", {
					p_tenant_id: tenant,
					p_kind: "webhook",
					p_label: null,
				}),
			),
		];
	}
	expect(results).toEqual({
		owner: ["ok", "ok", "42501", "22023"],
		manager: ["ok", "42501", "42501", "22023"],
		"store-manager": ["ok", "42501", "42501", "22023"],
		staff: ["ok", "42501", "42501", "22023"],
		viewer: ["ok", "42501", "42501", "22023"],
		publisher: ["42501", "42501", "42501", "42501"],
	});
	expect(
		await outcome(
			anonymousClient().rpc("notify_overview", { p_tenant_id: tenant }),
		),
	).not.toBe("ok");
	const rows = await query(
		(sql) => sql<{ count: number }[]>`
			select count(*)::int as count from public.alert_rules where tenant_id = ${tenant}
		`,
	);
	expect(rows[0]?.count).toBe(1);
	const manager = await clientAs("manager");
	expect(
		await outcome(
			manager.from("channel_policies").insert({
				tenant_id: tenant,
				channel_kind: "zalo_bot",
				message_class: "operational",
				allowed: true,
				requires_consent: true,
				consent_purpose: "notifications",
				source_note: "e2e",
			}),
		),
	).toBe("42501");
	await query(
		(sql) => sql`delete from public.alert_rules where tenant_id = ${tenant}`,
	);
});

test("the owner receives by e-mail from the page with one web_session consent, and the test waits for the next run while the schedule is off", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openSettings(page, "canh-bao");
	await expect(page.getByTestId("notify-destinations-empty")).toBeVisible();
	await expect(page.getByTestId("notify-schedule")).not.toHaveAttribute(
		"data-enabled",
		"true",
	);
	await page.getByTestId("notify-link-email").click();
	await page.getByTestId("notify-link-start").click();
	await expect(page.getByTestId("notify-link-done")).toBeVisible();
	const destination = page.locator(
		'[data-testid="notify-destination"][data-kind="email"]',
	);
	await expect(destination).toHaveAttribute("data-status", "active");
	const consents = await query(
		(sql) => sql<{ method: string }[]>`
			select evidence ->> 'method' as method from public.consent_records
			where tenant_id = ${settings().tenantId} and subject_id = ${settings().logins.owner.userId}
				and purpose = 'notifications' and revoked_at is null
		`,
	);
	expect(consents.map((row) => row.method)).toEqual(["web_session"]);
	await destination.getByTestId("notify-test").click();
	await expect(destination.getByTestId("notify-test-outcome")).toContainText(
		"chờ lần chạy tiếp theo",
		{ timeout: 10_000 },
	);
	const tests = await query(
		(sql) => sql<{ count: number }[]>`
			select count(*)::int as count from public.outbound_messages
			where tenant_id = ${settings().tenantId} and kind = 'test'
		`,
	);
	expect(tests[0]?.count).toBe(1);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("the owner overrides a rule through RLS and Mặc định deletes it; a manager reads the rules and mutes one on their own destination", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await openSettings(page, "canh-bao");
	const rule = page.locator(
		'[data-testid="notify-rule"][data-rule="ticket_drop"]',
	);
	await rule.getByTestId("notify-rule-edit").click();
	await rule.getByTestId("notify-rule-enabled").uncheck();
	await rule.getByTestId("notify-rule-save").click();
	await expect(rule).toHaveAttribute("data-source", "tenant");
	const saved = await query(
		(sql) => sql<{ created_by: string; enabled: boolean }[]>`
			select created_by::text, enabled from public.alert_rules
			where tenant_id = ${settings().tenantId} and rule_key = 'ticket_drop' and store_id is null
		`,
	);
	expect(saved).toEqual([
		{ created_by: settings().logins.owner.userId, enabled: false },
	]);
	await rule.getByTestId("notify-rule-reset").click();
	await expect(rule).toHaveAttribute("data-source", "catalogue");
	expectNoConsoleErrors(page);

	const managerPage = await page.context().browser()?.newPage();
	if (managerPage === undefined) throw new Error("no browser");
	await signedIn(managerPage, "manager");
	await openSettings(managerPage, "canh-bao");
	await expect(managerPage.getByTestId("notify-rules-read-only")).toBeVisible();
	await expect(managerPage.getByTestId("notify-rule-edit")).toHaveCount(0);
	await expect(managerPage.getByTestId("notify-policy-edit")).toHaveCount(0);
	await managerPage.getByTestId("notify-link-email").click();
	await managerPage.getByTestId("notify-link-start").click();
	await expect(managerPage.getByTestId("notify-link-done")).toBeVisible();
	await managerPage
		.locator('[data-testid="notify-rule"][data-rule="ticket_drop"]')
		.getByTestId("notify-rule-mute")
		.check();
	await expect
		.poll(async () =>
			query(
				(sql) => sql<{ muted: string[] }[]>`
					select muted_rules as muted from public.notification_channels
					where tenant_id = ${settings().tenantId} and user_id = ${settings().logins.manager.userId}
				`,
			),
		)
		.toEqual([{ muted: ["ticket_drop"] }]);
	await managerPage.close();
});

test("Bản tin lists a built digest with its delivery, and stopping all disables the member's destinations", async ({
	page,
}) => {
	const tenant = settings().tenantId;
	const [storeOne, storeTwo] = settings().storeIds;
	await query(async (sql) => {
		const ids = [storeOne, storeTwo].sort();
		const [digest] = await sql<{ id: string }[]>`
			insert into public.digests (tenant_id, business_date, scope_key, store_ids, all_stores, state, trigger, data_state, model, model_version, fingerprint, built_at)
			values (${tenant}, '2026-11-19', md5(${ids.join(",")}), ${ids}::uuid[], true, 'built', 'manual', 'verified',
				${sql.json({ totals: { net: 1250000, invoices: 42 } })}, 1, repeat('a', 64), now())
			returning id::text
		`;
		const [channel] = await sql<{ id: string }[]>`
			select id::text from public.notification_channels
			where tenant_id = ${tenant} and user_id = ${settings().logins.owner.userId}
		`;
		await sql`
			select app.enqueue_digest_message(${digest?.id ?? ""}::uuid, ${channel?.id ?? ""}::uuid, 0, 'digest', 'Bản tin', 'Bản tin thử của e2e', now())
		`;
	});
	await signedIn(page, "owner");
	await openSettings(page, "ban-tin");
	const card = page.getByTestId("digest-card");
	await expect(card).toHaveCount(1);
	await expect(card.getByTestId("digest-text")).toHaveText(
		"Bản tin thử của e2e",
	);
	await expect(card.getByTestId("digest-delivery")).toContainText("E-mail");
	await checkPage(page);
	await openSettings(page, "canh-bao");
	await page.getByTestId("notify-stop-all").click();
	await page.getByTestId("notify-stop-yes").click();
	await expect(page.getByTestId("notify-stop-done")).toBeVisible();
	const left = await query(
		(sql) => sql<{ status: string }[]>`
			select status from public.notification_channels
			where tenant_id = ${tenant} and user_id = ${settings().logins.owner.userId}
		`,
	);
	expect(left.map((row) => row.status)).toEqual(["disabled"]);
	expectNoConsoleErrors(page);
});

test("teardown leaves no fixture tenant or login and every real tenant's rows and logins are as they were", async () => {
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settings().teardown();
	expect(await snapshotRealTenants(before)).toEqual(before);
});
