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
	syntheticPhone,
} from "../support/loyalty-fixture";
import { expect, type Page, test } from "../support/policy-test";
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
/** The two members of the opt-out and promotion test (G-56); they are created by that test, not by the fixture. */
const PROMOTION_PHONES = {
	optedOut: syntheticPhone("1204"),
	consenting: syntheticPhone("1205"),
} as const;
const ALL_PHONES: readonly string[] = [
	...Object.values(LOYALTY_PHONES),
	...Object.values(PROMOTION_PHONES),
];

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

interface PromotionMember {
	readonly customerId: string;
	readonly membershipId: string;
}

interface PromotionWorld {
	readonly storeId: string;
	/** The instant the messages are queued and drained at: tomorrow 12:00 in the tenant's zone, inside any sending hours. */
	readonly noon: string;
	readonly optedOut: PromotionMember;
	readonly consenting: PromotionMember;
}

/**
 * What the Mini App enrolment would have written, with the messaging switched on: a brand with its Official Account
 * and approved templates, two members who agreed to loyalty and marketing, and the tenant's message settings.
 */
async function seedPromotionWorld(
	sql: Sql,
	tenantId: string,
	storeId: string,
	hex: string,
): Promise<PromotionWorld> {
	const [brand] = await sql<{ id: string }[]>`
		insert into public.brands (tenant_id, brand_key, display_name, store_ids)
		values (${tenantId}, 'brand-1', 'Thương hiệu thử', ${[storeId]}::uuid[])
		returning id
	`;
	if (brand === undefined) throw new Error("no brand");
	const [oa] = await sql<{ id: string }[]>`
		insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
		values (${tenantId}, ${brand.id}, ${`e2e-oa-${hex}`}, 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1')
		returning id
	`;
	if (oa === undefined) throw new Error("no official account");
	await sql`
		insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
		values
			(${tenantId}, ${oa.id}, ${`e2e-voucher-${hex}`}, 'transaction', 'voucher', 'approved'),
			(${tenantId}, ${oa.id}, ${`e2e-win-back-${hex}`}, 'promotion', 'win_back', 'approved'),
			(${tenantId}, ${oa.id}, ${`e2e-birthday-${hex}`}, 'customer_care', 'birthday', 'approved')
	`;
	await sql`
		insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled)
		values (${tenantId}, true, true, true)
	`;
	const enrol = async (phone: string): Promise<PromotionMember> => {
		const [customer] = await sql<{ id: string }[]>`
			select app.loyalty_customer_for_phone(${tenantId}::uuid, ${phone}, now())::text as id
		`;
		if (customer === undefined) throw new Error("no customer");
		const [member] = await sql<{ id: string }[]>`
			select app.loyalty_join(${tenantId}::uuid, ${customer.id}::uuid, 'mini_app', ${storeId}::uuid, ${brand.id}::uuid, null, now())::text as id
		`;
		if (member === undefined) throw new Error("no membership");
		await sql`
			insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
			values
				(${tenantId}, 'customer', ${customer.id}, 'loyalty', 'v1', 'mini_app', now() - interval '10 days'),
				(${tenantId}, 'customer', ${customer.id}, 'marketing', 'v1', 'mini_app', now() - interval '10 days')
		`;
		return { customerId: customer.id, membershipId: member.id };
	};
	const optedOut = await enrol(PROMOTION_PHONES.optedOut);
	const consenting = await enrol(PROMOTION_PHONES.consenting);
	const [time] = await sql<{ noon: string }[]>`
		select ((((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1) + time '12:00') at time zone 'Asia/Ho_Chi_Minh')::text as noon
	`;
	if (time === undefined) throw new Error("no time");
	return { storeId, noon: time.noon, optedOut, consenting };
}

/** The one insert path of customer messages, as the win-back scan and the earn and hold triggers call it; null when it refuses. */
async function enqueueCustomerMessage(
	sql: Sql,
	tenantId: string,
	world: PromotionWorld,
	membershipId: string,
	kind: "win_back" | "birthday" | "coupon_issued",
	eventKey: string,
): Promise<string | null> {
	const params = kind === "win_back" ? { inactive_days: 45 } : {};
	const [row] = await sql<{ id: string | null }[]>`
		select app.enqueue_customer_message(
			${tenantId}::uuid, ${membershipId}::uuid, ${kind}::text, ${eventKey}::text, ${sql.json(params)},
			${world.storeId}::uuid, null, ${world.noon}::timestamptz
		)::text as id
	`;
	return row?.id ?? null;
}

