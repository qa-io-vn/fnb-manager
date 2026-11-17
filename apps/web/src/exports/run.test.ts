import * as fflate from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { ExportManifest } from "./archive";
import { type ExportRequest, type ExportStore, planExport } from "./plan";
import { createExportReader, isAbortError } from "./reader";
import { type ExportProgress, runExport } from "./run";
import {
	createFakePostgrest,
	type FakePostgrestOptions,
	type FakeStore,
	type FakeTables,
	oracleControlTotals,
} from "./testing/fake-postgrest";
import {
	cloneTables,
	STORE_ONE,
	STORE_TWO,
	syntheticTables,
} from "./testing/synthetic-data";
import { zipEntries } from "./testing/zip-entries";

const NOW = new Date("2026-11-16T03:00:00Z");
const originalZone = process.env.TZ;
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function exportStore(store: FakeStore): ExportStore {
	return {
		id: store.id,
		label: store.label,
		name: store.name,
		timeZone: store.timeZone,
		businessDayStartMinutes: store.businessDayStartMinutes,
		asOf: "2026-11-15",
	};
}

function baseTables(): FakeTables {
	return syntheticTables({
		stores: [STORE_ONE, STORE_TWO],
		from: "2026-09-29",
		to: "2026-11-16",
		invoicesPerDay: 6,
	});
}

function request(overrides: Partial<ExportRequest> = {}): ExportRequest {
	return {
		stores: [exportStore(STORE_ONE), exportStore(STORE_TWO)],
		firstMonth: "2026-10",
		lastMonth: "2026-11",
		tables: [
			"invoices",
			"invoice_lines",
			"invoice_payments",
			"shifts",
			"daily_summary",
		],
		format: "csv",
		dialect: "comma",
		personal: false,
		...overrides,
	};
}

interface RunOutcome {
	readonly bytes: Uint8Array;
	readonly manifest: ExportManifest;
	readonly result: Awaited<ReturnType<typeof runExport>>;
	readonly fake: ReturnType<typeof createFakePostgrest>;
	readonly progress: ExportProgress[];
}

