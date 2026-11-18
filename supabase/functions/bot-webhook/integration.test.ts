import { sha256Hex } from "@fnb/notify";
import { createPostgresClient, isLocalDatabaseUrl } from "@fnb/sync/postgres";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	closeWebhookDatabases,
	webhookDatabase,
} from "../oa-webhook/database.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";
import { PostgresBotWebhookStore } from "./database.ts";
import {
	createBotWebhookHandler,
	FUNCTION_NAME,
	SECRET_TOKEN_HEADER,
	STOP_CONFIRMATION,
} from "./handler.ts";

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
const SLUG = "zalo-it-bot-webhook";
const MEMBER_EMAIL = "zalo-it-bot-webhook-member@example.com";
const SECRET_NAME = "NOTIFY_ZALO_BOT_TOKEN_ZIT";
const BOT_TOKEN = "synthetic-bot-token-zit";
const SECRET_TOKEN = "synthetic-webhook-secret-token-zit-0001";
const CHAT_ID = "zalo-it-chat-0001";
const OTHER_CHAT = "zalo-it-chat-0002";
const BASE_URL = "http://127.0.0.1:8799";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/bot-webhook";

type Sql = ReturnType<typeof createPostgresClient>;

async function removeFixture(sql: Sql): Promise<void> {
	await sql`delete from public.tenants where slug = ${SLUG}`;
	await sql`delete from auth.users where email = ${MEMBER_EMAIL}`;
	await sql`delete from app.bot_poll_state where secret_name = ${SECRET_NAME}`;
}

function update(text: string, chatId = CHAT_ID) {
	return {
		ok: true,
		result: {
			event_name: "message.text.received",
			message: {
				from: { id: chatId, display_name: "Synthetic member", is_bot: false },
				chat: { id: chatId, chat_type: "PRIVATE" },
				text,
				message_id: `zalo-it-message-${crypto.randomUUID()}`,
				date: Date.now(),
			},
		},
	};
}

