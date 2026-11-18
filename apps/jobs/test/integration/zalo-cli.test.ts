import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresClient } from "@fnb/sync/postgres";
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