/**
 * The dispatcher's customer step without its provider call: app.claim_next_customer_message decides (and cancels what
 * it refuses), then the claimed messages are marked begun and sent under a synthetic provider id, as
 * packages/notify does through app.begin_customer_send and app.finish_customer_send. The recipient column of the
 * claim is never read, so no phone leaves the database.
 */
async function drainCustomerMessages(
	sql: Sql,
	tenantId: string,
	at: string,
): Promise<{ messageId: string; kind: string; route: string }[]> {
	const claimed: { messageId: string; kind: string; route: string }[] = [];
	for (let claim = 0; claim < 10; claim += 1) {
		const [next] = await sql<
			{ message_id: string; claimed_at: string; kind: string; route: string }[]
		>`
			select c.message_id::text as message_id, c.claimed_at::text as claimed_at, c.kind, c.route
			from app.claim_next_customer_message(
				'e2e-privacy', array['consultation', 'template'], interval '2 minutes', ${at}::timestamptz, ${tenantId}::uuid
			) c
		`;
		if (next === undefined) return claimed;
		const [begun] = await sql<{ ok: boolean }[]>`
			select app.begin_customer_send(${next.message_id}::uuid, ${next.claimed_at}::timestamptz, ${at}::timestamptz) as ok
		`;
		expect(begun?.ok, "the claim is still ours").toBe(true);
		const [finished] = await sql<{ status: string }[]>`
			select app.finish_customer_send(
				${next.message_id}::uuid, ${next.claimed_at}::timestamptz, 'sent', null, ${`mock-${next.message_id}`}, null, ${at}::timestamptz
			) as status
		`;
		expect(finished?.status).toBe("sent");
		claimed.push({
			messageId: next.message_id,
			kind: next.kind,
			route: next.route,
		});
	}
	throw new Error("the customer outbox still had a message after ten claims");
}

interface MessageRow {
	readonly subject_id: string;
	readonly kind: string;
	readonly status: string;
	readonly channel: string;
	readonly decision: string | null;
	readonly hold_reason: string | null;
	readonly last_error_code: string | null;
	readonly attempts: number;
	readonly was_sent: boolean;
	readonly recipient_ref: string;
	readonly params: Record<string, unknown> | null;
	readonly consent_purpose: string | null;
	readonly consent_revoked: boolean | null;
	readonly whole: string;
}

function customerMessages(sql: Sql, tenantId: string): Promise<MessageRow[]> {
	return sql<MessageRow[]>`
		select
			o.subject_id::text as subject_id, o.kind, o.status, o.channel, o.decision, o.hold_reason, o.last_error_code,
			o.attempts::integer as attempts, o.sent_at is not null as was_sent, o.recipient_ref, o.params,
			c.purpose::text as consent_purpose, (c.revoked_at is not null) as consent_revoked,
			to_jsonb(o)::text as whole
		from public.outbound_messages o
		left join public.consent_records c on c.id = o.consent_record_id
		where o.tenant_id = ${tenantId} and o.subject_type = 'customer' and o.kind is not null
		order by o.created_at, o.id
	`;
}

function messageOf(
	rows: readonly MessageRow[],
	customerId: string,
	kind: string,
): MessageRow {
	const found = rows.find(
		(row) => row.subject_id === customerId && row.kind === kind,
	);
	if (found === undefined) throw new Error(`no ${kind} message was queued`);
	return found;
}