Deno.test({
	name: "bot-webhook against the local database: link, ĐỒNG Ý, DỪNG once, wrong token, unrelated chat",
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
			[SECRET_NAME]: BOT_TOKEN,
			NOTIFY_ZALO_BOT_BASE_URL: BASE_URL,
		};
		const pending: Promise<unknown>[] = [];
		const lines: string[] = [];
		const sent: { url: string; body: unknown }[] = [];
		const handler = createBotWebhookHandler({
			store: (env, context) =>
				new PostgresBotWebhookStore(
					webhookDatabase(env, context, "fnb-bot-webhook-it"),
				),
			clock: () => new Date(),
			waitUntil: (promise) => {
				pending.push(promise);
			},
			fetch: async (url, init) => {
				sent.push({ url, body: JSON.parse(String(init.body)) });
				return new Response(
					JSON.stringify({
						ok: true,
						result: { message_id: "zalo-it-reply-1" },
					}),
					{
						status: 200,
					},
				);
			},
		});
		const post = async (body: unknown, token = SECRET_TOKEN) => {
			const response = await serveFunction(
				new Request(FUNCTION_URL, {
					method: "POST",
					body: JSON.stringify(body),
					headers: { [SECRET_TOKEN_HEADER]: token },
				}),
				environment,
				handler,
				{ name: FUNCTION_NAME, origins: [], log: (line) => lines.push(line) },
			);
			await Promise.all(pending.splice(0));
			return response.status;
		};
		try {
			await removeFixture(sql);
			const [tenant] = await sql<{ id: string }[]>`
				insert into public.tenants (slug, name) values (${SLUG}, 'Zalo IT bot webhook') returning id::text as id
			`;
			assert(tenant, "tenant");
			const [user] = await sql<{ id: string }[]>`
				insert into auth.users (id, instance_id, aud, role, email)
				values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${MEMBER_EMAIL})
				returning id::text as id
			`;
			assert(user, "user");
			await sql`insert into public.tenant_members (tenant_id, user_id, role) values (${tenant.id}::uuid, ${user.id}::uuid, 'manager')`;
			const [destination] = await sql<{ id: string }[]>`
				insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name)
				values (${tenant.id}::uuid, 'zalo_bot', 'zalo_bot', 'synthetic bot chat', ${user.id}::uuid, ${SECRET_NAME})
				returning id::text as id
			`;
			assert(destination, "destination");
			const [issued] = await sql<{ code: string }[]>`
				select app.issue_link_code(${destination.id}::uuid, 'bot_link', now()) as code
			`;
			assert(issued, "code");
			await sql`select app.set_bot_webhook(${SECRET_NAME}, ${await sha256Hex(SECRET_TOKEN)}, now())`;
			const [lease] = await sql<{ taken: boolean }[]>`
				select app.take_poll_lease(${SECRET_NAME}, 'zalo_bot', 'zalo-it-worker', interval '30 seconds', now()) as taken
			`;
			assertEquals(
				lease?.taken,
				false,
				"the poller refuses the bot after setWebhook",
			);
			const state = async () => {
				const [row] = await sql<{ state: string }[]>`
					select concat_ws('|',
						(select c.status || ':' || coalesce(c.address, '-') || ':' || coalesce(c.disabled_reason, '-') from public.notification_channels c where c.id = ${destination.id}::uuid),
						(select count(*) from public.consent_records r where r.tenant_id = ${tenant.id}::uuid and r.subject_id = ${user.id}::uuid and r.purpose = 'notifications' and r.revoked_at is null),
						(select string_agg(o.kind || ':' || o.status, ',' order by o.created_at, o.kind) from public.outbound_messages o where o.tenant_id = ${tenant.id}::uuid and o.kind is not null)
					) as state
				`;
				return row?.state ?? "";
			};

			assertEquals(
				await post(update(issued.code), "synthetic-wrong-secret-token-zit"),
				401,
				"a wrong secret token gets 401",
			);
			assertEquals(
				await state(),
				"pending:-:-|0",
				"the refused update changed nothing",
			);

			assertEquals(
				await post(update(`mã ${issued.code}`)),
				200,
				"the link code is answered 200",
			);
			assertEquals(
				await state(),
				`pending:${CHAT_ID}:-|0|link_notice:queued`,
				"the code links the chat and queues the notice",
			);

			await sql`update app.notification_link_codes set notice_sent_at = now() where channel_id = ${destination.id}::uuid`;
			assertEquals(await post(update("Đồng ý")), 200, "ĐỒNG Ý is answered 200");
			assertEquals(
				await state(),
				`active:${CHAT_ID}:-|1|link_notice:queued,link_confirmation:queued`,
				"ĐỒNG Ý activates the destination and records the consent",
			);

			await sql`
				select app.enqueue_message(${tenant.id}::uuid, ${destination.id}::uuid, 'test', 'test.v1', 'zalo-it:waiting', '{}'::jsonb,
					null, null, null, null, null, null, null, now() + interval '1 day', now())
			`;
			const before = await state();
			assertEquals(
				await post(update("DỪNG", OTHER_CHAT)),
				200,
				"DỪNG from an unrelated chat is answered 200",
			);
			assertEquals(
				await post(update("xin chào")),
				200,
				"other text is answered 200",
			);
			assertEquals(
				await state(),
				before,
				"an unrelated chat's update leaves no row",
			);

			assertEquals(await post(update("DỪNG")), 200, "DỪNG is answered 200");
			assertEquals(
				await state(),
				`disabled:${CHAT_ID}:consent_withdrawn|0|link_notice:cancelled,link_confirmation:cancelled,test:cancelled`,
				"DỪNG withdraws the consent and cancels everything waiting",
			);
			assertEquals(
				sent,
				[
					{
						url: `${BASE_URL}/bot${BOT_TOKEN}/sendMessage`,
						body: { chat_id: CHAT_ID, text: STOP_CONFIRMATION },
					},
				],
				"one confirmation",
			);
			const [logged] = await sql<{ entry: string }[]>`
				select string_agg(o.recipient_ref || ':' || o.status || ':' || o.template_ref, ',') as entry
				from public.outbound_messages o where o.tenant_id = ${tenant.id}::uuid and o.kind is null
			`;
			assertEquals(
				logged?.entry,
				`channel:${destination.id}:sent:stop_confirmation.v1`,
				"the confirmation is logged with an opaque recipient",
			);

			assertEquals(
				await post(update("dung")),
				200,
				"a second stop is answered 200",
			);
			assertEquals(sent.length, 1, "and confirmed only once");

			for (const line of lines) {
				for (const secret of [
					CHAT_ID,
					OTHER_CHAT,
					issued.code,
					BOT_TOKEN,
					SECRET_TOKEN,
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
