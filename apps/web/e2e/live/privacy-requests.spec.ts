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

const MAIN_LOCAL = `0${LOYALTY_PHONES.main.slice(COUNTRY.length)}`;
const SECOND_LOCAL = `0${LOYALTY_PHONES.second.slice(COUNTRY.length)}`;
const ALL_PHONES = Object.values(LOYALTY_PHONES);

let fixture: SettingsFixture | undefined;
let loyalty: LoyaltyFixture | undefined;
let before: RealTenantsSnapshot | undefined;
let customers: { main: string; second: string } | undefined;
const clients: SupabaseClient[] = [];

function settings(): SettingsFixture {
	if (fixture === undefined) throw new Error("the fixture was not created");
	return fixture;
}

function seeded(): LoyaltyFixture {
	if (loyalty === undefined) throw new Error("no loyalty fixture");
	return loyalty;
}

function subjects(): { main: string; second: string } {
	if (customers === undefined) throw new Error("no customers");
	return customers;
}

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = openFixtureDatabase();
	try {
		return await run(sql);
	} finally {
		await sql.end();
	}
}

test.beforeAll(async () => {
	before = await snapshotRealTenants();
	fixture = await createSettingsFixture();
	loyalty = await createLoyaltyFixture(fixture);
	const tenantId = fixture.tenantId;
	customers = await withSql(async (sql) => {
		const rows = await sql<{ id: string; phone: string }[]>`
			select c.id, c.phone from public.customers c
			where c.tenant_id = ${tenantId} and c.phone in (${LOYALTY_PHONES.main}, ${LOYALTY_PHONES.second})
		`;
		const main = rows.find((row) => row.phone === LOYALTY_PHONES.main);
		const second = rows.find((row) => row.phone === LOYALTY_PHONES.second);
		if (main === undefined || second === undefined) {
			throw new Error("the fixture customers are missing");
		}
		for (const subject of [main, second]) {
			await sql`
				insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
				values
					(${tenantId}, 'customer', ${subject.id}, 'loyalty', 'v1', 'mini_app', now() - interval '10 days'),
					(${tenantId}, 'customer', ${subject.id}, 'marketing', 'v1', 'mini_app', now() - interval '10 days')
			`;
			await sql`
				insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, title, body)
				values (${tenantId}, 'zalo_oa', ${`synthetic-${subject.id}`}, 'customer', ${subject.id}, 'marketing', 'synthetic.v1', now() - interval '2 days', 'sent', 'Synthetic', 'Synthetic')
			`;
		}
		return { main: main.id, second: second.id };
	});
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

interface Exchange {
	readonly method: string;
	readonly url: string;
	readonly body: string;
}

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

async function expectNoFullPhone(page: Page): Promise<void> {
	const shown = `${(await page.locator("body").textContent()) ?? ""} ${await page.title()} ${page.url()}`;
	for (const phone of ALL_PHONES) {
		expect(shown).not.toContain(phone);
		expect(shown).not.toContain(phone.slice(COUNTRY.length));
	}
	expect(shown).not.toMatch(/(\+84|\b0)9\d{8}\b/);
}

function expectNoPhoneInUrls(exchanges: readonly Exchange[]): void {
	expect(exchanges.length).toBeGreaterThan(0);
	for (const { url } of exchanges) {
		const text = decodeURIComponent(url);
		for (const phone of ALL_PHONES) {
			expect(text, url).not.toContain(phone);
			expect(text, url).not.toContain(phone.slice(COUNTRY.length));
		}
	}
}

test("through PostgREST, only an owner or manager with every store reaches the tooling, with the phone in a POST body, never a URL", async () => {
	const results: Record<string, string> = {};
	for (const login of [
		"owner",
		"manager",
		"store-manager",
		"staff",
		"viewer",
		"publisher",
	] as const) {
		const client = await clientAs(login);
		const lookup = await client.rpc("dsr_lookup", { p_phone: MAIN_LOCAL });
		const due = await client.rpc("dsr_due_soon", { p_days: 3 });
		const requests = await client
			.from("data_subject_requests")
			.select("id", { count: "exact", head: true })
			.eq("tenant_id", settings().tenantId);
		const rows = (lookup.data ?? []) as { phone_masked: string }[];
		results[login] = [
			lookup.error?.code ?? `lookup ${rows.length}`,
			due.error?.code ?? "due ok",
			requests.error?.code ?? `requests ${requests.count ?? 0}`,
			JSON.stringify(lookup.data ?? "").includes(MAIN_LOCAL.slice(1))
				? "LEAK"
				: "no phone",
		].join(" | ");
	}
	expect(results).toEqual({
		owner: "lookup 1 | due ok | requests 0 | no phone",
		manager: "lookup 1 | due ok | requests 0 | no phone",
		"store-manager": "42501 | 42501 | requests 0 | no phone",
		staff: "42501 | 42501 | requests 0 | no phone",
		viewer: "42501 | 42501 | requests 0 | no phone",
		publisher: "42501 | 42501 | requests 0 | no phone",
	});
	const owner = await clientAs("owner");
	const refused = await owner.rpc("dsr_export", {
		p_request_id: "00000000-0000-4000-8000-000000000000",
	});
	expect(refused.error?.code).toBe("42501");
	const viewer = await clientAs("viewer");
	for (const [name, args] of [
		["dsr_export", { p_request_id: seeded().queueItemId }],
		[
			"dsr_correct",
			{ p_request_id: seeded().queueItemId, p_field: "name", p_value: "x" },
		],
		["dsr_delete", { p_request_id: seeded().queueItemId }],
		["dsr_deletion_preview", { p_request_id: seeded().queueItemId }],
	] as const) {
		const { error } = await viewer.rpc(name, args);
		expect(error?.code, name).toBe("42501");
	}
});

test("an owner looks a customer up by phone, sees consent per purpose without any phone, and withdraws marketing consent", async ({
	page,
}) => {
	await signedIn(page, "owner");
	const answers = recordDataApi(page);
	await page.goto("/#/khach-hang/tra-cuu-du-lieu");
	await expect(page.getByTestId("loyalty-tabs")).toContainText(
		"Yêu cầu về dữ liệu",
	);
	await page.getByTestId("privacy-lookup-input").fill(MAIN_LOCAL);
	await page.getByTestId("privacy-lookup-submit").click();
	await expect(page.getByTestId("privacy-subject-phone")).toHaveText(
		"•••• ••• 201",
	);
	await expect(page.getByTestId("privacy-subject-counts")).toContainText(
		"1 thành viên",
	);
	await expect(page.getByTestId("privacy-consent")).toHaveCount(2);
	await expect(page.getByTestId("privacy-revoke")).toHaveCount(2);
	await expectNoFullPhone(page);
	await checkPage(page);
	const marketing = page
		.getByTestId("privacy-consent")
		.and(page.locator('[data-purpose="marketing"]'));
	await marketing.getByTestId("privacy-revoke").click();
	await marketing.getByTestId("privacy-revoke-yes").click();
	await expect(page.getByTestId("privacy-revoke-done")).toContainText(
		"Đã rút đồng ý Tin khuyến mại.",
	);
	await expect(page.getByTestId("privacy-revoke")).toHaveCount(1);
	const [state] = await withSql(
		(sql) => sql<{ marketing: boolean; loyalty: boolean }[]>`
			select
				app.has_active_consent(${settings().tenantId}::uuid, 'customer', ${subjects().main}::uuid, 'marketing') as marketing,
				app.has_active_consent(${settings().tenantId}::uuid, 'customer', ${subjects().main}::uuid, 'loyalty') as loyalty
		`,
	);
	expect(state).toEqual({ marketing: false, loyalty: true });
	const exchanges = await answers();
	expect(
		exchanges
			.filter((exchange) => exchange.url.includes("/rpc/dsr_lookup"))
			.map((exchange) => exchange.method),
	).toEqual(["POST", "POST"]);
	expectNoPhoneInUrls(exchanges);
	for (const { body } of exchanges) {
		for (const phone of ALL_PHONES) expect(body).not.toContain(phone);
	}
	expectNoConsoleErrors(page);
});

test("an owner records, exports and completes a deletion request, and the counts match the confirmation", async ({
	page,
}) => {
	await signedIn(page, "owner");
	await page.goto("/#/khach-hang/tra-cuu-du-lieu");
	await page.getByTestId("privacy-lookup-input").fill(SECOND_LOCAL);
	await page.getByTestId("privacy-lookup-submit").click();
	await expect(page.getByTestId("privacy-subject")).toBeVisible();
	await page.getByTestId("privacy-form-submit").click();
	await expect(page.getByText("Nhập cách liên hệ với khách.")).toBeVisible();
	await page.getByTestId("privacy-form-type").selectOption("deletion");
	await page.getByTestId("privacy-form-contact").fill("khach@example.com");
	await page.getByTestId("privacy-form-submit").click();
	await expect(page.getByTestId("privacy-record-done")).toBeVisible();

	await page.goto("/#/khach-hang/yeu-cau-du-lieu");
	const banner = page.getByTestId("privacy-due-banner");
	await expect(banner).toBeVisible();
	const request = page.getByTestId("privacy-request");
	await expect(request).toHaveCount(1);
	await expect(request).toHaveAttribute("data-type", "deletion");
	await expect(
		request.getByTestId("privacy-deadline-response"),
	).toHaveAttribute("data-state", /due_soon|on_track/);
	await expect(
		request.getByTestId("privacy-deadline-completion"),
	).toHaveAttribute("data-state", "on_track");
	await checkPage(page);
	await request.getByTestId("privacy-request-toggle").click();

	const download = page.waitForEvent("download");
	await request.getByTestId("privacy-export").click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(
		/^yeu-cau-[0-9a-f]{8}-du-lieu\.json$/,
	);
	const stream = await file.createReadStream();
	let text = "";
	for await (const chunk of stream) text += chunk.toString();
	const exported = JSON.parse(text) as {
		counts: Record<string, number>;
		customer: { id: string; phone: string };
	};
	expect(exported.customer.id).toBe(subjects().second);
	expect(exported.customer.phone).toBe(LOYALTY_PHONES.second);
	expect(exported.counts.memberships).toBe(1);
	expect(exported.counts.consent_records).toBe(2);
	expect(exported.counts.messages).toBe(1);
	expect(exported.counts.loyalty_ledger).toBeGreaterThan(0);
	expect(text).not.toContain(LOYALTY_PHONES.main);
	expect(text).not.toContain(subjects().main);
	await expect(request.getByTestId("privacy-export-done")).toContainText(
		"Đã tải tệp dữ liệu riêng tư",
	);
	await expect(request).toHaveAttribute("data-status", "in_progress");

	await request.getByTestId("privacy-delete-start").click();
	const confirm = page.getByTestId("privacy-delete-confirm");
	await expect(confirm).toBeVisible();
	const previewCounts = confirm.getByTestId("privacy-delete-counts");
	await expect(previewCounts).toContainText(
		`Thành viên: ${exported.counts.memberships}`,
	);
	await expect(previewCounts).toContainText(
		`Dòng sổ điểm: ${exported.counts.loyalty_ledger}`,
	);
	await expect(previewCounts).toContainText(
		`Bản ghi đồng ý: ${exported.counts.consent_records}`,
	);
	await checkPage(page);
	await confirm.getByTestId("privacy-delete-yes").click();
	const deleted = page.getByTestId("privacy-deleted");
	await expect(deleted).toBeVisible();
	await expect(deleted).toContainText("Khách hàng: 1");
	await expect(deleted).toContainText(
		`Thành viên: ${exported.counts.memberships}`,
	);
	await expect(deleted).toContainText(
		`Dòng sổ điểm: ${exported.counts.loyalty_ledger}`,
	);
	await expect(deleted).toContainText("Đúng hạn: trả lời có, hoàn tất có.");
	await expect(request).toHaveAttribute("data-status", "completed");
	await expect(request.getByTestId("privacy-request-toggle")).toHaveCount(0);
	await expectNoFullPhone(page);
	const [after] = await withSql(
		(sql) => sql<
			{ customers: number; members: number; consents: number; action: string }[]
		>`
			select
				(select count(*)::int from public.customers where id = ${subjects().second}) as customers,
				(select count(*)::int from public.memberships where customer_id = ${subjects().second}) as members,
				(select count(*)::int from public.consent_records where subject_id = ${subjects().second}) as consents,
				(select a.counts ->> 'loyalty_ledger' from public.data_subject_request_actions a where a.tenant_id = ${settings().tenantId}) as action
		`,
	);
	expect(after).toMatchObject({ customers: 0, members: 0, consents: 0 });
	expect(Number(after?.action)).toBe(exported.counts.loyalty_ledger);
	const [main] = await withSql(
		(sql) => sql<{ members: number }[]>`
			select count(*)::int as members from public.memberships where customer_id = ${subjects().main}
		`,
	);
	expect(main?.members).toBe(1);
	expectNoConsoleErrors(page);
});

test("a deletion request closed with notes, a correction by a manager and the managers' missing delete button", async ({
	page,
}) => {
	const tenantId = settings().tenantId;
	const ids = await withSql(
		(sql) => sql<{ id: string; request_type: string }[]>`
			insert into public.data_subject_requests (tenant_id, subject_type, subject_id, contact, request_type)
			values
				(${tenantId}, 'customer', ${subjects().main}, 'synthetic', 'correction'),
				(${tenantId}, 'customer', ${subjects().main}, 'synthetic', 'deletion'),
				(${tenantId}, 'customer', null, 'synthetic', 'objection')
			returning id, request_type::text
		`,
	);
	expect(ids).toHaveLength(3);
	await signedIn(page, "manager");
	await page.goto("/#/khach-hang/yeu-cau-du-lieu");
	const requestOf = (type: string) =>
		page.locator(
			`[data-testid="privacy-request"][data-type="${type}"]:not([data-status="completed"])`,
		);
	await requestOf("deletion").getByTestId("privacy-request-toggle").click();
	await expect(
		requestOf("deletion").getByTestId("privacy-no-delete"),
	).toBeVisible();
	await expect(
		requestOf("deletion").getByTestId("privacy-delete-start"),
	).toHaveCount(0);
	const refused = await (await clientAs("manager")).rpc("dsr_delete", {
		p_request_id: ids.find((row) => row.request_type === "deletion")?.id,
	});
	expect(refused.error?.code).toBe("42501");

	const correction = requestOf("correction");
	await correction.getByTestId("privacy-request-toggle").click();
	await correction.getByTestId("privacy-correct-save").click();
	await expect(page.getByText("Nhập tên đã sửa.")).toBeVisible();
	await correction
		.getByTestId("privacy-correct-input")
		.fill("Khách đã sửa tên");
	await correction.getByTestId("privacy-correct-save").click();
	await expect(correction.getByTestId("privacy-correct-done")).toContainText(
		"Đã sửa tên",
	);
	const [name] = await withSql(
		(sql) =>
			sql<
				{ name: string }[]
			>`select name from public.customers where id = ${subjects().main}`,
	);
	expect(name?.name).toBe("Khách đã sửa tên");
	await correction
		.getByTestId("privacy-close-notes")
		.fill("Đã sửa theo yêu cầu");
	await correction.getByTestId("privacy-complete").click();
	await expect(
		page.locator('[data-testid="privacy-request"][data-type="correction"]'),
	).toHaveAttribute("data-status", "completed");

	const objection = requestOf("objection");
	await expect(objection.getByText("Chưa gắn với khách")).toBeVisible();
	await objection.getByTestId("privacy-request-toggle").click();
	await expect(objection.getByTestId("privacy-export")).toHaveCount(0);
	await objection.getByTestId("privacy-reject").click();
	await expect(
		page.locator('[data-testid="privacy-request"][data-type="objection"]'),
	).toHaveAttribute("data-status", "rejected");
	const [closed] = await withSql(
		(sql) => sql<{ notes: string | null; status: string }[]>`
			select notes, status::text from public.data_subject_requests
			where tenant_id = ${tenantId} and request_type = 'correction'
		`,
	);
	expect(closed).toEqual({ notes: "Đã sửa theo yêu cầu", status: "completed" });
	await checkPage(page);
	await expectNoFullPhone(page);
	expectNoConsoleErrors(page);
});

test("staff, viewers, store managers and publishers see no privacy page and no privacy tab", async ({
	page,
}) => {
	for (const role of ["viewer", "store-manager", "staff"] as const) {
		await signedIn(page, role);
		await page.goto("/#/khach-hang/tra-cuu-du-lieu");
		if (role === "staff") {
			await expect(page.getByTestId("loyalty-no-access")).toBeVisible();
		} else {
			await expect(page.getByTestId("privacy-no-access")).toBeVisible();
			await expect(page.getByTestId("loyalty-tabs")).not.toContainText(
				"Yêu cầu về dữ liệu",
			);
		}
		await expect(page.getByTestId("privacy-lookup")).toHaveCount(0);
		await page.goto("/#/khach-hang/yeu-cau-du-lieu");
		await expect(page.getByTestId("privacy-queue")).toHaveCount(0);
		await page.getByRole("button", { name: "Đăng xuất" }).click();
		await expect(page).toHaveURL(/#\/dang-nhap/);
	}
	expectNoConsoleErrors(page);
});

test("teardown leaves no fixture rows and every real tenant is as it was", async () => {
	const settingsFixture = settings();
	if (before === undefined) throw new Error("no snapshot was taken");
	await signOutAll();
	await settingsFixture.teardown();
	await withSql(async (sql) => {
		const [left] = await sql<{ tenants: number; requests: number }[]>`
			select
				(select count(*)::int from public.tenants where id = ${settingsFixture.tenantId}) as tenants,
				(select count(*)::int from public.data_subject_requests where tenant_id = ${settingsFixture.tenantId}) as requests
		`;
		expect(left).toEqual({ tenants: 0, requests: 0 });
	});
	expect(settingsFixture.slug.startsWith(FIXTURE_SLUG_PREFIX)).toBe(true);
	expect(await snapshotRealTenants(before)).toEqual(before);
});
