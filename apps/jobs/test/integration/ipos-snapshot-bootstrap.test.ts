import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type SnapshotRow,
	type SnapshotStoreContent,
	writeSnapshot,
} from "@fnb/connector-ipos/snapshot";
import { createFileSnapshotStorage } from "@fnb/runner/snapshot-files";
import { createPostgresClient } from "@fnb/sync/postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;
const NOW = new Date("2026-11-18T05:00:00.000Z");
const STORE_UID = "00000000-0000-4000-8000-0000000e2e01";
const BRAND_UID = "00000000-0000-4000-8000-0000000e2eb1";
const COMPANY_UID = "00000000-0000-4000-8000-0000000e2ec1";

function sale(id: string, soldAt: string, amount: number) {
	const invoice: SnapshotRow = {
		tran_id: id,
		tran_no: id,
		tran_date: Date.parse(soldAt),
		store_uid: STORE_UID,
		sale_type: "OTS",
		total_amount: amount,
		amount_origin: amount,
		payment_method_id: "CASH",
		payment_method_name: "Tiền mặt",
	};
	return {
		invoice,
		line: {
			...invoice,
			id: `${id}-L1`,
			item_id: "TEA-M",
			item_name: "Trà đào (M)",
			quantity: 1,
			price: amount,
			amount,
			index: 1,
		},
		payment: { ...invoice, amount },
	};
}

function day(date: string, sales: ReturnType<typeof sale>[]): SnapshotRow {
	const net = sales.reduce(
		(sum, entry) => sum + Number(entry.invoice.total_amount),
		0,
	);
	return {
		date,
		tran_date: Date.parse(`${date}T00:00:00+07:00`),
		total_sales: sales.length,
		revenue_gross: net,
		revenue_net: net,
	};
}

async function writeShopSnapshot(directory: string): Promise<void> {
	const october = [
		sale("E2E-1", "2026-10-15T03:00:00Z", 45_000),
		sale("E2E-2", "2026-10-15T05:30:00Z", 55_000),
	];
	const november = [sale("E2E-3", "2026-11-10T04:00:00Z", 39_000)];
	const all = [...october, ...november];
	const store: SnapshotStoreContent = {
		storeUid: STORE_UID,
		items: [
			{
				id: "TEA-M",
				item_id: "TEA-M",
				item_name: "Trà đào (M)",
				ots_price: 45_000,
				active: 1,
			},
		],
		customizations: [],
		packages: [],
		invoices: all.map((entry) => entry.invoice),
		lines: all.map((entry) => entry.line),
		payments: all.map((entry) => entry.payment),
		shifts: [],
		days: [day("2026-10-15", october), day("2026-11-10", november)],
		editedOrDeleted: [],
		removedItemEvents: [],
	};
	const storeRow = {
		id: STORE_UID,
		brand_uid: BRAND_UID,
		company_uid: COMPANY_UID,
		store_name: "Cửa hàng snapshot",
		open_at: 0,
		active: 1,
	};
	await writeSnapshot(
		createFileSnapshotStorage(directory),
		{
			login: {
				user: {
					id: "00000000-0000-4000-8000-0000000e2ea1",
					email: "owner@example.com",
				},
				company: { id: COMPANY_UID },
				brands: [{ id: BRAND_UID, brand_name: "Brand", currency: "VND" }],
				cities: [],
				stores: [storeRow],
			},
			brands: [
				{
					brandUid: BRAND_UID,
					stores: [storeRow],
					itemTypes: [],
					itemClasses: [],
					units: [],
					sources: [],
					paymentMethods: [],
					promotions: [],
					storeContents: [store],
				},
			],
			coveredFrom: "2026-10-01",
			coveredTo: "2026-11-18",
		},
		{ origin: "database", now: () => NOW },
	);
}

