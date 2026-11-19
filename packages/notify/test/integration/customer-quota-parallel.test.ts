// Test design: concurrency (race) testing of a shared limit (ISTQB reliability) and boundary value analysis of the quota (20 of 30).
// Two dispatchers drain 30 queued template messages of one OA whose daily ZBS quota is 20: exactly 20 sent, 10 held for the
// next template hours, none sent twice. test-gaps G-32, FR-NOT-39, FR-CMP-16, risk PR-08.
import { zonedInstant } from "@fnb/core";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CLI_CYCLE_LIMITS,
	createAdapterRegistry,
	createCycleBudget,
	localIsoDate,
	runNotifyCycle,
	ZBS_TEMPLATE_DRAFTS,
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
const OA_TOKEN = "synthetic-it-quota-oa-token";
const QUOTA = 20;
const QUEUED = 30;
const ZONE = "Asia/Ho_Chi_Minh";

describe.skipIf(!ENABLED)("the OA's daily quota under two dispatchers", () => {
	let sql: Sql;
	let mock: MockProviders;
	let zbs: MockZbsServer;
	let fixture: FixtureTenant;
	let tomorrow10: Date;

	const cycle = (worker: string) =>
		runNotifyCycle({
			repository: fixture.repository(),
			customers: createPostgresCustomerRepository(sql),
			adapters: createAdapterRegistry(),
			environment: { ...fixture.environment, ...zbs.environment() },
			runtime: "cli",
			worker,
			tenantId: fixture.tenantId,
			clock: () => tomorrow10,
			fetch: (input, init) => fetch(input, init),
			log: () => undefined,
			budget: createCycleBudget({ ...CLI_CYCLE_LIMITS, linkPollSeconds: 0 }),
			runSqlTick: false,
			dryRun: false,
			requestTimeoutMs: 10_000,
			sleep: async () => undefined,
		});

	beforeAll(async () => {
		const today = localIsoDate(new Date(), ZONE);
		const next = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
			.toISOString()
			.slice(0, 10);
		tomorrow10 = zonedInstant(next, 600, ZONE);
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 8,
			applicationName: "notify-it-quota",
		});
		mock = await startMockProviders();
		zbs = await startMockZbs();
		fixture = await createFixtureTenant(sql, {
			mock,
			databaseUrl: DATABASE_URL ?? "",
			salesDays: 0,
		});
		const tenant = fixture.tenantId;
		const store = fixture.storeIds[0] ?? "";
		const [setup] = await sql<
			{ brand: string; oa: string; programme: string; coupon: string }[]
		>`
			with brand as (
				insert into public.brands (tenant_id, brand_key, display_name, store_ids)
				values (${tenant}::uuid, 'brand-1', 'Synthetic brand', array[${store}::uuid]) returning id
			),
			oa as (
				insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
				select ${tenant}::uuid, brand.id, ${`syn-it-quota-${tenant.slice(0, 8)}`}, 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from brand returning id
			),
			programme as (
				insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
				values (${tenant}::uuid, 'Synthetic programme', date '2026-01-01', 'below_threshold', 'active') returning id
			),
			coupon as (
				insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_points)
				select ${tenant}::uuid, programme.id, 'free-drink', 'Một ly nước miễn phí', 10 from programme returning id
			)
			select brand.id::text as brand, oa.id::text as oa, programme.id::text as programme, coupon.id::text as coupon
			from brand, oa, programme, coupon
		`;
		if (setup === undefined) {
			throw new Error("the quota fixture was not created");
		}
		await sql`
			insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token)
			values (${tenant}::uuid, ${setup.brand}::uuid, 'oa', ${OA_TOKEN}, now() + interval '3 days', 'synthetic-it-refresh')
		`;
		await sql`
			insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled, promotions_enabled, points_route, zbs_daily_quota)
			values (${tenant}::uuid, true, true, false, 'template', ${QUOTA})
		`;
		const external = "syn-it-quota-voucher";
		await sql`
			insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
			values (${tenant}::uuid, ${setup.oa}::uuid, ${external}, ${ZBS_TEMPLATE_DRAFTS.voucher.tag}, 'voucher', 'approved')
		`;
		zbs.registerTemplate(
			external,
			ZBS_TEMPLATE_DRAFTS.voucher.parameters.map((parameter) => parameter.name),
		);
		zbs.registerToken(OA_TOKEN);
		await sql`
			with series as (select n from generate_series(1, ${QUEUED}::integer) as n),
			customers as (
				insert into public.customers (tenant_id, phone, name)
				select ${tenant}::uuid, '0900000' || (400 + n)::text, 'Synthetic ' || n::text from series returning id, phone
			),
			members as (
				insert into public.memberships (tenant_id, programme_id, customer_id, channel, brand_id, joined_at)
				select ${tenant}::uuid, ${setup.programme}::uuid, customers.id, 'mini_app', ${setup.brand}::uuid, now() - interval '90 days' from customers returning id, customer_id
			),
			consents as (
				insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
				select ${tenant}::uuid, 'customer', customer_id, 'loyalty', 'synthetic-v1', 'mini_app', now() - interval '90 days' from members returning 1
			)
			insert into public.redemptions (tenant_id, store_id, membership_id, coupon_id, code, state, held_at, hold_expires_at)
			select ${tenant}::uuid, ${store}::uuid, members.id, ${setup.coupon}::uuid, 'SYNQ' || upper(substr(md5(random()::text || members.id::text), 1, 6)), 'held', now(), now() + interval '20 hours' from members
		`;
	}, 120_000);

	afterAll(async () => {
		await fixture?.cleanup();
		await zbs?.close();
		await mock?.close();
		await sql?.end({ timeout: 5 });
	});

	it("exactly the quota is sent, the rest is held, none twice", async () => {
		const [queued] = await sql<{ count: string }[]>`
			select count(*)::text as count from public.outbound_messages
			where tenant_id = ${fixture.tenantId}::uuid and kind = 'coupon_issued' and status = 'queued'
		`;
		expect(Number(queued?.count)).toBe(QUEUED);
		// the messages live three days, so the quota holds them for the next template hours instead of sending them in the app
		await sql`
			update public.outbound_messages set expires_at = created_at + interval '72 hours'
			where tenant_id = ${fixture.tenantId}::uuid and kind = 'coupon_issued'
		`;
		for (let round = 0; round < 6; round += 1) {
			await Promise.all([
				cycle(`it-quota-a-${round}`),
				cycle(`it-quota-b-${round}`),
			]);
		}
		const sent = zbs.templates();
		const rows = await sql<
			{ status: string; hold_reason: string | null; count: string }[]
		>`
			select status, hold_reason, count(*)::text as count from public.outbound_messages
			where tenant_id = ${fixture.tenantId}::uuid and kind = 'coupon_issued'
			group by status, hold_reason order by status
		`;
		const byStatus = Object.fromEntries(
			rows.map((row) => [row.status, Number(row.count)]),
		);
		console.info(
			`quota under two dispatchers: ${sent.length} sent to the provider, rows ${JSON.stringify(byStatus)}`,
		);
		expect(sent).toHaveLength(QUOTA);
		expect(byStatus.sent).toBe(QUOTA);
		expect(byStatus.held).toBe(QUEUED - QUOTA);
		expect(
			rows
				.filter((row) => row.status === "held")
				.every((row) => row.hold_reason === "zbs_quota"),
		).toBe(true);
		expect(new Set(sent.map((message) => message.phone)).size).toBe(QUOTA);
	}, 240_000);

	it("a later cycle on the same day sends nothing more", async () => {
		const before = zbs.templates().length;
		await Promise.all([cycle("it-quota-late-a"), cycle("it-quota-late-b")]);
		expect(zbs.templates()).toHaveLength(before);
	}, 120_000);
});
