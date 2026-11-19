import { createPostgresClient, isLocalDatabaseUrl } from "@fnb/sync/postgres";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	closeWebhookDatabases,
	webhookDatabase,
} from "../oa-webhook/database.ts";
import { denoPostgresSocket } from "../sync-incremental/postgres-socket.ts";
import { PostgresVoucherCallbackStore } from "./database.ts";
import { createVoucherCallbackHandler, FUNCTION_NAME } from "./handler.ts";

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
	return Deno.env.get("VOUCHER_CALLBACK_INTEGRATION") === "1" && url !== ""
		? url
		: null;
}

const DATABASE_URL = integrationDatabaseUrl();
const SLUG = "it-loyalty-voucher-callback";
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/voucher-callback";

type Sql = ReturnType<typeof createPostgresClient>;

async function removeFixture(sql: Sql): Promise<void> {
	await sql`delete from public.tenants where slug = ${SLUG}`;
}

function payload(code: string, sale: string, amount: number) {
	return {
		Pos_Parent: "IT-BRAND",
		Pos_Id: "IT-POS-1",
		Coupon_Code: code,
		Membership_Id: null,
		Sale_Tran_Id: sale,
		Created_At: "2026-11-19 10:00:00",
		Code: 1,
		Date_Start: null,
		Date_End: null,
		Voucher_Order_Line: [
			{
				Item_Id: "IT-ITEM-A",
				Quantity: 2,
				Price_Sale: amount / 2,
				Amount: amount,
				Discount: 0,
			},
		],
	};
}

Deno.test({
	name: "voucher-callback against the local database: accept, replay, second use, wrong path, malformed",
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
		const environment: FunctionEnvironment = { SUPABASE_DB_URL: DATABASE_URL };
		const lines: string[] = [];
		const handler = createVoucherCallbackHandler({
			store: (env, context) =>
				new PostgresVoucherCallbackStore(
					webhookDatabase(env, context, "fnb-voucher-callback-it"),
				),
			clock: () => new Date(),
		});
		const post = async (segment: string, body: unknown) => {
			const response = await serveFunction(
				new Request(`${FUNCTION_URL}/${segment}`, {
					method: "POST",
					body: typeof body === "string" ? body : JSON.stringify(body),
					headers: { "x-forwarded-for": "203.0.113.9" },
				}),
				environment,
				handler,
				{ name: FUNCTION_NAME, origins: [], log: (line) => lines.push(line) },
			);
			const text = await response.text();
			return {
				status: response.status,
				body: text === "" ? {} : JSON.parse(text),
			};
		};
		try {
			await removeFixture(sql);
			const [fx] = await sql<
				{ tenant: string; store: string; member: string; coupon: string }[]
			>`
				with tenant as (
					insert into public.tenants (slug, name, country_code) values (${SLUG}, 'IT voucher callback', 'VN') returning id
				),
				account as (
					insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
					select id, 'mock', 'it-voucher-callback', 'IT account' from tenant returning id, tenant_id
				),
				store as (
					insert into public.stores (tenant_id, pos_account_id, external_id, name)
					select tenant_id, id, 'it-vc-1', 'IT store' from account returning id, tenant_id
				),
				customer as (
					insert into public.customers (tenant_id, phone) select id, '+' || '849000' || '00951' from tenant returning id, tenant_id
				),
				programme as (
					insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
					select id, 'IT programme', date '2026-01-01', 'below_threshold', 'active' from tenant returning id, tenant_id
				),
				membership as (
					insert into public.memberships (tenant_id, programme_id, customer_id, channel, joined_at)
					select p.tenant_id, p.id, c.id, 'mini_app', now() - interval '10 days' from programme p, customer c returning id, tenant_id, programme_id
				)
				select m.tenant_id::text as tenant, s.id::text as store, m.id::text as member, m.programme_id::text as coupon
				from membership m, store s
			`;
			assert(fx, "fixture");
			await sql`
				insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
				values (${fx.tenant}::uuid, ${fx.coupon}::uuid, ${fx.member}::uuid, 'adjust', 0, 100, 0, 'synthetic credit', now() + interval '30 days', now() - interval '5 days')
			`;
			await sql`
				insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from, callback_store_ref, callback_enabled)
				values (${fx.tenant}::uuid, ${fx.store}::uuid, 'crm_callback', '{IT-PROGRAMME}', now() - interval '30 days', 'IT-POS-1', true)
			`;
			await sql`
				insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
				values (${fx.tenant}::uuid, ${fx.store}::uuid, 'it-ten-pct', 'IT-PROGRAMME', 'discount')
			`;
			const [coupon] = await sql<{ id: string }[]>`
				insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_points, status)
				values (${fx.tenant}::uuid, ${fx.coupon}::uuid, 'it-ten-pct', 'IT ten percent', 'percent_off', 10, 10, 'active')
				returning id::text as id
			`;
			assert(coupon, "coupon");
			const [held] = await sql<{ code: string }[]>`
				select app.redeem_coupon(${fx.member}::uuid, ${coupon.id}::uuid, ${fx.store}::uuid, now() - interval '1 hour') ->> 'code' as code
			`;
			assert(held?.code, "a held code");
			const [path] = await sql<{ segment: string }[]>`
				select app.issue_voucher_callback_path(${fx.tenant}::uuid, 'it') as segment
			`;
			assert(path, "a path segment");

			const accepted = await post(
				path.segment,
				payload(held.code, "IT-SALE-1", 80000),
			);
			assertEquals(
				[accepted.status, accepted.body.Discount_Amount],
				[200, 8000],
				"accepted",
			);
			const replayed = await post(
				path.segment,
				payload(held.code, "IT-SALE-1", 500000),
			);
			assertEquals(
				[replayed.status, replayed.body.Discount_Amount],
				[200, 8000],
				"replayed",
			);
			const used = await post(
				path.segment,
				payload(held.code, "IT-SALE-2", 80000),
			);
			assertEquals(
				[
					used.status,
					used.body.Discount_Amount,
					used.body.Discount_Description,
				],
				[200, 0, "Mã đã được sử dụng"],
				"used",
			);
			const before = await sql<{ n: number }[]>`
				select count(*)::integer as n from app.voucher_callback_log where tenant_id = ${fx.tenant}::uuid
			`;
			const wrong = await post(
				`${path.segment.slice(0, 42)}${path.segment.endsWith("A") ? "B" : "A"}`,
				payload(held.code, "IT-SALE-3", 80000),
			);
			assertEquals(wrong.status, 404, "wrong path");
			const malformed = await post(path.segment, "{not json");
			assertEquals(malformed.status, 400, "malformed");
			const after = await sql<{ n: number }[]>`
				select count(*)::integer as n from app.voucher_callback_log where tenant_id = ${fx.tenant}::uuid
			`;
			assertEquals(
				[before[0]?.n, after[0]?.n],
				[3, 3],
				"a wrong path and a malformed body write no log row",
			);
			for (const line of lines) {
				assert(
					!line.includes(held.code) &&
						!line.includes(path.segment) &&
						!line.includes("IT-SALE"),
					"no value in the logs",
				);
			}
		} finally {
			await removeFixture(sql);
			await sql.end({ timeout: 5 });
			await closeWebhookDatabases();
		}
	},
});
