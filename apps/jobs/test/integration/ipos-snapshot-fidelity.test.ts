import { collectSales } from "@fnb/connector-core";
import {
	createMemorySnapshotStorage,
	writeSnapshot,
} from "@fnb/connector-ipos/snapshot";
import { connectAccount, type IposSnapshots } from "@fnb/runner";
import {
	mapSale,
	type StoreRecord,
	salePayloadRecord,
	toCanonicalStore,
} from "@fnb/sync";
import { createPostgresClient } from "@fnb/sync/postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	iposAccountsOf,
	snapshotFromDatabase,
} from "../../src/admin/snapshot-source.js";

const DATABASE_URL = process.env.DATABASE_URL;
const LIVE_TENANT = "live-local";
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const IGNORED = new Set(["raw", "status", "id", "invoice_id", "synced_at"]);

type Row = Record<string, unknown>;

async function liveTenantId(): Promise<string | null> {
	if (!DATABASE_URL) {
		return null;
	}
	const sql = createPostgresClient(DATABASE_URL);
	try {
		const [row] = await sql<{ id: string }[]>`
			select id from public.tenants where slug = ${LIVE_TENANT}
		`;
		return row?.id ?? null;
	} catch {
		return null;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

const tenantId = await liveTenantId();

function stable(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stable).join(",")}]`;
	}
	return `{${Object.entries(value as Row)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : 1))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
		.join(",")}}`;
}

function same(expected: unknown, actual: unknown): boolean {
	if (expected === null || expected === undefined) {
		return actual === null || actual === undefined;
	}
	if (typeof expected === "string" && typeof actual === "number") {
		return Number(expected) === actual;
	}
	if (
		typeof expected === "string" &&
		typeof actual === "string" &&
		TIMESTAMP.test(expected) &&
		TIMESTAMP.test(actual)
	) {
		return Date.parse(expected) === Date.parse(actual);
	}
	if (typeof expected === "object") {
		return stable(expected) === stable(actual);
	}
	return expected === actual;
}

function compareRow(
	expected: Row,
	actual: Row | undefined,
	table: string,
	fields: Map<string, number>,
): boolean {
	if (!actual) {
		fields.set(`${table}: missing`, (fields.get(`${table}: missing`) ?? 0) + 1);
		return false;
	}
	let equal = true;
	for (const [column, value] of Object.entries(expected)) {
		if (!IGNORED.has(column) && !same(value, actual[column])) {
			const name = `${table}.${column}`;
			fields.set(name, (fields.get(name) ?? 0) + 1);
			equal = false;
		}
	}
	return equal;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe.skipIf(tenantId === null)(
	`iPOS snapshot rebuilt from ${LIVE_TENANT}`,
	() => {
		it("replays every stored invoice, line, payment and store-day control total", async () => {
			const sql = createPostgresClient(DATABASE_URL ?? "");
			const network = vi.spyOn(globalThis, "fetch");
			const counts = {
				invoices: 0,
				lines: 0,
				payments: 0,
				payloads: 0,
				controlTotals: 0,
			};
			const differences = {
				invoices: 0,
				lines: 0,
				payments: 0,
				payloads: 0,
				controlTotals: 0,
				missingInvoices: 0,
				extraInvoices: 0,
			};
			const fields = new Map<string, number>();
			try {
				for (const account of await iposAccountsOf(sql, tenantId ?? "")) {
					const built = await snapshotFromDatabase(sql, account);
					const storage = createMemorySnapshotStorage();
					await writeSnapshot(storage, built.content, { origin: "database" });
					const snapshots: IposSnapshots = {
						open: () => storage,
						recordTo: () => null,
						warn: () => undefined,
					};
					const session = await connectAccount(
						{
							key: account.account_key,
							connector: "ipos-fabi",
							email: "snapshot@example.com",
							password: "never-sent",
						},
						{ IPOS_REAL_API: "off" },
						{ snapshots },
					);
					await session.connector.discoverStores();
					const stores = await sql<
						(StoreRecord & { opened_on: string | null })[]
					>`
						select id, tenant_id, pos_account_id, external_id, name, address, timezone,
							business_day_start_minutes, opened_on::text as opened_on, active, raw
						from public.stores where pos_account_id = ${account.id}
					`;
					for (const store of stores) {
						const canonical = toCanonicalStore(store, "VND");
						const [range] = await sql<
							{ from: string | null; to: string | null }[]
						>`
							select min(business_date)::text as from, max(business_date)::text as to
							from public.invoices where store_id = ${store.id}
						`;
						if (!range?.from || !range.to) {
							continue;
						}
						const sales = await collectSales(
							session.connector.fetchSales(canonical, {
								fromDate: range.from,
								toDate: range.to,
							}),
						);
						const invoices = new Map(
							(
								await sql<{ external_id: string; status: string; row: Row }[]>`
									select external_id, status::text as status, to_jsonb(i) as row
									from public.invoices i where store_id = ${store.id}
								`
							).map((entry) => [entry.external_id, entry]),
						);
						const lines = new Map(
							(
								await sql<{ key: string; row: Row }[]>`
									select i.external_id || E'\\n' || l.external_id as key, to_jsonb(l) as row
									from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
									where l.store_id = ${store.id}
								`
							).map((entry) => [entry.key, entry.row]),
						);
						const payments = new Map(
							(
								await sql<{ key: string; row: Row }[]>`
									select i.external_id || E'\\n' || p.sequence_no as key, to_jsonb(p) as row
									from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
									where p.store_id = ${store.id}
								`
							).map((entry) => [entry.key, entry.row]),
						);
						const records = new Map<string, unknown>();
						for (const day of await sql<{ payload: string }[]>`
							select payload from public.sale_payloads where store_id = ${store.id}
						`) {
							for (const line of day.payload.split("\n")) {
								const record = JSON.parse(line) as { external_id: string };
								records.set(record.external_id, record);
							}
						}
						const replayed = new Set<string>();
						for (const sale of sales) {
							replayed.add(sale.externalId);
							const stored = invoices.get(sale.externalId);
							if (!stored) {
								differences.extraInvoices += 1;
								continue;
							}
							const { write } = mapSale(sale, {
								tenantId: store.tenant_id,
								storeId: store.id,
								posAccountId: account.id,
								businessDate: sale.businessDate,
							});
							counts.invoices += 1;
							if (
								!compareRow(
									write.invoice as unknown as Row,
									stored.row,
									"invoices",
									fields,
								)
							) {
								differences.invoices += 1;
							}
							for (const line of write.lines) {
								counts.lines += 1;
								if (
									!compareRow(
										line as unknown as Row,
										lines.get(`${sale.externalId}\n${line.external_id}`),
										"invoice_lines",
										fields,
									)
								) {
									differences.lines += 1;
								}
							}
							for (const payment of write.payments) {
								counts.payments += 1;
								if (
									!compareRow(
										payment as unknown as Row,
										payments.get(`${sale.externalId}\n${payment.sequence_no}`),
										"invoice_payments",
										fields,
									)
								) {
									differences.payments += 1;
								}
							}
							const storedLines = [...lines.keys()].filter((key) =>
								key.startsWith(`${sale.externalId}\n`),
							).length;
							if (storedLines !== write.lines.length) {
								differences.lines += Math.abs(storedLines - write.lines.length);
							}
							counts.payloads += 1;
							if (
								stable(JSON.parse(salePayloadRecord(write))) !==
								stable(records.get(sale.externalId))
							) {
								differences.payloads += 1;
							}
						}
						for (const [externalId, stored] of invoices) {
							if (stored.status !== "voided" && !replayed.has(externalId)) {
								differences.missingInvoices += 1;
							}
						}
						const checks = await sql<
							{ business_date: string; invoices: number; net: number }[]
						>`
							select business_date::text as business_date, source_invoice_count as invoices,
								source_net_amount::float8 as net
							from public.sync_checks where store_id = ${store.id}
							order by business_date
						`;
						const first = checks[0]?.business_date;
						const last = checks.at(-1)?.business_date;
						if (!first || !last) {
							continue;
						}
						const totals = new Map(
							(
								(await session.connector.fetchControlTotals?.(canonical, {
									fromDate: first,
									toDate: last,
								})) ?? []
							).map((total) => [total.businessDate, total]),
						);
						for (const check of checks) {
							counts.controlTotals += 1;
							const total = totals.get(check.business_date);
							const matches =
								check.invoices === 0
									? (total?.invoiceCount ?? 0) === 0
									: total?.invoiceCount === check.invoices &&
										total.netAmount === check.net;
							if (!matches) {
								differences.controlTotals += 1;
							}
							totals.delete(check.business_date);
						}
						differences.controlTotals += totals.size;
					}
				}
			} finally {
				await sql.end({ timeout: 5 });
			}
			expect(network).not.toHaveBeenCalled();
			expect(counts.invoices).toBeGreaterThan(0);
			expect({
				differences,
				fields: Object.fromEntries(fields),
			}).toEqual({
				differences: {
					invoices: 0,
					lines: 0,
					payments: 0,
					payloads: 0,
					controlTotals: 0,
					missingInvoices: 0,
					extraInvoices: 0,
				},
				fields: {},
			});
			console.log(`compared counts: ${JSON.stringify(counts)}`);
		}, 600_000);
	},
);
