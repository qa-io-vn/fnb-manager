import { createPostgresClient, isLocalDatabaseUrl } from "@fnb/sync/postgres";
import { createMockZalo } from "@fnb/zalo/testing";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";
import { closeWebhookDatabases, webhookDatabase } from "./database.ts";
import {
	ACK_DEADLINE_MS,
	createOaWebhookHandler,
	FUNCTION_NAME,
} from "./handler.ts";
import { oaSignature, SIGNATURE_HEADER } from "./signature.ts";
import { PostgresOaWebhookStore } from "./store.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

function integrationDatabaseUrl(): string | null {
	if (Deno.permissions.querySync({ name: "env" }).state !== "granted") {
		return null;
	}
	const url = Deno.env.get("DATABASE_URL") ?? "";
	return Deno.env.get("ZALO_INTEGRATION") === "1" && url !== "" ? url : null;
}

const DATABASE_URL = integrationDatabaseUrl();
const SLUG = "zalo-it-oa-webhook";
const MEMBER_EMAIL = "zalo-it-oa-webhook-member@example.com";
const APP_ID = "zalo-it-app-oa-webhook";
const OA_ID = "zalo-it-oa-webhook";
const USER_ID = "zalo-it-oa-user-1";
const SECRET_NAME = "ZALO_OA_SECRET_BRAND_1";
const SECRET = "synthetic-oa-secret-key";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/oa-webhook";

type Sql = ReturnType<typeof createPostgresClient>;

interface Fixture {
	readonly tenantId: string;
	readonly oaRowId: string;
	readonly destinationId: string;
}

async function removeFixture(sql: Sql): Promise<void> {
	await sql`delete from public.tenants where slug = ${SLUG}`;
	await sql`delete from auth.users where email = ${MEMBER_EMAIL}`;
}

async function createFixture(sql: Sql): Promise<Fixture> {
	const [tenant] = await sql<{ id: string }[]>`
		insert into public.tenants (slug, name) values (${SLUG}, 'Zalo IT OA webhook') returning id::text as id
	`;
	assert(tenant, "tenant");
	const [user] = await sql<{ id: string }[]>`
		insert into auth.users (id, instance_id, aud, role, email)
		values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${MEMBER_EMAIL})
		returning id::text as id
	`;
	assert(user, "user");
	await sql`
		insert into public.tenant_members (tenant_id, user_id, role) values (${tenant.id}::uuid, ${user.id}::uuid, 'manager')
	`;
	const [store] = await sql<{ id: string }[]>`
		with account as (
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenant.id}::uuid, 'mock', 'zalo-it-oa-webhook-account', 'Synthetic account')
			returning id
		)
		insert into public.stores (tenant_id, pos_account_id, external_id, name)
		select ${tenant.id}::uuid, account.id, 'zalo-it-oa-webhook-store', 'Synthetic store' from account
		returning id::text as id
	`;
	assert(store, "store");
	const [brand] = await sql<{ id: string }[]>`
		insert into public.brands (tenant_id, brand_key, display_name, store_ids)
		values (${tenant.id}::uuid, 'brand-1', 'Synthetic brand', array[${store.id}::uuid])
		returning id::text as id
	`;
	assert(brand, "brand");
	await sql`
		insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
		values (${tenant.id}::uuid, ${brand.id}::uuid, ${APP_ID}, 'ZALO_APP_SECRET_BRAND_1')
	`;
	const [oa] = await sql<{ id: string }[]>`
		insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
		values (${tenant.id}::uuid, ${brand.id}::uuid, ${OA_ID}, 'tang_truong', true, ${SECRET_NAME})
		returning id::text as id
	`;
	assert(oa, "oa");
	const [destination] = await sql<{ id: string }[]>`
		insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
		values (${tenant.id}::uuid, 'zalo_oa', 'zalo_oa', 'synthetic OA chat', ${user.id}::uuid, ${USER_ID}, 'NOTIFY_ZALO_OA_BRAND_1', 'active', now())
		returning id::text as id
	`;
	assert(destination, "destination");
	return { tenantId: tenant.id, oaRowId: oa.id, destinationId: destination.id };
}

function event(
	eventName: string,
	at: number,
	extra: Record<string, unknown>,
): string {
	return JSON.stringify({
		app_id: APP_ID,
		user_id_by_app: "zalo-it-app-user-1",
		event_name: eventName,
		timestamp: String(at),
		sender: { id: USER_ID },
		recipient: { id: OA_ID },
		...extra,
	});
}

