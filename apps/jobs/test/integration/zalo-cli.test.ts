import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresClient } from "@fnb/sync/postgres";
import {
	createMockZalo,
	MOCK_OAUTH_PATHS,
	type MockZalo,
	type MockZaloServer,
	startMockZalo,
} from "@fnb/zalo/testing";
import {
	completeOaAuthorization,
	OA_TOKEN_ERRORS,
	PostgresTokenStore,
} from "@fnb/zalo/tokens";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ZALO_INTEGRATION === "1" && Boolean(DATABASE_URL);
const FIXTURE_PREFIX = "zalo-it-";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

interface Result {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

async function fnb(
	argv: readonly string[],
	extra: Readonly<Record<string, string>> = {},
): Promise<Result> {
	const out = capture();
	const code = await runCli(
		argv,
		{ DATABASE_URL: DATABASE_URL ?? "", ...extra },
		{ streams: out.streams, loadEnvFile: false },
	);
	return { code, stdout: out.stdout(), stderr: out.stderr() };
}

async function insertLogin(sql: Sql, email: string): Promise<string> {
	const userId = randomUUID();
	await sql`
		insert into auth.users (
			instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
			confirmation_token, recovery_token, email_change_token_new, email_change,
			email_change_token_current, phone_change, phone_change_token, reauthentication_token,
			is_sso_user, is_anonymous
		)
		values (
			${AUTH_INSTANCE_ID}::uuid, ${userId}::uuid, 'authenticated', 'authenticated', ${email},
			extensions.crypt(${randomBytes(18).toString("base64url")}, extensions.gen_salt('bf')), now(),
			'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
			'', '', '', '', '', '', '', '', false, false
		)
	`;
	return userId;
}

describe.skipIf(!ENABLED)("fnb zalo on the local stack", () => {
	let sql: Sql;
	let directory: string;
	const suffix = randomBytes(4).toString("hex");
	const slug = `${FIXTURE_PREFIX}${suffix}`;
	const ownerEmail = `${FIXTURE_PREFIX}${suffix}-owner@example.com`;
	const publisherEmail = `${FIXTURE_PREFIX}${suffix}-publisher@example.com`;
	const logins: string[] = [];
	let tenantId = "";
	const brandFile = {
		brand: "brand-1",
		name: "Quán Thử Một",
		stores: [
			`${FIXTURE_PREFIX}${suffix}-store-1`,
			`${FIXTURE_PREFIX}${suffix}-store-2`,
		],
		zalo_app: {
			id: `synthetic-app-${suffix}`,
			secret_name: "ZALO_APP_SECRET_IT_BRAND_1",
		},
		oa: {
			id: `synthetic-oa-${suffix}`,
			secret_name: "ZALO_OA_SECRET_IT_BRAND_1",
			package_tier: "tang_truong",
			package_expires_on: "2027-06-30",
			verified: true,
		},
		mini_apps: [
			{
				kind: "staff",
				id: `synthetic-staff-${suffix}`,
				title: "Quán Thử Nội Bộ",
				header_title_vi: "Nội bộ",
				header_title_en: "Staff",
				header_color_light: "#1F6F4A",
				header_color_dark: "#0E2A1F",
				text_color_light: "white",
				text_color_dark: "white",
			},
			{
				kind: "customer",
				id: `synthetic-customer-${suffix}`,
				title: "Quán Thử Thành Viên",
				header_title_vi: "Thành viên",
				header_title_en: "Members",
				header_color_light: "#FFFFFF",
				header_color_dark: "#121212",
				text_color_light: "black",
				text_color_dark: "white",
			},
		],
	};

	async function rowCounts(): Promise<number[]> {
		const [row] = await sql<{ counts: number[] }[]>`
			select array[
				(select count(*)::integer from public.brands where tenant_id = ${tenantId}::uuid),
				(select count(*)::integer from public.zalo_apps where tenant_id = ${tenantId}::uuid),
				(select count(*)::integer from public.oas where tenant_id = ${tenantId}::uuid),
				(select count(*)::integer from public.mini_apps where tenant_id = ${tenantId}::uuid)
			] as counts
		`;
		return row?.counts ?? [];
	}

	function writeBrand(name: string, value: unknown): string {
		const path = join(directory, name);
		writeFileSync(path, JSON.stringify(value));
		return path;
	}

	beforeAll(async () => {
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 2,
			applicationName: "zalo-cli-it",
		});
		await sql`
			delete from public.tenants
			where slug like ${`${FIXTURE_PREFIX}%`} and created_at < now() - interval '1 hour'
		`;
		await sql`
			delete from auth.users
			where email like ${`${FIXTURE_PREFIX}%@example.com`} and created_at < now() - interval '1 hour'
		`;
		const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, ${`Zalo CLI fixture ${suffix}`})
			returning id::text as id
		`;
		tenantId = tenant?.id ?? "";
		const [account] = await sql<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenantId}::uuid, 'mock', ${`${FIXTURE_PREFIX}${suffix}-account`}, 'Synthetic account')
			returning id::text as id
		`;
		for (const number of [1, 2, 3]) {
			await sql`
				insert into public.stores (tenant_id, pos_account_id, external_id, name)
				values (${tenantId}::uuid, ${account?.id ?? ""}::uuid, ${`${FIXTURE_PREFIX}${suffix}-store-${number}`},
					${`Synthetic store ${number}`})
			`;
		}
		for (const [email, role] of [
			[ownerEmail, "owner"],
			[publisherEmail, "publisher"],
		] as const) {
			const userId = await insertLogin(sql, email);
			logins.push(userId);
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role)
				values (${tenantId}::uuid, ${userId}::uuid, ${role}::public.tenant_role)
			`;
		}
		directory = mkdtempSync(join(tmpdir(), "zalo-cli-it-"));
	}, 60_000);

	afterAll(async () => {
		if (sql !== undefined) {
			await sql`delete from public.tenants where slug = ${slug}`;
			if (logins.length > 0) {
				await sql`
					delete from auth.users
					where id in (select jsonb_array_elements_text(${JSON.stringify(logins)}::text::jsonb)::uuid)
				`;
			}
			await sql.end({ timeout: 5 });
		}
		if (directory !== undefined) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("sets a brand from a file once; a second run changes nothing", async () => {
		const path = writeBrand("brand-1.json", brandFile);
		const first = await fnb([
			"zalo",
			"config",
			"set",
			"--tenant",
			slug,
			"--file",
			path,
		]);
		expect(first.code, first.stderr).toBe(0);
		expect(first.stdout).toContain(
			`brand-1 of ${slug}: brand, Zalo App, OA, staff Mini App, customer Mini App created; 0 unchanged`,
		);
		expect(await rowCounts()).toEqual([1, 1, 1, 2]);
		const second = await fnb([
			"zalo",
			"config",
			"set",
			"--tenant",
			slug,
			"--file",
			path,
		]);
		expect(second.code, second.stderr).toBe(0);
		expect(second.stdout).toContain(
			`brand-1 of ${slug} unchanged: every row already holds these values`,
		);
		expect(await rowCounts()).toEqual([1, 1, 1, 2]);
	});

	it("refuses a conflicting run and changes nothing", async () => {
		const path = writeBrand("brand-1-changed.json", {
			...brandFile,
			name: "Quán Thử Khác",
			oa: { ...brandFile.oa, webhook_mode: "enforce" },
		});
		const result = await fnb([
			"zalo",
			"config",
			"set",
			"--tenant",
			slug,
			"--file",
			path,
		]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"already exists with different values (brand display_name; OA webhook_mode); nothing was changed",
		);
		const [brand] = await sql<{ display_name: string; webhook_mode: string }[]>`
			select b.display_name, o.webhook_mode
			from public.brands b join public.oas o on o.brand_id = b.id
			where b.tenant_id = ${tenantId}::uuid and b.brand_key = 'brand-1'
		`;
		expect(brand).toEqual({
			display_name: "Quán Thử Một",
			webhook_mode: "observe",
		});
	});

	it("adds a second synthetic brand from flags with no source change, and refuses a secret value", async () => {
		const refused = await fnb([
			"zalo",
			"config",
			"set",
			"--tenant",
			slug,
			"--brand",
			"brand-2",
			"--name",
			"Quán Thử Hai",
			"--store",
			`${FIXTURE_PREFIX}${suffix}-store-3`,
			"--app-id",
			`synthetic-app-2-${suffix}`,
			"--app-secret-name",
			"ZALO_APP_SECRET_9F8E7D6C5B4A3928",
		]);
		expect(refused.code).toBe(2);
		expect(refused.stderr).not.toContain("9F8E7D6C5B4A3928");
		expect(await rowCounts()).toEqual([1, 1, 1, 2]);
		const added = await fnb([
			"zalo",
			"config",
			"set",
			"--tenant",
			slug,
			"--brand",
			"brand-2",
			"--name",
			"Quán Thử Hai",
			"--store",
			`${FIXTURE_PREFIX}${suffix}-store-3`,
			"--app-id",
			`synthetic-app-2-${suffix}`,
			"--app-secret-name",
			"ZALO_APP_SECRET_IT_BRAND_2",
		]);
		expect(added.code, added.stderr).toBe(0);
		expect(added.stdout).toContain(
			`brand-2 of ${slug}: brand, Zalo App created; 0 unchanged`,
		);
		expect(await rowCounts()).toEqual([2, 2, 1, 2]);
	});

	it("shows both brands, numbered and with states only when CI is set", async () => {
		const shown = await fnb(["zalo", "config", "show", "--tenant", slug]);
		expect(shown.code, shown.stderr).toBe(0);
		expect(shown.stdout).toContain(
			"brand-1 (Quán Thử Một): 2 stores; Zalo App active; OA tang_truong, verified, webhook observe, package until 2027-06-30; Mini Apps staff and customer; 0 bound identities",
		);
		expect(shown.stdout).toContain(
			`staff Mini App synthetic-staff-${suffix}: Quán Thử Nội Bộ`,
		);
		expect(shown.stdout).toContain(
			"brand-2 (Quán Thử Hai): 1 stores; Zalo App active; no OA; Mini Apps none; 0 bound identities",
		);
		const ci = await fnb(["zalo", "config", "show", "--tenant", slug], {
			CI: "1",
		});
		expect(ci.code, ci.stderr).toBe(0);
		expect(ci.stdout.trim().split("\n")).toEqual([
			"brand 1: 2 stores; Zalo App active; OA tang_truong, verified, webhook observe, package until 2027-06-30; Mini Apps staff and customer; 0 bound identities",
			"brand 2: 1 stores; Zalo App active; no OA; Mini Apps none; 0 bound identities",
		]);
		for (const hidden of [slug, suffix, "ZALO_", "Quán Thử"]) {
			expect(ci.stdout).not.toContain(hidden);
		}
	});

	it("issues a binding code that is stored only as its hash", async () => {
		const result = await fnb([
			"zalo",
			"bind",
			"--tenant",
			slug,
			"--member",
			ownerEmail,
			"--brand",
			"brand-1",
		]);
		expect(result.code, result.stderr).toBe(0);
		const code = /: (\d{6})\n/.exec(result.stdout)?.[1];
		expect(code).toMatch(/^\d{6}$/);
		expect(result.stdout).toContain("(10 minutes), for one use");
		const rows = await sql<
			{ zalo_app_id: string; code_sha256: string; minutes: number }[]
		>`
			select c.zalo_app_id::text as zalo_app_id, c.code_sha256,
				extract(epoch from c.expires_at - c.issued_at)::integer / 60 as minutes
			from app.zalo_binding_codes c
			where c.tenant_id = ${tenantId}::uuid
		`;
		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row?.code_sha256).toBe(
			createHash("sha256").update(`${row?.zalo_app_id}:${code}`).digest("hex"),
		);
		expect(row?.minutes).toBe(10);
		const again = await fnb([
			"zalo",
			"bind",
			"--tenant",
			slug,
			"--member",
			ownerEmail,
			"--brand",
			"brand-1",
		]);
		expect(again.code).toBe(0);
		const [count] = await sql<{ codes: number }[]>`
			select count(*)::integer as codes from app.zalo_binding_codes where tenant_id = ${tenantId}::uuid
		`;
		expect(count?.codes).toBe(1);
	});

	it("refuses a publisher, an unknown login and a brand without a Zalo App", async () => {
		const publisher = await fnb([
			"zalo",
			"bind",
			"--tenant",
			slug,
			"--member",
			publisherEmail,
			"--brand",
			"brand-1",
		]);
		expect(publisher.code).toBe(1);
		expect(publisher.stderr).toContain(
			"no binding code: a publisher login cannot be bound to a Zalo account",
		);
		const unknown = await fnb([
			"zalo",
			"bind",
			"--tenant",
			slug,
			"--member",
			`${FIXTURE_PREFIX}${suffix}-nobody@example.com`,
			"--brand",
			"brand-1",
		]);
		expect(unknown.code).toBe(2);
		expect(unknown.stderr).toContain("no login exists for this e-mail");
		const missing = await fnb([
			"zalo",
			"bind",
			"--tenant",
			slug,
			"--member",
			ownerEmail,
			"--brand",
			"brand-9",
		]);
		expect(missing.code).toBe(2);
		expect(missing.stderr).toContain("brand-9 has no Zalo App in this tenant");
	});
});

describe.skipIf(!ENABLED)(
	"fnb zalo token jobs on the local stack against mock-zalo",
	() => {
		const HOUR = 3_600_000;
		const DAY = 24 * HOUR;
		const SECRET_NAME = "ZALO_APP_SECRET_IT_TOKENS";
		const APP_SECRET = "synthetic-app-secret-token-jobs";
		const suffix = randomBytes(4).toString("hex");
		const slug = `${FIXTURE_PREFIX}${suffix}-tokens`;
		const ownerEmail = `${FIXTURE_PREFIX}${suffix}-tokens-owner@example.com`;
		const brands = [1, 2, 3, 4].map((number) => ({
			key: `brand-${number}`,
			appId: `synthetic-tok-app-${number}-${suffix}`,
			oaId: `synthetic-tok-oa-${number}-${suffix}`,
			id: "",
		}));
		let sql: Sql;
		let mock: MockZalo;
		let server: MockZaloServer;
		let tenantId = "";
		let start = new Date();

		function at(offsetMs: number): Date {
			return new Date(start.getTime() + offsetMs);
		}

		function brandId(key: string): string {
			return brands.find((brand) => brand.key === key)?.id ?? "";
		}

		async function tokens(
			argv: readonly string[],
			when: Date,
			extra: Readonly<Record<string, string>> = {},
		): Promise<Result> {
			const out = capture();
			const code = await runCli(
				argv,
				{
					DATABASE_URL: DATABASE_URL ?? "",
					ZALO_INTEGRATION: "1",
					ZALO_TENANT_ID: tenantId,
					ZALO_OAUTH_BASE_URL: server.baseUrl,
					[SECRET_NAME]: APP_SECRET,
					...extra,
				},
				{ streams: out.streams, loadEnvFile: false, now: () => when },
			);
			return { code, stdout: out.stdout(), stderr: out.stderr() };
		}

		async function tokenRow(
			key: string,
			kind: "oa" | "developer",
		): Promise<{ version: number; refresh_token: string } | undefined> {
			const [row] = await sql<{ version: number; refresh_token: string }[]>`
				select version::integer as version, refresh_token
				from public.zalo_tokens
				where brand_id = ${brandId(key)}::uuid and kind = ${kind}
			`;
			return row;
		}

		async function episodes(key: string, kind: "oa" | "developer") {
			return sql<
				{
					state: string;
					occurrences: number;
					notifications: number;
					facts: Record<string, unknown>;
					messages: number;
				}[]
			>`
				select e.state, e.occurrences, e.notifications, e.facts,
					(select count(*)::integer from public.outbound_messages o where o.alert_event_id = e.id) as messages
				from public.alert_events e
				where e.tenant_id = ${tenantId}::uuid
					and e.dedupe_key = ${`zalo_token_failed:${kind}:${brandId(key)}`}
				order by e.opened_at
			`;
		}

		async function authorizeLink(): Promise<URL> {
			const result = await tokens(
				[
					"zalo",
					"oa",
					"authorize",
					"--tenant",
					slug,
					"--brand",
					"brand-1",
					"--redirect-uri",
					"http://127.0.0.1:54321/functions/v1/zalo-oauth",
				],
				new Date(),
			);
			expect(result.code, result.stderr).toBe(0);
			const link = result.stdout
				.split("\n")
				.find((line) => line.startsWith(server.baseUrl));
			expect(link).toBeDefined();
			const response = await fetch(link ?? "", { redirect: "manual" });
			expect(response.status).toBe(302);
			return new URL(response.headers.get("location") ?? "");
		}

		function complete(callback: URL, clock: Date = new Date()) {
			return completeOaAuthorization(
				{
					store: new PostgresTokenStore(sql),
					oauth: { baseUrl: server.baseUrl },
					secret: (name) => (name === SECRET_NAME ? APP_SECRET : null),
					clock: () => clock,
					source: "cli",
				},
				{
					state: callback.searchParams.get("state"),
					code: callback.searchParams.get("code"),
					oaId: callback.searchParams.get("oa_id"),
				},
			);
		}

		beforeAll(async () => {
			sql = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 2,
				applicationName: "zalo-tokens-it",
			});
			mock = createMockZalo();
			server = await startMockZalo(mock);
			const [tenant] = await sql<{ id: string }[]>`
				insert into public.tenants (slug, name, timezone)
				values (${slug}, ${`Zalo tokens fixture ${suffix}`}, 'Asia/Ho_Chi_Minh')
				returning id::text as id
			`;
			tenantId = tenant?.id ?? "";
			const [store] = await sql<{ id: string }[]>`
				with account as (
					insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
					values (${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'Synthetic account')
					returning id
				)
				insert into public.stores (tenant_id, pos_account_id, external_id, name)
				select ${tenantId}::uuid, account.id, ${`${slug}-store`}, 'Synthetic store' from account
				returning id::text as id
			`;
			for (const [index, brand] of brands.entries()) {
				const [row] = await sql<{ id: string }[]>`
					insert into public.brands (tenant_id, brand_key, display_name, store_ids)
					values (${tenantId}::uuid, ${brand.key}, ${`Synthetic brand ${index + 1}`}, array[${store?.id ?? ""}::uuid])
					returning id::text as id
				`;
				brand.id = row?.id ?? "";
				await sql`
					insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
					values (${tenantId}::uuid, ${brand.id}::uuid, ${brand.appId}, ${SECRET_NAME})
				`;
				await sql`
					insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name, package_expires_on)
					values (${tenantId}::uuid, ${brand.id}::uuid, ${brand.oaId}, 'tang_truong', true, 'ZALO_OA_SECRET_IT_TOKENS',
						case ${brand.key}::text
							when 'brand-1' then (now() at time zone 'Asia/Ho_Chi_Minh')::date + 30
							when 'brand-4' then (now() at time zone 'Asia/Ho_Chi_Minh')::date + 7
						end)
				`;
				mock.registerApp({
					appId: brand.appId,
					appSecret: APP_SECRET,
					oaId: brand.oaId,
				});
			}
			const ownerId = await insertLogin(sql, ownerEmail);
			await sql`
				insert into public.tenant_members (tenant_id, user_id, role)
				values (${tenantId}::uuid, ${ownerId}::uuid, 'owner')
			`;
			await sql`
				select app.ensure_notifications_consent(
					${tenantId}::uuid, ${ownerId}::uuid, 'zalo_bot',
					'{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, now() - interval '30 days'
				)
			`;
			await sql`
				insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at)
				values (${tenantId}::uuid, 'zalo_bot', 'zalo_bot', 'owner bot', ${ownerId}::uuid, ${`synthetic-chat-${suffix}`},
					'NOTIFY_ZALO_BOT_TOKEN_IT51', 'active', now() - interval '30 days')
			`;
			start = new Date();
		}, 60_000);

		afterAll(async () => {
			if (sql !== undefined) {
				await sql`delete from public.tenants where slug = ${slug}`;
				await sql`delete from auth.users where email = ${ownerEmail}`;
				await sql.end({ timeout: 5 });
			}
			await server?.close();
		});

		it("authorises the OA once through the permission URL; a wrong or expired state is refused and the verifier row is gone after 10 minutes", async () => {
			const wrong = await authorizeLink();
			wrong.searchParams.set("state", "w".repeat(32));
			expect(await complete(wrong)).toEqual({ outcome: "invalid_state" });
			const late = await authorizeLink();
			expect(
				await complete(late, new Date(Date.now() + 10 * 60_000 + 1_000)),
			).toEqual({ outcome: "expired_state" });
			const [afterExpiry] = await sql<{ rows: number }[]>`
				select count(*)::integer as rows from app.zalo_oauth_pending where tenant_id = ${tenantId}::uuid
			`;
			expect(afterExpiry?.rows).toBe(0);
			await authorizeLink();
			const [purged] = await sql<{ purged: number }[]>`
				select app.purge_oa_authorizations(now() + interval '10 minutes 1 second') as purged
			`;
			expect(purged?.purged).toBeGreaterThanOrEqual(1);
			const [afterPurge] = await sql<{ rows: number }[]>`
				select count(*)::integer as rows from app.zalo_oauth_pending where tenant_id = ${tenantId}::uuid
			`;
			expect(afterPurge?.rows).toBe(0);
			const callback = await authorizeLink();
			expect(await complete(callback)).toEqual({
				outcome: "authorized",
				brandKey: "brand-1",
				version: 1,
			});
			expect(await complete(callback)).toEqual({ outcome: "invalid_state" });
			const stored = await tokenRow("brand-1", "oa");
			expect(stored?.version).toBe(1);
			expect(mock.refreshTokenState(stored?.refresh_token ?? "")).toBe("live");
			expect(mock.oauthCounts().exchanges).toBe(1);
			const [refreshedAt] = await sql<{ at: Date }[]>`
				select refreshed_at as at from public.zalo_tokens
				where brand_id = ${brandId("brand-1")}::uuid and kind = 'oa'
			`;
			start = refreshedAt?.at ?? new Date();
		});

		it("refreshes twice without manual action, and two concurrent runs refresh once", async () => {
			const refresh = [
				"zalo",
				"oa",
				"refresh",
				"--tenant",
				slug,
				"--brand",
				"brand-1",
			];
			const first = await tokens(refresh, at(12 * HOUR));
			expect(first.code, first.stderr).toBe(0);
			expect(first.stdout).toContain(
				`${slug} brand-1: OA token refreshed (version 2; it was 12 h old)`,
			);
			const early = await tokens(refresh, at(13 * HOUR));
			expect(early.stdout).toContain("OA token fresh (60 min old, version 2)");
			const second = await tokens(refresh, at(24 * HOUR));
			expect(second.stdout).toContain(
				"OA token refreshed (version 3; it was 12 h old)",
			);
			expect(mock.oauthCounts().refreshes).toBe(2);
			const together = await Promise.all([
				tokens(refresh, at(36 * HOUR)),
				tokens(refresh, at(36 * HOUR)),
			]);
			expect(together.map((run) => run.code)).toEqual([0, 0]);
			const outcomes = together
				.map((run) => /OA token (refreshed|fresh)/.exec(run.stdout)?.[1])
				.sort();
			expect(outcomes).toEqual(["fresh", "refreshed"]);
			expect(mock.oauthCounts().refreshes).toBe(3);
			const stored = await tokenRow("brand-1", "oa");
			expect(stored?.version).toBe(4);
			expect(mock.refreshTokenState(stored?.refresh_token ?? "")).toBe("live");
			expect(await episodes("brand-1", "oa")).toEqual([]);
		});

		it("opens exactly one zalo_token_failed episode for each of -216, -220 and -224; a repeat inside the cool-down stays silent", async () => {
			const codes = [
				["brand-2", OA_TOKEN_ERRORS.accessTokenInvalid],
				["brand-3", OA_TOKEN_ERRORS.accessTokenExpired],
				["brand-4", OA_TOKEN_ERRORS.packageExpired],
			] as const;
			for (const [key, code] of codes) {
				const brand = brands.find((entry) => entry.key === key);
				const pair = mock.issueTokens(brand?.appId ?? "", "oa");
				await sql`
					select app.save_zalo_tokens(
						${brandId(key)}::uuid, 'oa', ${pair.accessToken}, ${at(25 * HOUR).toISOString()}::timestamptz,
						${pair.refreshToken}, ${at(90 * DAY).toISOString()}::timestamptz, ${start.toISOString()}::timestamptz
					)
				`;
				for (const offset of [12, 13]) {
					mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
						kind: "error",
						error: code,
					});
					const run = await tokens(
						["zalo", "oa", "refresh", "--tenant", slug, "--brand", key],
						at(offset * HOUR),
					);
					expect(run.code).toBe(1);
					expect(run.stdout).toContain(
						`Zalo refused the OA token refresh (error ${code}); zalo_token_failed ${offset === 12 ? "opened" : "repeated"}`,
					);
				}
				const found = await episodes(key, "oa");
				expect(found).toHaveLength(1);
				expect(found[0]).toMatchObject({
					state: "open",
					occurrences: 2,
					notifications: 1,
					messages: 1,
					facts: {
						kind: "oa",
						brand: key,
						reason: "refused",
						error_code: code,
					},
				});
				expect(mock.refreshTokenState(pair.refreshToken)).toBe("live");
			}
		});

		it("seeds and rotates the developer pair; a failed rotation raises zalo_token_failed", async () => {
			const seed = mock.issueTokens(brands[0]?.appId ?? "", "developer");
			const seeded = await tokens(
				["zalo", "zmp", "seed", "--tenant", slug, "--brand", "brand-1"],
				start,
				{ ZALO_ZMP_REFRESH_TOKEN: seed.refreshToken },
			);
			expect(seeded.code, seeded.stderr).toBe(0);
			expect(seeded.stdout).not.toContain(seed.refreshToken);
			expect(mock.refreshTokenState(seed.refreshToken)).toBe("spent");
			expect((await tokenRow("brand-1", "developer"))?.version).toBe(1);
			const rotate = [
				"zalo",
				"zmp",
				"rotate",
				"--tenant",
				slug,
				"--brand",
				"brand-1",
			];
			const early = await tokens(rotate, at(19 * HOUR));
			expect(early.stdout).toContain("developer token fresh");
			const rotated = await tokens(rotate, at(21 * HOUR));
			expect(rotated.code, rotated.stderr).toBe(0);
			expect(rotated.stdout).toContain(
				"developer token refreshed (version 2; it was 21 h old)",
			);
			const stored = await tokenRow("brand-1", "developer");
			expect(mock.refreshTokenState(stored?.refresh_token ?? "")).toBe("live");
			expect(mock.oauthCounts().developerRefreshes).toBe(2);
			mock.failNext(MOCK_OAUTH_PATHS.developerToken, {
				kind: "status",
				status: 503,
			});
			const failed = await tokens([...rotate, "--force"], at(22 * HOUR));
			expect(failed.code).toBe(1);
			expect(failed.stdout).toContain("zalo_token_failed opened");
			const found = await episodes("brand-1", "developer");
			expect(found).toHaveLength(1);
			expect(found[0]?.facts).toEqual({
				kind: "developer",
				brand: "brand-1",
				reason: "unanswered",
			});
			expect((await tokenRow("brand-1", "developer"))?.version).toBe(2);
			const recovered = await tokens([...rotate, "--force"], at(23 * HOUR));
			expect(recovered.code, recovered.stderr).toBe(0);
			expect((await episodes("brand-1", "developer"))[0]?.state).toBe(
				"resolved",
			);
		});

		it("raises oa_package_expiring 30 and 7 days before a synthetic expiry date", async () => {
			const later = await tokens(
				["zalo", "oa", "refresh", "--tenant", slug, "--brand", "brand-9"],
				at(23 * DAY + 12 * HOUR),
			);
			expect(later.code, later.stderr).toBe(0);
			expect(later.stdout).toContain("1 OA package expiry notice(s) raised");
			const notices = await sql<{ oa: string; notice: number }[]>`
				select o.external_id as oa, (e.facts ->> 'notice_days')::integer as notice
				from public.alert_events e
				join public.oas o on e.dedupe_key like 'oa_package_expiring:oa:' || o.id::text || ':%'
				where e.tenant_id = ${tenantId}::uuid and e.rule_key = 'oa_package_expiring'
				order by o.external_id, e.opened_at
			`;
			expect(notices.map((row) => [row.oa, row.notice])).toEqual([
				[brands[0]?.oaId, 30],
				[brands[0]?.oaId, 7],
				[brands[3]?.oaId, 7],
			]);
			const again = await tokens(
				["zalo", "oa", "refresh", "--tenant", slug, "--brand", "brand-9"],
				at(24 * DAY),
			);
			expect(again.stdout).not.toContain("notice(s) raised");
		});

		it("prints the status numbered and without names with CI set", async () => {
			const result = await tokens(
				["zalo", "status", "--tenant", slug],
				at(36 * HOUR),
				{ CI: "1" },
			);
			expect(result.code, result.stderr).toBe(0);
			const lines = result.stdout.trim().split("\n");
			expect(lines).toHaveLength(4);
			expect(lines[0]).toMatch(
				/^brand 1: Zalo App active; OA token 0 min old, 3 refresh\(es\) since stored, next refresh in 11 h, access valid 25 h; package tang_truong until \d{4}-\d{2}-\d{2} \(\d+ days\); webhook observe; developer token 13 h old, 2 rotation\(s\) since stored, next rotation in 7 h, access expired; 0 open zalo_token_failed episode\(s\)$/,
			);
			expect(lines[1]).toContain("1 open zalo_token_failed episode(s)");
			for (const hidden of [slug, suffix, "ZALO_", APP_SECRET]) {
				expect(result.stdout).not.toContain(hidden);
			}
		});
	},
);
