import { createHash, randomUUID } from "node:crypto";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CLI_CYCLE_LIMITS,
	createAdapterRegistry,
	createCycleBudget,
	runNotifyCycle,
	ZBS_TEMPLATE_DRAFTS,
	type ZbsTemplatePurpose,
} from "../../src/index.js";
import { createPostgresCustomerRepository } from "../../src/postgres/index.js";
import {
	createFixtureTenant,
	type FixtureTenant,
	type MockProviders,
	type MockZbsServer,
	startMockProviders,
	startMockZbs,
} from "../../src/testing/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.NOTIFY_INTEGRATION === "1" && Boolean(DATABASE_URL);
const OA_TOKEN = "synthetic-it-oa-access-token";
const TWO_MINUTES_MS = 120_000;
// Midday, inside every sending window of the seeded policies. The environment variable is only for proving that the
// test fails outside the hours (set it to 23); it is not used by the pack.
const TEST_LOCAL_HOUR = Number(process.env.NOTIFY_IT_LOCAL_HOUR ?? "12");

/**
 * A fixed-offset zone in which it is `localHour`:xx at `at`. The seeded channel policies send ZBS templates 06:00 to
 * 22:00 and OA messages 07:00 to 22:00 in the tenant's zone, so a test that ran late in the evening or at night would
 * find every message held (the Regression pack reached this file at 22:39 in Vietnam and five of six tests failed).
 * Living in a zone where it is about noon keeps the test independent of the time of day; the hours rule itself is
 * tested on its own, with a fixed clock, in pgTAP.
 */