async function signedRequest(body: string, secret = SECRET): Promise<Request> {
	const timestamp = String(JSON.parse(body).timestamp);
	const mac = await oaSignature(APP_ID, body, timestamp, secret);
	return new Request(FUNCTION_URL, {
		method: "POST",
		body,
		headers: { [SIGNATURE_HEADER]: `mac=${mac}` },
	});
}

Deno.test({
	name: "oa-webhook against the local database: verified, logged once, followed up, refused in enforce mode",
	ignore: DATABASE_URL === null,
	async fn() {
		assert(DATABASE_URL !== null, "gated");
		assert(
			isLocalDatabaseUrl(DATABASE_URL),
			"the integration suite runs only against the local stack",
		);
		const sql = createPostgresClient(DATABASE_URL, {
			maxConnections: 1,
			socket: denoPostgresSocket(),
			fetchTypes: false,
		});
		const environment: FunctionEnvironment = {
			SUPABASE_DB_URL: DATABASE_URL,
			[SECRET_NAME]: SECRET,
		};
		const pending: Promise<unknown>[] = [];
		const lines: string[] = [];
		const handler = createOaWebhookHandler({
			store: (env, context) =>
				new PostgresOaWebhookStore(
					webhookDatabase(env, context, "fnb-oa-webhook-it"),
				),
			clock: () => new Date(),
			waitUntil: (promise) => {
				pending.push(promise);
			},
			ackDeadlineMs: ACK_DEADLINE_MS,
		});
		const send = async (request: Request) => {
			const started = performance.now();
			const response = await serveFunction(request, environment, handler, {
				name: FUNCTION_NAME,
				origins: [],
				log: (line) => lines.push(line),
			});
			const elapsed = performance.now() - started;
			await Promise.all(pending.splice(0));
			return { status: response.status, elapsed };
		};
		try {
			await removeFixture(sql);
			const fixture = await createFixture(sql);
			const outsideBefore = await sql<{ count: number }[]>`
				select count(*)::integer as count from public.oa_events where tenant_id <> ${fixture.tenantId}::uuid
			`;
			const lastInteraction = async () => {
				const [row] = await sql<{ at: Date | null }[]>`
					select last_interaction_at as at from public.notification_channels where id = ${fixture.destinationId}::uuid
				`;
				return row?.at?.getTime() ?? null;
			};
			const stored = async () => {
				const rows = await sql<{ event_name: string; signature: string }[]>`
					select event_name, signature from public.oa_events where oa_id = ${fixture.oaRowId}::uuid order by received_at, event_name
				`;
				return rows.map((row) => `${row.event_name}:${row.signature}`);
			};

			const sentAt = Date.now() - 60_000;
			const message = event("user_send_text", sentAt, {
				message: { text: "Xin chào quán", msg_id: "zalo-it-msg-1" },
			});
			const first = await send(await signedRequest(message));
			assertEquals(first.status, 200, "a signed message is answered 200");
			assert(
				first.elapsed < 2_000,
				`answered within 2 seconds, took ${first.elapsed} ms`,
			);
			const second = await send(await signedRequest(message));
			assertEquals(second.status, 200, "the second delivery is answered 200");
			assertEquals(
				await stored(),
				["user_send_text:raw"],
				"verified and logged once",
			);
			assertEquals(
				await lastInteraction(),
				sentAt,
				"a message moves last_interaction_at",
			);

			const tappedAt = sentAt + 1_000;
			const menu = event("user_send_text", tappedAt, {
				message: { text: "#menu-gio-mo-cua", msg_id: "zalo-it-msg-2" },
			});
			assertEquals(
				(await send(await signedRequest(menu))).status,
				200,
				"a menu tap",
			);
			assertEquals(
				await lastInteraction(),
				tappedAt,
				"a menu tap moves last_interaction_at",
			);

			const seen = event("user_seen_message", tappedAt + 1_000, {
				message: { msg_ids: ["zalo-it-msg-9"] },
			});
			assertEquals(
				(await send(await signedRequest(seen))).status,
				200,
				"a seen receipt",
			);
			assertEquals(
				await lastInteraction(),
				tappedAt,
				"an unrelated event does not move it",
			);

			const forged = event("user_send_text", tappedAt + 2_000, {
				message: { text: "giả mạo", msg_id: "zalo-it-msg-3" },
			});
			assertEquals(
				(await send(await signedRequest(forged, "another-secret"))).status,
				200,
				"observe mode accepts a wrong signature",
			);
			assertEquals(
				await stored(),
				[
					"user_send_text:raw",
					"user_send_text:raw",
					"user_seen_message:raw",
					"user_send_text:mismatch",
				],
				"observe mode stores the mismatch",
			);

			await sql`update public.oas set webhook_mode = 'enforce' where id = ${fixture.oaRowId}::uuid`;
			const refusedBody = event("user_send_text", tappedAt + 3_000, {
				message: { text: "giả mạo", msg_id: "zalo-it-msg-4" },
			});
			const refused = await send(
				await signedRequest(refusedBody, "another-secret"),
			);
			assertEquals(
				refused.status,
				401,
				"enforce mode answers 401 to a wrong signature",
			);
			const unsigned = await send(
				new Request(FUNCTION_URL, { method: "POST", body: refusedBody }),
			);
			assertEquals(
				unsigned.status,
				401,
				"enforce mode answers 401 to a missing signature",
			);
			const accepted = event("follow", tappedAt + 4_000, {
				oa_id: OA_ID,
				follower: { id: USER_ID },
				source: "testing_webhook",
			});
			assertEquals(
				(await send(await signedRequest(accepted))).status,
				200,
				"enforce mode accepts a signed follow",
			);
			assertEquals(
				(await stored()).length,
				5,
				"enforce mode stored only the signed follow",
			);
			assertEquals(
				await lastInteraction(),
				tappedAt + 4_000,
				"a follow moves last_interaction_at",
			);

			const counts = await sql<{ signature: string; events: number }[]>`
				select signature, sum(events)::integer as events from app.oa_event_days
				where oa_id = ${fixture.oaRowId}::uuid group by signature order by signature
			`;
			assertEquals(
				counts.map((row) => `${row.signature}:${row.events}`),
				["mismatch:1", "raw:4", "refused:2"],
				"the day counts",
			);

			const unknown = JSON.stringify({
				...JSON.parse(message),
				recipient: { id: "zalo-it-oa-unknown" },
			});
			assertEquals(
				(await send(await signedRequest(unknown))).status,
				200,
				"an unknown OA is answered 200",
			);
			assertEquals((await stored()).length, 5, "and stores nothing");

			const outsideAfter = await sql<{ count: number }[]>`
				select count(*)::integer as count from public.oa_events where tenant_id <> ${fixture.tenantId}::uuid
			`;
			assertEquals(
				outsideAfter[0]?.count,
				outsideBefore[0]?.count,
				"no other tenant's events changed",
			);
			for (const line of lines) {
				for (const secret of [
					USER_ID,
					OA_ID,
					APP_ID,
					SECRET,
					"Xin chào quán",
				]) {
					assert(
						!line.includes(secret),
						`a log line carries ${secret}: ${line}`,
					);
				}
			}
		} finally {
			await removeFixture(sql);
			await closeWebhookDatabases();
			await sql.end({ timeout: 5 });
		}
	},
});

