import { randomBytes } from "node:crypto";
import { createPostgresClient } from "@fnb/sync/postgres";
import { DEFAULT_OA_MENU, OA_MENU_PATH, zaloButtons } from "@fnb/zalo/oa";
import {
	createMockZalo,
	type MockZalo,
	type MockZaloServer,
	startMockZalo,
} from "@fnb/zalo/testing";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ZALO_INTEGRATION === "1" && Boolean(DATABASE_URL);
const IMAGE = "https://example.com/brand-logo.png";

interface Result {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

describe.skipIf(!ENABLED)(
	"fnb zalo oa-menu on the local stack and the mock OA",
	() => {
		let sql: Sql;
		let mock: MockZalo;
		let server: MockZaloServer;
		const suffix = randomBytes(4).toString("hex");
		const slug = `zalo-it-${suffix}`;
		const appId = `zalo-it-app-${suffix}`;
		const miniAppId = `zalo-it-mini-${suffix}`;
		let tenantId = "";
		let oaRowId = "";

		async function fnb(
			argv: readonly string[],
			extra: Readonly<Record<string, string>> = {},
		): Promise<Result> {
			const out = capture();
			const code = await runCli(
				argv,
				{
					DATABASE_URL: DATABASE_URL ?? "",
					ZALO_INTEGRATION: "1",
					ZALO_TENANT_ID: tenantId,
					ZALO_OA_API_BASE_URL: server.baseUrl,
					...extra,
				},
				{ streams: out.streams, loadEnvFile: false },
			);
			return { code, stdout: out.stdout(), stderr: out.stderr() };
		}

		beforeAll(async () => {
			sql = createPostgresClient(DATABASE_URL ?? "", { maxConnections: 1 });
			mock = createMockZalo();
			server = await startMockZalo(mock);
			const { accessToken } = mock.issueTokens(appId, "oa");
			const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, ${`OA menu fixture ${suffix}`}) returning id::text as id
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
			const [brand] = await sql<{ id: string }[]>`
			insert into public.brands (tenant_id, brand_key, display_name, store_ids)
			values (${tenantId}::uuid, 'brand-1', 'Synthetic brand', array[${store?.id ?? ""}::uuid])
			returning id::text as id
		`;
			const brandId = brand?.id ?? "";
			await sql`
			insert into public.zalo_apps (tenant_id, brand_id, external_id, secret_name)
			values (${tenantId}::uuid, ${brandId}::uuid, ${appId}, 'ZALO_APP_SECRET_BRAND_1')
		`;
			const [oa] = await sql<{ id: string }[]>`
			insert into public.oas (tenant_id, brand_id, external_id, package_tier, verified, secret_name)
			values (${tenantId}::uuid, ${brandId}::uuid, ${`zalo-it-oa-${suffix}`}, 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1')
			returning id::text as id
		`;
			oaRowId = oa?.id ?? "";
			await sql`
			insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en, header_color_light, header_color_dark, text_color_light, text_color_dark)
			values (${tenantId}::uuid, ${brandId}::uuid, 'customer', ${miniAppId}, true, 'Thẻ thành viên', 'Thành viên', 'Members', '#123456', '#000000', 'white', 'white')
		`;
			await sql`
			insert into public.zalo_tokens (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token, refresh_expires_at)
			values (${tenantId}::uuid, ${brandId}::uuid, 'oa', ${accessToken}, now() + interval '20 hours', 'zalo-it-oa-refresh', now() + interval '80 days')
		`;
		});

		afterAll(async () => {
			if (sql) {
				await sql`delete from public.tenants where slug = ${slug}`;
				await sql.end({ timeout: 5 });
			}
			await server?.close();
		});

		const applied = async () => {
			const [row] = await sql<
				{ applied_buttons: unknown; applied_at: Date | null }[]
			>`select applied_buttons, applied_at from public.oa_menus where oa_id = ${oaRowId}::uuid`;
			return row;
		};

		it("sets the default menu and changes nothing on the same values", async () => {
			const first = await fnb([
				"zalo",
				"oa-menu",
				"set",
				"--tenant",
				slug,
				"--brand",
				"brand-1",
				"--form-image-url",
				IMAGE,
			]);
			expect(first.code).toBe(0);
			expect(first.stdout).toContain("OA menu created");
			const again = await fnb([
				"zalo",
				"oa-menu",
				"set",
				"--tenant",
				slug,
				"--brand",
				"brand-1",
				"--form-image-url",
				IMAGE,
			]);
			expect(again.stdout).toContain("already holds these values");
		});

		it("prints the diff in a dry run and changes nothing", async () => {
			const dry = await fnb([
				"zalo",
				"oa-menu",
				"apply",
				"--tenant",
				slug,
				"--dry-run",
			]);
			expect(dry.code).toBe(0);
			expect(dry.stdout).toContain(
				`${slug} brand-1: 4 button(s), 4 change(s) (never applied)`,
			);
			expect(dry.stdout).toContain("dry run, nothing pushed");
			expect(mock.requests(OA_MENU_PATH)).toHaveLength(0);
			expect((await applied())?.applied_at).toBeNull();
		});

		it("names brands by position in CI", async () => {
			const ci = await fnb(
				["zalo", "oa-menu", "apply", "--tenant", slug, "--dry-run"],
				{ CI: "1" },
			);
			expect(ci.stdout).toContain("brand 1: 4 button(s), 4 change(s)");
			expect(ci.stdout).not.toContain(slug);
			expect(ci.stdout).not.toContain("zalo.me");
		});

		it("applies the menu so that the OA shows exactly the configuration, once", async () => {
			const run = await fnb(["zalo", "oa-menu", "apply", "--tenant", slug]);
			expect(run.code).toBe(0);
			expect(run.stdout).toContain(`${slug} brand-1: menu applied`);
			const expected = zaloButtons(DEFAULT_OA_MENU.buttons, miniAppId);
			expect(mock.oaMenu(appId)).toEqual(expected);
			expect((await applied())?.applied_buttons).toEqual(expected);
			const again = await fnb(["zalo", "oa-menu", "apply", "--tenant", slug]);
			expect(again.code).toBe(0);
			expect(again.stdout).toContain(
				"the OA already shows this menu; nothing pushed",
			);
			expect(mock.requests(OA_MENU_PATH)).toHaveLength(1);
		});

		it("touches only the tenant of ZALO_TENANT_ID", async () => {
			const other = await fnb(["zalo", "oa-menu", "apply", "--tenant", slug], {
				ZALO_TENANT_ID: "00000000-0000-4000-8000-000000000000",
			});
			expect(other.code).toBe(2);
			expect(other.stderr).toContain(
				"only to the tenant named by ZALO_TENANT_ID",
			);
		});
	},
);
