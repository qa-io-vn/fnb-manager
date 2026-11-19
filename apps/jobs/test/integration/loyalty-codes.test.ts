import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresClient } from "@fnb/sync/postgres";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;

async function fnb(argv: readonly string[]) {
	const out = capture();
	const code = await runCli(
		argv,
		{ DATABASE_URL: DATABASE_URL ?? "" },
		{ streams: out.streams, loadEnvFile: false },
	);
	return { code, stdout: out.stdout(), stderr: out.stderr() };
}

describe.skipIf(!DATABASE_URL)(
	"the 100-code pool round trip on the local stack",
	() => {
		let sql: Sql;
		let directory: string;
		const slug = `it-loyalty-${randomBytes(4).toString("hex")}`;
		const codes = Array.from(
			{ length: 100 },
			(_, index) =>
				`ITC${randomBytes(3).toString("hex").toUpperCase()}${String(index).padStart(3, "0")}`,
		);
		let tenantId = "";
		let storeId = "";
		let accountId = "";
		let today = "";

		beforeAll(async () => {
			sql = createPostgresClient(DATABASE_URL ?? "", {
				maxConnections: 1,
			}) as unknown as Sql;
			directory = mkdtempSync(join(tmpdir(), "fnb-it-loyalty-codes-"));
			const [fixture] = await sql<
				{ tenant: string; account: string; store: string }[]
			>`
			with tenant as (
				insert into public.tenants (slug, name, country_code) values (${slug}, 'IT loyalty codes', 'VN') returning id
			),
			account as (
				insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
				select id, 'mock', ${`${slug}-account`}, 'IT account' from tenant returning id, tenant_id
			),
			store as (
				insert into public.stores (tenant_id, pos_account_id, external_id, code, name)
				select tenant_id, id, ${`${slug}-store`}, 'ITS1', 'IT store' from account returning id, tenant_id
			)
			select s.tenant_id::text as tenant, a.id::text as account, s.id::text as store
			from store s, account a
		`;
			if (!fixture) {
				throw new Error("no fixture");
			}
			tenantId = fixture.tenant;
			accountId = fixture.account;
			storeId = fixture.store;
			const [date] = await sql<
				{ today: string }[]
			>`select app.store_business_date(${storeId}::uuid, now())::text as today`;
			today = date?.today ?? "";
			await sql`
			insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status)
			values (${tenantId}::uuid, 'IT programme', date '2026-01-01', 'below_threshold', 'active')
		`;
			await sql`
			insert into public.coupon_rails (tenant_id, store_id, rail, crm_programme_external_ids, active_from)
			values (${tenantId}::uuid, ${storeId}::uuid, 'crm_code_pool', '{IT-POOL}', now() - interval '1 day')
		`;
			await sql`
			insert into public.coupon_rail_rewards (tenant_id, store_id, reward_key, crm_programme_external_id, einvoice_display)
			values (${tenantId}::uuid, ${storeId}::uuid, 'free-drink', 'IT-POOL', 'discount')
		`;
		});

		afterAll(async () => {
			if (sql) {
				await sql`delete from public.tenants where slug = ${slug}`;
				await sql.end({ timeout: 5 });
			}
			if (directory) {
				rmSync(directory, { recursive: true, force: true });
			}
		});

		it("imports 100 codes, marks the 10 used on invoices, exports exactly those 10, and a second import changes nothing", async () => {
			const file = join(directory, "export.csv");
			writeFileSync(file, `﻿Mã voucher\r\n${codes.join("\r\n")}\r\n`);
			const imported = await fnb([
				"loyalty",
				"codes",
				"import",
				"--tenant",
				slug,
				"--store",
				"ITS1",
				"--reward",
				"free-drink",
				"--file",
				file,
			]);
			expect(imported.code).toBe(0);
			expect(imported.stdout).toContain("100 row(s) read after a header");
			expect(imported.stdout).toContain("100 inserted");

			const used = codes.slice(0, 10);
			for (const [index, code] of used.entries()) {
				await sql`
				insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, voucher_code, net_amount, paid_amount)
				values (${tenantId}::uuid, ${storeId}::uuid, ${accountId}::uuid, ${`${slug}-sale-${index}`}, now() - interval '10 minutes', ${today}::date, 50000, ${code}, 50000, 50000)
			`;
			}
			const reconciled = await fnb([
				"loyalty",
				"reconcile",
				"--tenant",
				slug,
				"--from",
				today,
				"--to",
				today,
			]);
			expect(reconciled.code).toBe(0);
			expect(reconciled.stdout).toContain("pool_codes_used 10");

			const out = join(directory, "used.csv");
			const exported = await fnb([
				"loyalty",
				"codes",
				"export",
				"--tenant",
				slug,
				"--state",
				"used",
				"--out",
				out,
			]);
			expect(exported.code).toBe(0);
			expect(exported.stdout).toContain("10 used code(s) written");
			const exportedCodes = readFileSync(out, "utf8")
				.replace(/^﻿/, "")
				.trim()
				.split("\r\n")
				.slice(1)
				.map((line) => line.split(",")[2]);
			expect([...exportedCodes].sort()).toEqual([...used].sort());

			const again = await fnb([
				"loyalty",
				"codes",
				"import",
				"--tenant",
				slug,
				"--store",
				"ITS1",
				"--reward",
				"free-drink",
				"--file",
				file,
			]);
			expect(again.code).toBe(0);
			expect(again.stdout).toContain("0 inserted, 100 already in the pool");
			const [counts] = await sql<
				{ total: number; used: number; available: number }[]
			>`
			select count(*)::integer as total,
				count(*) filter (where state = 'used')::integer as used,
				count(*) filter (where state = 'available')::integer as available
			from public.coupon_codes where store_id = ${storeId}::uuid
		`;
			expect(counts).toEqual({ total: 100, used: 10, available: 90 });

			const status = await fnb([
				"loyalty",
				"codes",
				"status",
				"--tenant",
				slug,
			]);
			expect(status.stdout).toContain(
				"ITS1 free-drink: available 90, assigned 0, used 10, quarantined 0, expired 0",
			);

			for (const output of [imported, reconciled, exported, again, status]) {
				for (const code of codes) {
					expect(output.stdout + output.stderr).not.toContain(code);
				}
			}
		});
	},
);