const CUSTOMER_SLUG = "zalo-it-oa-customer";
const CUSTOMER_APP_ID = "zalo-it-app-oa-customer";
const CUSTOMER_OA_ID = "zalo-it-oa-customer";
const CUSTOMER_USER_ID = "zalo-it-oa-customer-user-1";
const CUSTOMER_PHONE = "0900000777";
const CUSTOMER_NAME = "Khách Thử Tích Hợp";
const JOINED_TEXT =
	"Bạn đã là thành viên; bật nhận tin trong ứng dụng nếu muốn.";

interface CustomerFixture {
	readonly tenantId: string;
	readonly oaRowId: string;
}

async function createCustomerFixture(
	sql: Sql,
	accessToken: string,
): Promise<CustomerFixture> {
	const [tenant] = await sql<{ id: string }[]>`
		insert into public.tenants (slug, name) values (${CUSTOMER_SLUG}, 'Zalo IT OA customer') returning id::text as id
	`;
	assert(tenant, "tenant");
	const [store] = await sql<{ id: string }[]>`
		with account as (
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenant.id}::uuid, 'mock', 'zalo-it-oa-customer-account', 'Synthetic account')
			returning id
		)
		insert into public.stores (tenant_id, pos_account_id, external_id, name)
		select ${tenant.id}::uuid, account.id, 'zalo-it-oa-customer-store', 'Synthetic store' from account
		returning id::text as id
	`;
	assert(store, "store");
	const [brand] = await sql<{ id: string }[]>`
		insert into public.brands (tenant_id, brand_key, display_name, store_ids)
		values (${tenant.id}::uuid, 'brand-1', 'Synthetic brand', array[${store.id}::uuid])
		returning id::text as id
	`;
	assert(brand, "brand");
	await sql`
		insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
		values (${tenant.id}::uuid, ${brand.id}::uuid, ${CUSTOMER_APP_ID}, 'ZALO_APP_SECRET_BRAND_1')
	`;
	const [oa] = await sql<{ id: string }[]>`
		insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
		values (${tenant.id}::uuid, ${brand.id}::uuid, ${CUSTOMER_OA_ID}, 'tang_truong', true, ${SECRET_NAME})
		returning id::text as id
	`;
	assert(oa, "oa");
	await sql`
		insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
		values (${tenant.id}::uuid, ${brand.id}::uuid, 'customer', 'zalo-it-mini-customer', true, 'Thẻ thành viên', 'Thành viên', 'Members', '#123456', '#000000', 'white', 'white')
	`;
	const buttons = JSON.stringify([
		{ action: "join", label: "Tham gia thành viên", target: "query" },
		{ action: "points", label: "Điểm của tôi", target: "mini_app" },
	]);
	await sql`
		select app.set_oa_menu(
			${tenant.id}::uuid, 'brand-1', ${buttons}::text::jsonb, true,
			'Cảm ơn bạn đã quan tâm.', ${JOINED_TEXT}, 'Bạn đã là thành viên rồi.',
			'Tham gia thành viên', 'Chia sẻ tên và số điện thoại để tích dấu.', 'https://example.com/brand-logo.png'
		)
	`;
	await sql`
		insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
		values (${tenant.id}::uuid, 'Synthetic programme', current_date - 30, 'below_threshold', 'active', 1)
	`;
	await sql`
		insert into public.legal_documents (tenant_id, kind, language, version, title, body_markdown, status, published_at)
		values (${tenant.id}::uuid, 'privacy_notice', 'vi', 'privacy-it-1', 'Chính sách bảo mật', 'Văn bản giữ chỗ.', 'published', now() - interval '1 day')
	`;
	await sql`
		insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token, refresh_expires_at)
		values (${tenant.id}::uuid, ${brand.id}::uuid, 'oa', ${accessToken}, now() + interval '20 hours', 'zalo-it-oa-refresh', now() + interval '80 days')
	`;
	return { tenantId: tenant.id, oaRowId: oa.id };
}