async function exportWith(
	options: {
		readonly request?: Partial<ExportRequest>;
		readonly fake?: Partial<FakePostgrestOptions>;
		readonly pageSize?: number;
		readonly signal?: AbortSignal;
	} = {},
): Promise<RunOutcome> {
	const planned = planExport(request(options.request));
	if (!planned.ok) throw new Error(planned.error);
	const fake = createFakePostgrest({
		stores: [STORE_ONE, STORE_TWO],
		tables: baseTables(),
		...options.fake,
	});
	const progress: ExportProgress[] = [];
	const result = await runExport(
		planned.plan,
		createExportReader(fake.client),
		{
			now: () => NOW,
			zipEngine: fflate,
			onProgress: (event) => progress.push(event),
			...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
	);
	const bytes = new Uint8Array(await result.archive.arrayBuffer());
	return { bytes, manifest: result.manifest, result, fake, progress };
}

function fileText(bytes: Uint8Array, path: string): string {
	const file = fflate.unzipSync(bytes)[path];
	if (file === undefined) throw new Error(`no ${path} in the archive`);
	return strict.decode(file);
}

describe("running an export", () => {
	afterEach(() => {
		process.env.TZ = originalZone;
	});

	it("verifies every file against the database and writes the manifest", async () => {
		const { bytes, manifest, result, fake } = await exportWith();
		expect(result.archiveName).toBe("fnb-xuat-du-lieu_2026-10_2026-11.zip");
		expect(manifest.files.every((file) => file.verified)).toBe(true);
		expect(result.checks.every((check) => check.verified)).toBe(true);
		expect(result.dailyChecks.every((check) => check.matched)).toBe(true);
		const entries = zipEntries(bytes).map((entry) => entry.name);
		expect(entries.slice(0, 3)).toEqual([
			"manifest.json",
			"doc-truoc.txt",
			"2026-10/tong-hop-ngay.csv",
		]);
		expect(entries.slice(2)).toEqual(manifest.files.map((file) => file.path));
		expect(JSON.parse(fileText(bytes, "manifest.json"))).toEqual(manifest);
		const invoices = manifest.files.find(
			(file) => file.path === "2026-10/S1/hoa-don.csv",
		);
		const oracle = oracleControlTotals(
			fake.tables,
			STORE_ONE.id,
			"2026-10-01",
			"2026-10-31",
		);
		expect(invoices).toMatchObject({
			table: "invoices",
			store: "S1",
			month: "2026-10",
			running: false,
			rows: oracle.invoices,
			database_totals: {
				rows: oracle.invoices,
				voided: oracle.voided_invoices,
				amount: oracle.sales_net_amount,
				fingerprint: oracle.invoice_fingerprint,
			},
			exporter_totals: { fingerprint: oracle.invoice_fingerprint },
			verified: true,
			reason: null,
		});
		expect(
			manifest.files.find((file) => file.path === "2026-11/S2/ca.csv"),
		).toMatchObject({ running: true, to: "2026-11-15" });
		expect(manifest).toMatchObject({
			format: "fnb-export-manifest",
			version: 1,
			generated_at: "2026-11-16T03:00:00Z",
			file_format: "csv",
			dialect: "comma",
			personal_columns: false,
			first_month: "2026-10",
			last_month: "2026-11",
			stores: [
				{
					label: "S1",
					id: STORE_ONE.id,
					name: STORE_ONE.name,
					time_zone: "Asia/Ho_Chi_Minh",
				},
				{
					label: "S2",
					id: STORE_TWO.id,
					name: STORE_TWO.name,
					time_zone: "Asia/Ho_Chi_Minh",
				},
			],
			egress: { uncompressed_upper_bound: true },
		});
		expect(manifest.egress.received_bytes).toBeGreaterThan(
			manifest.files.reduce((sum, file) => sum + file.received_bytes, 0),
		);
		for (const file of manifest.files) {
			const content = fflate.unzipSync(bytes)[file.path] as Uint8Array;
			expect(content.length, file.path).toBe(file.bytes);
			expect([...content.slice(0, 3)], file.path).toEqual([0xef, 0xbb, 0xbf]);
			expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it("keeps Vietnamese names intact and leaves personal columns out by default", async () => {
		const { bytes } = await exportWith();
		const invoices = fileText(bytes, "2026-10/S1/hoa-don.csv");
		expect(invoices).toContain("Cửa hàng mẫu số 1");
		expect(invoices).not.toContain("customer_phone");
		expect(invoices).not.toContain("Khách Nguyễn");
		const shifts = fileText(bytes, "2026-10/S2/ca.csv");
		expect(shifts).toContain('"Quán ""Đêm""; số 2, tầng 1"');
		expect(shifts).not.toContain("cashier@example.com");
		const daily = fileText(bytes, "2026-10/tong-hop-ngay.csv").split("\r\n");
		expect(daily[1]?.startsWith("2026-10-01,ALL,,")).toBe(true);
		expect(daily[2]?.startsWith("2026-10-01,S1,Cửa hàng mẫu số 1,")).toBe(true);
	});

	it("includes personal columns only when asked", async () => {
		const { bytes, manifest } = await exportWith({
			request: { personal: true },
		});
		expect(manifest.personal_columns).toBe(true);
		expect(fileText(bytes, "2026-10/S1/hoa-don.csv")).toContain("Khách Nguyễn");
		expect(fileText(bytes, "2026-10/S1/ca.csv")).toContain(
			"cashier@example.com",
		);
		expect(fileText(bytes, "2026-10/S1/thanh-toan.csv")).toContain("REF-001");
		expect(fileText(bytes, "doc-truoc.txt")).toContain("customer_phone");
	});

	it("gives identical archives with 97-row and 1,000-row pages", async () => {
		const large = await exportWith();
		const small = await exportWith({ pageSize: 97 });
		expect(small.fake.requests.length).toBeGreaterThan(
			large.fake.requests.length,
		);
		const strip = (manifest: ExportManifest) =>
			manifest.files.map(({ received_bytes: _ignored, ...file }) => file);
		expect(strip(small.manifest)).toEqual(strip(large.manifest));
		for (const file of large.manifest.files) {
			expect(fileText(small.bytes, file.path), file.path).toBe(
				fileText(large.bytes, file.path),
			);
		}
	});

	it("writes the same archive bytes in two time zones", async () => {
		process.env.TZ = "Asia/Ho_Chi_Minh";
		const first = await exportWith({ request: { format: "json" } });
		process.env.TZ = "America/Los_Angeles";
		const second = await exportWith({ request: { format: "json" } });
		expect(second.bytes).toEqual(first.bytes);
		const document = JSON.parse(
			fileText(first.bytes, "2026-10/S1/hoa-don.json"),
		);
		expect(document.format).toBe("fnb-export");
		expect(document.rows[0].sold_at_local).toMatch(
			/^2026-10-01 \d{2}:\d{2}:\d{2}$/,
		);
		expect([
			...(fflate.unzipSync(first.bytes)["2026-10/S1/hoa-don.json"] ?? []).slice(
				0,
				1,
			),
		]).toEqual([0x7b]);
	});

	it("re-reads a store-month when a sync commits during the read", async () => {
		let inserted = false;
		const { manifest, result } = await exportWith({
			request: {
				firstMonth: "2026-10",
				lastMonth: "2026-10",
				stores: [exportStore(STORE_ONE)],
				tables: ["invoices", "invoice_lines", "invoice_payments", "shifts"],
			},
			fake: {
				beforeRequest: (index, tables) => {
					if (index !== 2 || inserted) return;
					inserted = true;
					const template = tables.invoices.find(
						(row) =>
							row.store_id === STORE_ONE.id &&
							row.business_date === "2026-10-01",
					);
					if (template) {
						tables.invoices.push({
							...template,
							id: "00000000-0000-4000-8000-00000000000a",
							external_id: "HD-LATE",
						});
					}
				},
			},
		});
		expect(inserted).toBe(true);
		expect(result.checks[0]).toMatchObject({ verified: true, rereads: 1 });
		expect(manifest.files.every((file) => file.verified)).toBe(true);
	});

	it("marks files unverified with the reason changed when the data keeps moving", async () => {
		let extra = 0;
		const { manifest, result, fake } = await exportWith({
			request: {
				firstMonth: "2026-10",
				lastMonth: "2026-10",
				stores: [exportStore(STORE_ONE)],
				tables: ["invoices"],
			},
			fake: {
				beforeRpc: (name, _index, tables) => {
					if (name !== "export_control_totals") return;
					extra += 1;
					const template = tables.invoices.find(
						(row) =>
							row.store_id === STORE_ONE.id &&
							row.business_date === "2026-10-02",
					);
					if (template) {
						tables.invoices.push({
							...template,
							id: `00000000-0000-4000-8000-${String(extra).padStart(12, "0")}`,
							external_id: `HD-MOVING-${extra}`,
						});
					}
				},
			},
		});
		expect(
			fake.rpcCalls.filter((call) => call.name === "export_control_totals"),
		).toHaveLength(4);
		expect(result.checks[0]).toMatchObject({
			verified: false,
			reason: "changed",
			rereads: 2,
		});
		expect(manifest.files[0]).toMatchObject({
			path: "2026-10/S1/hoa-don.csv",
			verified: false,
			reason: "changed",
		});
	});

	it("marks a file as a mismatch when the database stands still but disagrees", async () => {
		const { manifest, result } = await exportWith({
			request: {
				firstMonth: "2026-10",
				lastMonth: "2026-10",
				stores: [exportStore(STORE_ONE)],
				tables: ["invoices", "shifts"],
			},
			fake: {
				controlTotalsOverride: (row) => ({
					...row,
					shift_fingerprint: "0".repeat(64),
				}),
			},
		});
		expect(result.checks[0]).toMatchObject({
			verified: false,
			reason: "mismatch",
			rereads: 0,
		});
		expect(manifest.files.map((file) => [file.table, file.verified])).toEqual([
			["invoices", true],
			["shifts", false],
		]);
	});

	it("reports a daily summary that lags the invoices without unverifying them", async () => {
		let added = false;
		const { manifest, result } = await exportWith({
			request: { firstMonth: "2026-10", lastMonth: "2026-10" },
			fake: {
				beforeRpc: (name, _index, tables) => {
					if (name !== "export_control_totals" || added) return;
					added = true;
					const template = tables.invoices.find(
						(row) =>
							row.store_id === STORE_ONE.id &&
							row.business_date === "2026-10-03" &&
							row.status === "completed",
					);
					if (template) {
						tables.invoices.push({
							...template,
							id: "00000000-0000-4000-8000-0000000000bb",
							external_id: "HD-AFTER-SUMMARY",
						});
					}
				},
			},
		});
		expect(result.dailyChecks).toEqual([
			{ month: "2026-10", store: "S1", matched: false },
			{ month: "2026-10", store: "S2", matched: true },
		]);
		expect(manifest.files[0]).toMatchObject({
			table: "daily_summary",
			verified: false,
			reason: "aggregates_lag",
		});
		expect(
			manifest.files
				.filter((file) => file.table !== "daily_summary")
				.every((file) => file.verified),
		).toBe(true);
	});

	it("asks the daily summary store by store when stores plus one times days would pass 900 rows", async () => {
		const stores: FakeStore[] = Array.from({ length: 29 }, (_, index) => ({
			...STORE_TWO,
			id: `${STORE_TWO.id.slice(0, -3)}${String(index).padStart(3, "0")}`,
			label: `S${index + 1}`,
			name: `Cửa hàng ${index + 1}`,
		}));
		const { manifest, result, fake, bytes } = await exportWith({
			request: {
				stores: stores.map(exportStore),
				firstMonth: "2026-10",
				lastMonth: "2026-10",
				tables: ["daily_summary"],
			},
			fake: {
				stores,
				tables: syntheticTables({
					stores,
					from: "2026-10-01",
					to: "2026-10-31",
					invoicesPerDay: 1,
				}),
			},
		});
		const calls = fake.rpcCalls.filter((call) => call.name === "period_series");
		expect(calls).toHaveLength(29);
		expect(
			calls.every(
				(call) =>
					call.args.include_stores === false &&
					(call.args.store_ids as string[]).length === 1,
			),
		).toBe(true);
		const lines = fileText(bytes, "2026-10/tong-hop-ngay.csv")
			.trimEnd()
			.split("\r\n");
		expect(lines).toHaveLength(1 + 29 * 31);
		expect(lines.some((line) => line.split(",")[1] === "ALL")).toBe(false);
		expect(result.dailyChecks.every((check) => check.matched)).toBe(true);
		expect(manifest.files).toHaveLength(1);
		expect(manifest.files[0]).toMatchObject({ rows: 29 * 31, verified: true });
	});

	it("keeps at most two requests in flight and reports progress per table", async () => {
		const { fake, progress } = await exportWith({ pageSize: 50 });
		expect(fake.maxInFlight()).toBe(2);
		const tableEvents = progress.filter((event) => event.kind === "table");
		expect(tableEvents.length).toBeGreaterThan(8);
		expect(tableEvents[0]).toMatchObject({ month: "2026-10", store: "S1" });
		expect(
			progress.filter((event) => event.kind === "store_month_done"),
		).toHaveLength(4);
	});

	it("stops cleanly when aborted", async () => {
		const controller = new AbortController();
		const planned = planExport(request());
		if (!planned.ok) throw new Error(planned.error);
		const fake = createFakePostgrest({
			stores: [STORE_ONE, STORE_TWO],
			tables: cloneTables(baseTables()),
		});
		let startedAtAbort = -1;
		const run = runExport(planned.plan, createExportReader(fake.client), {
			zipEngine: fflate,
			pageSize: 20,
			onProgress: (event) => {
				if (event.kind !== "table" || controller.signal.aborted) return;
				startedAtAbort = fake.startedRequests();
				controller.abort();
			},
			signal: controller.signal,
		});
		const failure = await run.then(
			() => null,
			(error: unknown) => error,
		);
		expect(isAbortError(failure)).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(startedAtAbort).toBeGreaterThan(0);
		expect(fake.startedRequests()).toBe(startedAtAbort);
	});
});