async function fnb(
	argv: string[],
	env: Record<string, string>,
): Promise<{ code: number; text: string; lines: string[] }> {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
		now: () => NOW,
	});
	return {
		code,
		text: `${io.stdout()}${io.stderr()}`,
		lines: io.stdout().split("\n"),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe.skipIf(!DATABASE_URL)("fnb bootstrap with IPOS_REAL_API=off", () => {
	it("loads a throwaway tenant from the snapshot without the network and keeps it apart from real data", async () => {
		const suffix = randomUUID().slice(0, 8);
		const slug = `it-snap-${suffix}`;
		const realSlug = `it-real-${suffix}`;
		const accountKey = `it-snap-${suffix}`;
		const root = await mkdtemp(join(tmpdir(), "fnb-ipos-snapshot-"));
		await writeShopSnapshot(join(root, accountKey));
		const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
			throw new Error("the network must not be used");
		});
		const base = {
			CI: "1",
			DATABASE_URL: DATABASE_URL ?? "",
			IPOS_SNAPSHOT_DIR: root,
			POS_ACCOUNTS_JSON: JSON.stringify([
				{
					key: accountKey,
					connector: "ipos-fabi",
					email: "owner@example.com",
					password: "never-sent",
				},
			]),
		};
		const off = { ...base, IPOS_REAL_API: "off" };
		const sql = createPostgresClient(DATABASE_URL ?? "");
		try {
			const loaded = await fnb(
				[
					"bootstrap",
					"--tenant",
					slug,
					"--max-months",
					"3",
					"--stop-after-empty",
					"1",
				],
				off,
			);
			expect(loaded.code, loaded.text).toBe(0);
			expect(loaded.lines[0]).toBe(
				"iPOS: snapshot of 2026-10-01..2026-11-18 (no network)",
			);
			expect(loaded.text.match(/: loaded, \d+ sales/g)).toEqual([
				": loaded, 1 sales",
				": loaded, 2 sales",
				": loaded, 0 sales",
			]);
			expect(loaded.text).toContain("iPOS snapshot requests");
			expect(loaded.text).toContain(
				"warning: iPOS snapshot has no data before 2026-10-01",
			);
			expect(loaded.text).not.toContain("POS HTTP requests");
			expect(loaded.text).not.toContain(slug);
			const [stored] = await sql<{ invoices: number; source: string | null }[]>`
				select
					(select count(*)::integer from public.invoices i where i.tenant_id = t.id) as invoices,
					(select s.source from app.tenant_ipos_sources s where s.tenant_id = t.id) as source
				from public.tenants t where t.slug = ${slug}
			`;
			expect(stored).toEqual({ invoices: 3, source: "snapshot" });

			const real = await fnb(
				[
					"sync",
					"window",
					"--account",
					accountKey,
					"--tenant",
					slug,
					"--from",
					"2026-11-01",
					"--to",
					"2026-11-02",
				],
				{ ...base, IPOS_REAL_API: "on" },
			);
			expect(real.code).toBe(1);
			expect(real.lines[0]).toBe("iPOS: REAL API (posapi.ipos.vn)");
			expect(real.text).toContain("was loaded from the iPOS snapshot");

			await sql`insert into public.tenants (slug, name) values (${realSlug}, ${realSlug})`;
			await sql`
				select app.claim_ipos_source(id, 'api') from public.tenants where slug = ${realSlug}
			`;
			const refused = await fnb(["bootstrap", "--tenant", realSlug], off);
			expect(refused.code).toBe(1);
			expect(refused.text).toContain("holds data from the real iPOS API");
			const [accounts] = await sql<{ count: number }[]>`
				select count(*)::integer as count from public.pos_accounts a
				join public.tenants t on t.id = a.tenant_id where t.slug = ${realSlug}
			`;
			expect(accounts?.count).toBe(0);
			expect(network).not.toHaveBeenCalled();
		} finally {
			await sql`delete from public.tenants where slug in (${slug}, ${realSlug})`;
			await sql.end({ timeout: 5 });
			await rm(root, { recursive: true, force: true });
		}
	}, 300_000);
});