function customerEvent(
	eventName: string,
	at: number,
	extra: Record<string, unknown>,
): string {
	return JSON.stringify({
		app_id: CUSTOMER_APP_ID,
		oa_id: CUSTOMER_OA_ID,
		event_name: eventName,
		timestamp: String(at),
		...(eventName === "follow"
			? { follower: { id: CUSTOMER_USER_ID } }
			: {
					sender: { id: CUSTOMER_USER_ID },
					recipient: { id: CUSTOMER_OA_ID },
				}),
		...extra,
	});
}

async function signedCustomerRequest(body: string): Promise<Request> {
	const timestamp = String(JSON.parse(body).timestamp);
	const mac = await oaSignature(CUSTOMER_APP_ID, body, timestamp, SECRET);
	return new Request(FUNCTION_URL, {
		method: "POST",
		body,
		headers: { [SIGNATURE_HEADER]: `mac=${mac}` },
	});
}

Deno.test({
	name: "oa-webhook against the local database and the mock OA: welcome, form, enrolment, replay",
	ignore: DATABASE_URL === null,
	async fn() {
		assert(DATABASE_URL !== null, "gated");
		assert(
			isLocalDatabaseUrl(DATABASE_URL),
			"the integration suite runs only against the local stack",
		);
		const sql = createPostgresClient(DATABASE_URL, {
			maxConnections: 1,
			socket: denoPostgresSocket(),
			fetchTypes: false,
		});
		const mock = createMockZalo({ startAt: Date.now() });
		const { accessToken } = mock.issueTokens(CUSTOMER_APP_ID, "oa");
		const pending: Promise<unknown>[] = [];
		const lines: string[] = [];
		const handler = createOaWebhookHandler({
			store: (env, context) =>
				new PostgresOaWebhookStore(
					webhookDatabase(env, context, "fnb-oa-webhook-it"),
				),
			clock: () => new Date(),
			waitUntil: (promise) => {
				pending.push(promise);
			},
			ackDeadlineMs: ACK_DEADLINE_MS,
			fetch: mock.fetch,
		});
		try {
			await sql`delete from public.tenants where slug = ${CUSTOMER_SLUG}`;
			const fixture = await createCustomerFixture(sql, accessToken);
			const environment: FunctionEnvironment = {
				SUPABASE_DB_URL: DATABASE_URL,
				[SECRET_NAME]: SECRET,
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: fixture.tenantId,
				ZALO_OA_API_BASE_URL: "http://127.0.0.1:9",
				ZALO_OA_MESSAGES: "1",
			};
			const send = async (body: string) => {
				const response = await serveFunction(
					await signedCustomerRequest(body),
					environment,
					handler,
					{
						name: FUNCTION_NAME,
						origins: [],
						log: (line) => lines.push(line),
					},
				);
				await Promise.all(pending.splice(0));
				return response.status;
			};
			const counts = async () => {
				const [row] = await sql<{ counts: string }[]>`
					select concat_ws(':',
						(select count(*) from public.customers where tenant_id = ${fixture.tenantId}::uuid),
						(select count(*) from public.memberships where tenant_id = ${fixture.tenantId}::uuid and channel = 'oa_form'),
						(select count(*) from public.consent_records where tenant_id = ${fixture.tenantId}::uuid and purpose = 'loyalty' and channel = 'oa_form'),
						(select count(*) from public.consent_records where tenant_id = ${fixture.tenantId}::uuid and purpose = 'marketing'),
						(select count(*) from app.customer_oa_contacts where tenant_id = ${fixture.tenantId}::uuid)
					) as counts
				`;
				return row?.counts;
			};
			const kinds = () =>
				mock.oaMessages(CUSTOMER_APP_ID).map((message) => {
					const body = message.body.message as Record<string, unknown>;
					const attachment = body.attachment as
						| { payload?: { template_type?: string } }
						| undefined;
					return attachment?.payload?.template_type ?? String(body.text);
				});

			mock.oaInteraction(CUSTOMER_APP_ID, CUSTOMER_USER_ID);
			const start = Date.now() - 60_000;
			assertEquals(
				await send(
					customerEvent("follow", start, { source: "testing_webhook" }),
				),
				200,
				"the follow is answered",
			);
			assertEquals(kinds(), ["Cảm ơn bạn đã quan tâm."], "one welcome");

			assertEquals(
				await send(
					customerEvent("user_send_text", start + 1_000, {
						message: { text: "#join", msg_id: "zalo-it-join-1" },
					}),
				),
				200,
				"the join tap is answered",
			);
			assertEquals(
				kinds(),
				["Cảm ơn bạn đã quan tâm.", "request_user_info"],
				"the form follows the tap",
			);

			const submission = customerEvent("user_submit_info", start + 2_000, {
				info: {
					name: CUSTOMER_NAME,
					phone: CUSTOMER_PHONE,
					address: "Số 1 Đường Thử",
					user_dob: "01/01/2000",
				},
			});
			assertEquals(await send(submission), 200, "the form answer is answered");
			assertEquals(
				await counts(),
				"1:1:1:0:1",
				"one customer, membership, consent and tie, no marketing consent",
			);
			const [customer] = await sql<{ phone: string; name: string | null }[]>`
				select phone, name from public.customers where tenant_id = ${fixture.tenantId}::uuid
			`;
			assertEquals(
				[customer?.phone, customer?.name],
				[`+84${CUSTOMER_PHONE.slice(1)}`, CUSTOMER_NAME],
				"the customer record",
			);
			assertEquals(
				kinds(),
				["Cảm ơn bạn đã quan tâm.", "request_user_info", JOINED_TEXT],
				"the joined reply explains the opt-in",
			);

			assertEquals(await send(submission), 200, "the replay is answered");
			assertEquals(await counts(), "1:1:1:0:1", "the replay creates nothing");
			assertEquals(kinds().length, 3, "and sends nothing");

			const logged = await sql<{ template_ref: string; status: string }[]>`
				select template_ref, status from public.outbound_messages
				where tenant_id = ${fixture.tenantId}::uuid and channel = 'zalo_oa'
				order by created_at, template_ref
			`;
			assertEquals(
				logged.map((row) => `${row.template_ref}:${row.status}`),
				["oa_welcome.v1:sent", "oa_form.v1:sent", "oa_joined.v1:sent"],
				"every reply is logged without its text",
			);
			const steps = await sql<{ customer_step: string }[]>`
				select customer_step from public.oa_events where oa_id = ${fixture.oaRowId}::uuid order by occurred_at
			`;
			assertEquals(
				steps.map((row) => row.customer_step),
				["welcome", "form", "joined"],
				"each event ran its step once",
			);
			for (const line of lines) {
				for (const secret of [
					CUSTOMER_USER_ID,
					CUSTOMER_PHONE.slice(1),
					CUSTOMER_NAME,
					accessToken,
					SECRET,
				]) {
					assert(
						!line.includes(secret),
						`a log line carries ${secret}: ${line}`,
					);
				}
			}
		} finally {
			await sql`delete from public.tenants where slug = ${CUSTOMER_SLUG}`;
			await closeWebhookDatabases();
			await sql.end({ timeout: 5 });
		}
	},
});