function outcomeOf(row: MessageRow): string {
	return `${row.status}:${row.channel}:${row.decision ?? ""}`;
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

/*
 * G-56: the opt-out on the page reaches the send decision.
 *
 * Test design (ISTQB):
 * - State transition testing: a member who agreed to marketing has promotions waiting in the outbox (consented, queued);
 *   the owner withdraws the consent on the page (opted out); the dispatcher's claim then refuses the waiting promotions
 *   (cancelled, never sent, never claimed), and a second drain finds nothing (cancelled is final). The invalid
 *   transition is also tried: after the opt-out no new promotion is queued for the member.
 * - Decision table testing: opted out of marketing (yes, no) x message kind (win_back and birthday are advertising,
 *   coupon_issued is transactional) x member. Cells run here: (yes, win_back) and (yes, birthday) are cancelled with
 *   no_marketing_consent, (yes, coupon_issued) still goes because the loyalty consent stands, and (no, win_back) goes as a
 *   template, which shows that the refusal is caused by the opt-out and not by a broken fixture. The full 192-cell
 *   table is pgTAP 160_customer_message_route_decision_table; this test adds the page as the cause.
 * - Negative and security testing: no full phone number on the page, in a request URL or response, nor anywhere in
 *   the message rows (reason, parameters, recipient reference), and the cancelled rows carry nothing a send would have set.
 */
test("an owner opts a member out of marketing on the page: the waiting win-back is cancelled with no_marketing_consent, nothing new is queued, and a member who did not opt out still gets theirs", async ({
	page,
}) => {
	const tenantId = settings().tenantId;
	const hex = settings().slug.slice(FIXTURE_SLUG_PREFIX.length);
	const world = await withSql((sql) =>
		seedPromotionWorld(sql, tenantId, settings().storeIds[0], hex),
	);
	const { optedOut, consenting } = world;
	const queued = await withSql(async (sql) => ({
		optedOutWinBack: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"win_back",
			"e2e-opt-out-win-back",
		),
		optedOutBirthday: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"birthday",
			"e2e-opt-out-birthday",
		),
		optedOutCoupon: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"coupon_issued",
			"e2e-opt-out-coupon",
		),
		consentingWinBack: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			consenting.membershipId,
			"win_back",
			"e2e-consenting-win-back",
		),
	}));
	for (const [name, id] of Object.entries(queued)) {
		expect(id, `${name} is queued while both consents stand`).not.toBeNull();
	}
	const waiting = await withSql((sql) => customerMessages(sql, tenantId));
	expect(waiting.map((row) => `${row.kind}:${row.status}`).sort()).toEqual([
		"birthday:queued",
		"coupon_issued:queued",
		"win_back:queued",
		"win_back:queued",
	]);

	await signedIn(page, "owner");
	const answers = recordDataApi(page);
	await page.goto("/#/khach-hang/tra-cuu-du-lieu");
	await page
		.getByTestId("privacy-lookup-input")
		.fill(`0${PROMOTION_PHONES.optedOut.slice(COUNTRY.length)}`);
	await page.getByTestId("privacy-lookup-submit").click();
	await expect(page.getByTestId("privacy-subject-phone")).toHaveText(
		"•••• ••• 204",
	);
	await expect(page.getByTestId("privacy-consent")).toHaveCount(2);
	await expectNoFullPhone(page);
	const marketing = page
		.getByTestId("privacy-consent")
		.and(page.locator('[data-purpose="marketing"]'));
	await marketing.getByTestId("privacy-revoke").click();
	await marketing.getByTestId("privacy-revoke-yes").click();
	await expect(page.getByTestId("privacy-revoke-done")).toContainText(
		"Đã rút đồng ý Tin khuyến mại.",
	);
	await expectNoFullPhone(page);

	const [consent] = await withSql(
		(sql) => sql<
			{
				opted_out_marketing: boolean;
				opted_out_loyalty: boolean;
				consenting_marketing: boolean;
			}[]
		>`
			select
				app.has_active_consent(${tenantId}::uuid, 'customer', ${optedOut.customerId}::uuid, 'marketing') as opted_out_marketing,
				app.has_active_consent(${tenantId}::uuid, 'customer', ${optedOut.customerId}::uuid, 'loyalty') as opted_out_loyalty,
				app.has_active_consent(${tenantId}::uuid, 'customer', ${consenting.customerId}::uuid, 'marketing') as consenting_marketing
		`,
	);
	expect(consent).toEqual({
		opted_out_marketing: false,
		opted_out_loyalty: true,
		consenting_marketing: true,
	});

	const claimed = await withSql((sql) =>
		drainCustomerMessages(sql, tenantId, world.noon),
	);
	expect(
		claimed.map((claim) => claim.messageId).sort(),
		"only the coupon of the opted-out member and the win-back of the other member reach the provider",
	).toEqual([queued.optedOutCoupon, queued.consentingWinBack].sort());
	expect(claimed.map((claim) => claim.route)).toEqual(["template", "template"]);
	const sent = await withSql((sql) => customerMessages(sql, tenantId));
	expect({
		"opted out, win_back": outcomeOf(
			messageOf(sent, optedOut.customerId, "win_back"),
		),
		"opted out, birthday": outcomeOf(
			messageOf(sent, optedOut.customerId, "birthday"),
		),
		"opted out, coupon_issued": outcomeOf(
			messageOf(sent, optedOut.customerId, "coupon_issued"),
		),
		"consenting, win_back": outcomeOf(
			messageOf(sent, consenting.customerId, "win_back"),
		),
	}).toEqual({
		"opted out, win_back": "cancelled:mini_app:no_marketing_consent",
		"opted out, birthday": "cancelled:mini_app:no_marketing_consent",
		"opted out, coupon_issued": "sent:zalo_zbs:send",
		"consenting, win_back": "sent:zalo_zbs:send",
	});
	for (const kind of ["win_back", "birthday"]) {
		const cancelled = messageOf(sent, optedOut.customerId, kind);
		expect(cancelled, `${kind} was never claimed or sent`).toMatchObject({
			attempts: 0,
			was_sent: false,
			hold_reason: null,
			last_error_code: null,
			consent_purpose: "marketing",
			consent_revoked: true,
		});
		expect(cancelled.recipient_ref).toBe(`membership:${optedOut.membershipId}`);
		expect(Object.keys(cancelled.params ?? {}).sort()).toEqual(
			kind === "win_back"
				? ["inactive_days", "membership_id"]
				: ["membership_id"],
		);
	}
	expect(messageOf(sent, consenting.customerId, "win_back")).toMatchObject({
		attempts: 1,
		was_sent: true,
		consent_purpose: "marketing",
		consent_revoked: false,
	});
	expect(
		await withSql((sql) => drainCustomerMessages(sql, tenantId, world.noon)),
		"a cancelled message is final: the second drain has nothing to claim",
	).toEqual([]);

	const after = await withSql(async (sql) => ({
		winBack: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"win_back",
			"e2e-opt-out-win-back-again",
		),
		birthday: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"birthday",
			"e2e-opt-out-birthday-again",
		),
		coupon: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			optedOut.membershipId,
			"coupon_issued",
			"e2e-opt-out-coupon-again",
		),
		consentingWinBack: await enqueueCustomerMessage(
			sql,
			tenantId,
			world,
			consenting.membershipId,
			"win_back",
			"e2e-consenting-win-back-again",
		),
	}));
	expect(after.winBack, "no win-back is queued after the opt-out").toBeNull();
	expect(after.birthday, "no birthday message is queued either").toBeNull();
	expect(
		after.coupon,
		"the loyalty consent still queues a coupon",
	).not.toBeNull();
	expect(after.consentingWinBack).not.toBeNull();
	const final = await withSql((sql) => customerMessages(sql, tenantId));
	expect(
		final.filter(
			(row) =>
				row.subject_id === optedOut.customerId &&
				(row.kind === "win_back" || row.kind === "birthday"),
		),
	).toHaveLength(2);

	const exchanges = await answers();
	expect(
		exchanges
			.filter((exchange) => exchange.url.includes("/rpc/dsr_lookup"))
			.map((exchange) => exchange.method),
	).toContain("POST");
	expectNoPhoneInUrls(exchanges);
	for (const { body } of exchanges) {
		for (const phone of ALL_PHONES) expect(body).not.toContain(phone);
	}
	const everything = final.map((row) => row.whole).join("\n");
	for (const phone of ALL_PHONES) {
		expect(everything).not.toContain(phone);
		expect(everything).not.toContain(phone.slice(COUNTRY.length));
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