function zoneWhereItIs(localHour: number, at: Date): string {
	let offset = localHour - at.getUTCHours();
	if (offset > 12) offset -= 24;
	if (offset < -11) offset += 24;
	if (offset === 0) return "Etc/GMT";
	return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

interface Ids {
	brand: string;
	oa: string;
	programme: string;
	coupon: string;
	customers: Record<"a" | "b" | "c" | "d", string>;
	members: Record<"a" | "b" | "c" | "d", string>;
}

interface Row {
	status: string;
	channel: string;
	template_ref: string | null;
	params: Record<string, unknown> | null;
	title: string | null;
	body: string | null;
	recipient_ref: string;
}

describe.skipIf(!ENABLED)("customer messages on the local stack", () => {
	let sql: Sql;
	let mock: MockProviders;
	let zbs: MockZbsServer;
	let fixture: FixtureTenant;
	let ids: Ids;
	const oaUser = `syn-it-oa-${randomUUID().slice(0, 8)}`;
	let clockOffsetMs = 0;

	const cycle = (requestTimeoutMs = 10_000) =>
		runNotifyCycle({
			repository: fixture.repository(),
			customers: createPostgresCustomerRepository(sql),
			adapters: createAdapterRegistry(),
			environment: { ...fixture.environment, ...zbs.environment() },
			runtime: "cli",
			worker: "it-customers",
			tenantId: fixture.tenantId,
			clock: () => new Date(Date.now() + clockOffsetMs),
			fetch: (input, init) => fetch(input, init),
			log: () => undefined,
			budget: createCycleBudget({ ...CLI_CYCLE_LIMITS, linkPollSeconds: 0 }),
			runSqlTick: false,
			dryRun: false,
			requestTimeoutMs,
			sleep: async () => undefined,
		});

	const rowsFor = async (member: string, kind: string): Promise<Row[]> =>
		sql<Row[]>`
			select status, channel, template_ref, params, title, body, recipient_ref
			from public.outbound_messages
			where tenant_id = ${fixture.tenantId}::uuid and kind = ${kind} and recipient_ref = ${`membership:${member}`}
			order by created_at
		`;

	const holdReward = async (member: string, code: string): Promise<string> => {
		const [row] = await sql<{ id: string }[]>`
			insert into public.redemptions (tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at)
			values (${fixture.tenantId}::uuid, ${fixture.storeIds[0] ?? ""}::uuid, ${member}::uuid, ${ids.coupon}::uuid, ${code}, 'held', now(), now() + interval '20 hours')
			returning id::text as id
		`;
		return row?.id ?? "";
	};

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 4,
			applicationName: "notify-it-customers",
		});
		const [databaseClock] = await sql<
			{ now: Date }[]
		>`select clock_timestamp() as now`;
		clockOffsetMs =
			Math.max((databaseClock?.now.getTime() ?? Date.now()) - Date.now(), 0) +
			1000;
		mock = await startMockProviders();
		zbs = await startMockZbs();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 0,
		});
		const tenant = fixture.tenantId;
		const store = fixture.storeIds[0] ?? "";
		await sql`
			update public.tenants
			set timezone = ${zoneWhereItIs(TEST_LOCAL_HOUR, new Date())}
			where id = ${tenant}::uuid
		`;
		const [setup] = await sql<
			{ brand: string; oa: string; programme: string; coupon: string }[]
		>`
			with brand as (
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				values (${tenant}::uuid, 'brand-1', 'Synthetic brand', array[${store}::uuid])
				returning id
			),
			oa as (
				insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
				select ${tenant}::uuid, brand.id, ${`syn-it-oa-${tenant.slice(0, 8)}`}, 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from brand
				returning id
			),
			programme as (
				insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
				values (${tenant}::uuid, 'Synthetic programme', date '2026-01-01', 'below_threshold', 'active')
				returning id
			),
			coupon as (
				insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_points)
				select ${tenant}::uuid, programme.id, 'free-drink', 'Một ly nước miễn phí', 10 from programme
				returning id
			)
			select brand.id::text as brand, oa.id::text as oa, programme.id::text as programme, coupon.id::text as coupon
			from brand, oa, programme, coupon
		`;
		if (setup === undefined) {
			throw new Error("the customer fixture was not created");
		}
		const customers = {} as Record<"a" | "b" | "c" | "d", string>;
		const members = {} as Record<"a" | "b" | "c" | "d", string>;
		const tails = { a: "201", b: "202", c: "203", d: "204" } as const;
		for (const key of ["a", "b", "c", "d"] as const) {
			const [customer] = await sql<{ customer: string; member: string }[]>`
				with customer as (
					insert into public.customers (tenant_id, phone, name)
					values (${tenant}::uuid, ${`0900000${tails[key]}`}, ${`Synthetic ${key.toUpperCase()}`})
					returning id
				),
				member as (
					insert into public.memberships (tenant_id, programme_id, customer_id, channel, brand_id, joined_at)
					select ${tenant}::uuid, ${setup.programme}::uuid, customer.id, 'mini_app', ${setup.brand}::uuid, now() - interval '90 days' from customer
					returning id
				)
				select customer.id::text as customer, member.id::text as member from customer, member
			`;
			customers[key] = customer?.customer ?? "";
			members[key] = customer?.member ?? "";
			const purposes =
				key === "d" || key === "a" ? ["loyalty", "marketing"] : ["loyalty"];
			for (const purpose of purposes) {
				await sql`
					insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
					values (${tenant}::uuid, 'customer', ${customers[key]}::uuid, ${purpose}::public.consent_purpose, 'synthetic-v1', 'mini_app', now() - interval '90 days')
				`;
			}
		}
		ids = { ...setup, customers, members };
		await sql`
			insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token)
			values (${tenant}::uuid, ${ids.brand}::uuid, 'oa', ${OA_TOKEN}, now() + interval '1 day', 'synthetic-it-refresh')
		`;
		await sql`
			insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled, points_route)
			values (${tenant}::uuid, true, true, false, 'template')
		`;
		for (const purpose of [
			"points_confirmation",
			"voucher",
			"win_back",
		] as ZbsTemplatePurpose[]) {
			const external = `syn-it-${purpose}`;
			await sql`
				insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
				values (${tenant}::uuid, ${ids.oa}::uuid, ${external}, ${ZBS_TEMPLATE_DRAFTS[purpose].tag}, ${purpose}, 'approved')
			`;
			zbs.registerTemplate(
				external,
				ZBS_TEMPLATE_DRAFTS[purpose].parameters.map(
					(parameter) => parameter.name,
				),
			);
		}
		zbs.registerToken(OA_TOKEN);
		await sql`select app.link_customer_oa_user(${ids.oa}::uuid, ${oaUser}, ${ids.customers.a}::uuid, now())`;
		await sql`
			insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
			values (${tenant}::uuid, ${ids.oa}::uuid, ${createHash("sha256").update(`${oaUser}:it`).digest("hex")}, 'user_send_text', ${oaUser}, now() - interval '1 hour', now() - interval '1 hour', 'raw')
		`;
		zbs.openWindow(oaUser);
	}, 120_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await zbs?.close();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("a voucher issued in the Mini App arrives as a template message within one cycle", async () => {
		const started = Date.now();
		const redemption = await holdReward(
			ids.members.b,
			`SYNIT${randomUUID().slice(0, 4).toUpperCase()}`,
		);
		const before = zbs.templates().length;
		const report = await cycle();
		expect(Date.now() - started).toBeLessThan(TWO_MINUTES_MS);
		expect(report.get("customer_sent")).toBeGreaterThanOrEqual(1);
		const sent = zbs.templates().slice(before);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			templateId: "syn-it-voucher",
			phone: `84${"900000"}202`,
			userId: null,
		});
		expect(sent[0]?.data).toMatchObject({
			customer_name: "Synthetic B",
			reward_name: "Một ly nước miễn phí",
		});
		const [row] = await rowsFor(ids.members.b, "coupon_issued");
		expect(row?.status).toBe("sent");
		expect(row?.channel).toBe("zalo_zbs");
		expect(row?.template_ref).toBe("zbs.voucher.v1");
		expect(row?.params?.redemption_id).toBe(redemption);
	}, 60_000);

	it("a customer who messaged the OA gets the free confirmation and no paid template", async () => {
		const consultationsBefore = zbs.consultations().length;
		const templatesBefore = zbs.templates().length;
		await holdReward(
			ids.members.a,
			`SYNIT${randomUUID().slice(0, 4).toUpperCase()}`,
		);
		await cycle();
		const consultations = zbs.consultations().slice(consultationsBefore);
		expect(consultations).toHaveLength(1);
		expect(consultations[0]?.userId).toBe(oaUser);
		expect(consultations[0]?.text).toContain("Chào Synthetic A");
		expect(zbs.templates()).toHaveLength(templatesBefore);
		const [row] = await rowsFor(ids.members.a, "coupon_issued");
		expect(row).toMatchObject({ status: "sent", channel: "zalo_oa" });
		expect(row?.params?.window).toBe("free");
	}, 60_000);

	it("a points confirmation outside any window goes as the template", async () => {
		const [invoice] = await sql<{ id: string }[]>`
			insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, business_date, sold_at, gross_amount, net_amount, paid_amount, receipt_no)
			values (${fixture.tenantId}::uuid, ${fixture.storeIds[0] ?? ""}::uuid, ${fixture.accountId}::uuid, ${`it-${randomUUID()}`}, current_date, now(), 60000, 60000, 60000, '004321')
			returning id::text as id
		`;
		await sql`
			insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, invoice_id, business_date, matched_path)
			values (${fixture.tenantId}::uuid, ${ids.programme}::uuid, ${ids.members.b}::uuid, ${fixture.storeIds[0] ?? ""}::uuid, 'earn', 1, 6, ${invoice?.id ?? ""}::uuid, current_date, 'A')
		`;
		const before = zbs.templates().length;
		await cycle();
		const sent = zbs.templates().slice(before);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.templateId).toBe("syn-it-points_confirmation");
		expect(sent[0]?.data).toMatchObject({
			bill_no: "004321",
			points: "6",
			stamps: "1",
		});
	}, 60_000);

	it("a provider timeout leaves the message uncertain and it is never resent", async () => {
		zbs.failNext("/message/template", { kind: "accept_then_hang" });
		await holdReward(
			ids.members.b,
			`SYNIT${randomUUID().slice(0, 4).toUpperCase()}`,
		);
		const before = zbs.templates().length;
		await cycle(300);
		expect(zbs.templates()).toHaveLength(before + 1);
		const rows = await rowsFor(ids.members.b, "coupon_issued");
		expect(rows.at(-1)?.status).toBe("uncertain");
		await cycle();
		expect(zbs.templates()).toHaveLength(before + 1);
		expect((await rowsFor(ids.members.b, "coupon_issued")).at(-1)?.status).toBe(
			"uncertain",
		);
	}, 60_000);

	it("nothing promotional reaches a customer without marketing consent", async () => {
		await sql`update app.customer_message_settings set promotions_enabled = true where tenant_id = ${fixture.tenantId}::uuid`;
		const [refused] = await sql<{ id: string | null }[]>`
			select app.enqueue_customer_message(${fixture.tenantId}::uuid, ${ids.members.c}::uuid, 'win_back', ${`it-${randomUUID()}`}, '{"inactive_days": 45}'::jsonb, null, null, now())::text as id
		`;
		expect(refused?.id).toBeNull();
		await sql`
			select app.enqueue_customer_message(${fixture.tenantId}::uuid, ${ids.members.d}::uuid, 'win_back', ${`it-${randomUUID()}`}, '{"inactive_days": 45}'::jsonb, null, null, now())
		`;
		const before = zbs.templates().length;
		await cycle();
		const sent = zbs.templates().slice(before);
		expect(sent.map((message) => message.templateId)).toEqual([
			"syn-it-win_back",
		]);
		expect(sent[0]?.phone).toBe(`84${"900000"}204`);
		expect(await rowsFor(ids.members.c, "win_back")).toHaveLength(0);
	}, 60_000);

	it("a member's takeaway order turned ready at the counter arrives as the order_ready template (C17)", async () => {
		const tenant = fixture.tenantId;
		const store = fixture.storeIds[0] ?? "";
		const user = randomUUID();
		const external = "syn-it-order_ready";
		await sql`
			insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
			values (${tenant}::uuid, ${ids.oa}::uuid, ${external}, ${ZBS_TEMPLATE_DRAFTS.order_ready.tag}, 'order_ready', 'approved')
		`;
		zbs.registerTemplate(
			external,
			ZBS_TEMPLATE_DRAFTS.order_ready.parameters.map(
				(parameter) => parameter.name,
			),
		);
		await sql`
			insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
			values (${user}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
				${`notify-it-${user.slice(0, 8)}@example.com`}, ${JSON.stringify({ kind: "customer", tenant_id: tenant })}::jsonb)
		`;
		try {
			const [order] = await sql<{ id: string }[]>`
				with app as (
					insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name, status)
					values (${tenant}::uuid, ${ids.brand}::uuid, ${`syn-it-app-${tenant.slice(0, 8)}`}, 'ZALO_APP_SECRET_BRAND_1', 'active')
					returning id
				),
				login as (
					insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
					select ${tenant}::uuid, app.id, ${`syn-it-${user.slice(0, 8)}`}, ${user}::uuid, ${ids.customers.c}::uuid from app
					returning id
				)
				insert into public.orders (tenant_id, brand_id, store_id, source, customer_login_id, order_type, pickup_at, business_date, order_no,
					status, payment_status, payment_method, subtotal, total, request_id, request_hash, placed_at, accepted_at, preparing_at, paid_at)
				select ${tenant}::uuid, ${ids.brand}::uuid, ${store}::uuid, 'app', login.id, 'takeaway', date_trunc('hour', now()) + interval '1 hour',
					current_date, 12, 'preparing', 'paid', 'vietqr', 40000, 40000, gen_random_uuid(), repeat('a', 64), now(), now(), now(), now()
				from login
				returning id::text as id
			`;
			await sql`update public.orders set status = 'ready', done_at = now() where id = ${order?.id ?? ""}::uuid`;
			const before = zbs.templates().length;
			await cycle();
			const sent = zbs.templates().slice(before);
			expect(sent.map((message) => message.templateId)).toEqual([external]);
			expect(sent[0]?.phone).toBe(`84${"900000"}203`);
			expect(sent[0]?.data).toMatchObject({
				customer_name: "Synthetic C",
				order_no: "#012",
			});
			expect(sent[0]?.data?.pickup_time).toMatch(/^\d\d:\d\d$/);
			const [row] = await rowsFor(ids.members.c, "takeaway_ready");
			expect(row).toMatchObject({
				status: "sent",
				channel: "zalo_zbs",
				template_ref: "zbs.order_ready.v1",
			});
			expect(row?.params?.order_id).toBe(order?.id);
		} finally {
			await sql`delete from app.customer_logins where user_id = ${user}::uuid`;
			await sql`delete from auth.users where id = ${user}::uuid`;
		}
	}, 60_000);

	it("no customer row of the outbox holds a phone, a name or a text", async () => {
		const rows = await sql<Row[]>`
			select status, channel, template_ref, params, title, body, recipient_ref
			from public.outbound_messages
			where tenant_id = ${fixture.tenantId}::uuid and subject_type = 'customer'
		`;
		expect(rows.length).toBeGreaterThanOrEqual(5);
		for (const row of rows) {
			expect(row.title).toBeNull();
			expect(row.body).toBeNull();
			expect(row.recipient_ref).toMatch(/^membership:/);
			const text = JSON.stringify(row);
			expect(text).not.toContain("900000");
			expect(text).not.toContain("Synthetic");
			expect(text).not.toContain(oaUser);
			expect(text).not.toContain("004321");
		}
	});
});
