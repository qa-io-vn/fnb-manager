import {
	type ArchiveWriter,
	archiveBlob,
	createArchiveWriter,
	type ExportManifest,
	generatedAtOf,
	loadZipEngine,
	MANIFEST_FORMAT,
	MANIFEST_VERSION,
	type ManifestDailyCheck,
	type ManifestFile,
	manifestBytes,
	type ZipEngine,
} from "./archive";
import type { ExportCell, ExportRow, RecordOf } from "./columns";
import { columnsFor, storeTableRow } from "./columns";
import { dailySummaryIncludesAll, megabytes } from "./estimate";
import { guideText } from "./guide";
import {
	dailyFilePath,
	type ExportPlan,
	type ExportStore,
	type MonthKey,
	type MonthPlan,
	type StoreMonth,
	type StoreTableId,
	storeFilePath,
} from "./plan";
import {
	type DailySummaryRecord,
	EXPORT_PAGE_SIZE,
	type ExportReader,
	readTable,
	type StoreMonthScope,
	throwIfAborted,
} from "./reader";
import {
	type ControlTotals,
	dailySummaryMatches,
	MONEY_SCALE,
	minorUnits,
	sameTableTotals,
	sha256HexOfBytes,
	type TableTotals,
	totalsJson,
	totalsOfRecords,
	type UnverifiedReason,
	verdictOf,
} from "./totals";
import { fileBytes } from "./writers";

export const MAX_REREADS = 2;
export const MAX_REQUESTS_IN_FLIGHT = 2;

export type ExportProgress =
	| {
			readonly kind: "table";
			readonly month: MonthKey;
			readonly store: string;
			readonly table: StoreTableId;
			readonly rowsRead: number;
			readonly expectedRows: number;
			readonly attempt: number;
	  }
	| {
			readonly kind: "daily_summary";
			readonly month: MonthKey;
	  }
	| {
			readonly kind: "store_month_done";
			readonly month: MonthKey;
			readonly store: string;
			readonly verified: boolean;
	  };

export interface RunExportOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: ExportProgress) => void;
	readonly pageSize?: number;
	readonly now?: () => Date;
	readonly estimatedBytes?: number | null;
	readonly zipEngine?: ZipEngine;
}

export interface StoreMonthCheck {
	readonly month: MonthKey;
	readonly store: string;
	readonly storeName: string;
	readonly running: boolean;
	readonly verified: boolean;
	readonly reason: UnverifiedReason | null;
	readonly rereads: number;
	readonly rows: Readonly<Partial<Record<StoreTableId, number>>>;
}

export interface ExportResult {
	readonly archive: Blob;
	readonly archiveName: string;
	readonly manifest: ExportManifest;
	readonly checks: readonly StoreMonthCheck[];
	readonly dailyChecks: readonly ManifestDailyCheck[];
	readonly receivedBytes: number;
}

interface TableResult {
	readonly records: readonly RecordOf<StoreTableId>[];
	readonly totals: TableTotals;
	readonly bytes: number;
}

interface StoreMonthResult {
	readonly tables: Readonly<Partial<Record<StoreTableId, TableResult>>>;
	readonly control: ControlTotals;
	readonly verified: Readonly<Partial<Record<StoreTableId, boolean>>>;
	readonly reason: UnverifiedReason | null;
	readonly rereads: number;
	readonly bytes: number;
}

async function inPairs<T>(
	tasks: readonly (() => Promise<T>)[],
	limit: number,
): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let next = 0;
	const worker = async () => {
		for (;;) {
			const index = next;
			next += 1;
			const task = tasks[index];
			if (task === undefined) return;
			results[index] = await task();
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, tasks.length) }, worker),
	);
	return results;
}

function scopeOf(storeMonth: StoreMonth): StoreMonthScope {
	return {
		storeId: storeMonth.store.id,
		from: storeMonth.from,
		to: storeMonth.to,
		timeZone: storeMonth.store.timeZone,
		businessDayStartMinutes: storeMonth.store.businessDayStartMinutes,
	};
}

async function readStoreMonth(
	plan: ExportPlan,
	storeMonth: StoreMonth,
	reader: ExportReader,
	options: RunExportOptions,
): Promise<StoreMonthResult> {
	const scope = scopeOf(storeMonth);
	const signal = options.signal;
	let bytes = 0;
	const first = await reader.controlTotals(scope, signal);
	bytes += first.bytes;
	let before = first.value;
	for (let attempt = 0; ; attempt += 1) {
		const tasks = plan.storeTables.map((table) => async () => {
			const read = await readTable(reader, {
				table,
				scope,
				expectedRows: before.tables[table].rows,
				pageSize: options.pageSize ?? EXPORT_PAGE_SIZE,
				personal: plan.request.personal,
				signal,
				onPage: (rowsRead) =>
					options.onProgress?.({
						kind: "table",
						month: storeMonth.month,
						store: storeMonth.store.label,
						table,
						rowsRead,
						expectedRows: before.tables[table].rows,
						attempt,
					}),
			});
			const totals = await totalsOfRecords(table, read.records);
			return [
				table,
				{ records: read.records, totals, bytes: read.bytes },
			] as const;
		});
		const results = await inPairs(tasks, MAX_REQUESTS_IN_FLIGHT);
		const tables: Partial<Record<StoreTableId, TableResult>> = {};
		for (const [table, result] of results) {
			tables[table] = result;
			bytes += result.bytes;
		}
		throwIfAborted(signal);
		const second = await reader.controlTotals(scope, signal);
		bytes += second.bytes;
		const after = second.value;
		const own: Partial<Record<StoreTableId, TableTotals>> = {};
		for (const table of plan.storeTables) {
			const result = tables[table];
			if (result) own[table] = result.totals;
		}
		const verdict = verdictOf(own, before, after, MAX_REREADS - attempt);
		if (verdict.kind === "reread") {
			before = after;
			continue;
		}
		const verified: Partial<Record<StoreTableId, boolean>> = {};
		for (const table of plan.storeTables) {
			const mine = own[table];
			verified[table] =
				mine !== undefined && sameTableTotals(mine, after.tables[table]);
		}
		return {
			tables,
			control: after,
			verified,
			reason: verdict.kind === "unverified" ? verdict.reason : null,
			rereads: attempt,
			bytes,
		};
	}
}

function storeNameOf(
	stores: readonly ExportStore[],
	storeId: string | null,
): ExportStore | null {
	return storeId === null
		? null
		: (stores.find((store) => store.id === storeId) ?? null);
}

function dailyCell(value: unknown): ExportCell {
	if (value === undefined) return null;
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	return String(value);
}

interface DailyRows {
	readonly rows: ExportRow[];
	readonly records: readonly { store: string; record: DailySummaryRecord }[];
	readonly bytes: number;
}

async function readDailySummary(
	month: MonthPlan,
	reader: ExportReader,
	signal: AbortSignal | undefined,
): Promise<DailyRows> {
	const stores = month.storeMonths.map((storeMonth) => storeMonth.store);
	const collected: { store: ExportStore | null; record: DailySummaryRecord }[] =
		[];
	let bytes = 0;
	if (dailySummaryIncludesAll(month)) {
		const received = await reader.dailySummary(
			stores.map((store) => store.id),
			month.from,
			month.to,
			true,
			signal,
		);
		bytes += received.bytes;
		for (const record of received.value) {
			collected.push({
				store: storeNameOf(stores, record.store_id),
				record,
			});
		}
	} else {
		for (const store of stores) {
			const received = await reader.dailySummary(
				[store.id],
				month.from,
				month.to,
				false,
				signal,
			);
			bytes += received.bytes;
			for (const record of received.value) collected.push({ store, record });
		}
	}
	const position = (store: ExportStore | null) =>
		store === null ? -1 : stores.indexOf(store);
	collected.sort(
		(left, right) =>
			(left.record.bucket_start < right.record.bucket_start
				? -1
				: left.record.bucket_start > right.record.bucket_start
					? 1
					: 0) || position(left.store) - position(right.store),
	);
	const columns = columnsFor("daily_summary", false);
	const rows = collected.map(({ store, record }) => {
		const row: Record<string, ExportCell> = {};
		const source = record as Readonly<Record<string, unknown>>;
		for (const column of columns) row[column] = dailyCell(source[column]);
		row.business_date = record.bucket_start;
		row.scope = store === null ? "ALL" : store.label;
		row.store_name = store === null ? "" : store.name;
		return row;
	});
	return {
		rows,
		records: collected
			.filter((entry) => entry.store !== null)
			.map((entry) => ({
				store: (entry.store as ExportStore).id,
				record: entry.record,
			})),
		bytes,
	};
}

function dailyFigures(
	records: DailyRows["records"],
	storeMonth: StoreMonth,
): { netAmount: bigint; invoices: number } {
	let netAmount = 0n;
	let invoices = 0;
	for (const { store, record } of records) {
		if (store !== storeMonth.store.id) continue;
		if (record.bucket_start < storeMonth.from) continue;
		if (record.bucket_start > storeMonth.to) continue;
		netAmount += minorUnits(record.net_amount ?? 0, MONEY_SCALE);
		invoices += record.invoices ?? 0;
	}
	return { netAmount, invoices };
}

const GUIDE_TABLE_NOUNS: Readonly<Record<StoreTableId, string>> = {
	invoices: "hóa đơn",
	invoice_lines: "dòng",
	invoice_payments: "thanh toán",
	shifts: "ca",
};

const GUIDE_REASONS: Readonly<Record<UnverifiedReason, string>> = {
	changed: "chưa khớp, dữ liệu thay đổi trong lúc xuất",
	mismatch: "chưa khớp, cần báo lỗi",
};

export function guideCheckLine(check: StoreMonthCheck): string {
	const parts = (Object.entries(check.rows) as [StoreTableId, number][]).map(
		([table, rows]) => `${rows} ${GUIDE_TABLE_NOUNS[table]}`,
	);
	const verdict = check.verified
		? "khớp"
		: GUIDE_REASONS[check.reason ?? "mismatch"];
	return `${check.month} ${check.store}: ${parts.join(" · ")} — ${verdict}`;
}

async function addFile(
	archive: ArchiveWriter,
	file: Omit<ManifestFile, "bytes" | "sha256">,
	bytes: Uint8Array,
	files: ManifestFile[],
): Promise<void> {
	const sha256 = await sha256HexOfBytes(bytes);
	archive.add(file.path, bytes);
	files.push({ ...file, bytes: bytes.length, sha256 });
}

export async function runExport(
	plan: ExportPlan,
	reader: ExportReader,
	options: RunExportOptions = {},
): Promise<ExportResult> {
	const signal = options.signal;
	const request = plan.request;
	throwIfAborted(signal);
	const engine = options.zipEngine ?? (await loadZipEngine());
	throwIfAborted(signal);
	const archive = createArchiveWriter(engine);
	const files: ManifestFile[] = [];
	const checks: StoreMonthCheck[] = [];
	const dailyChecks: ManifestDailyCheck[] = [];
	let receivedTotal = 0;
	try {
		for (const month of plan.months) {
			let daily: DailyRows | null = null;
			let dailyFileIndex = -1;
			if (plan.dailySummary) {
				options.onProgress?.({ kind: "daily_summary", month: month.month });
				daily = await readDailySummary(month, reader, signal);
				receivedTotal += daily.bytes;
				dailyFileIndex = files.length;
				await addFile(
					archive,
					{
						path: dailyFilePath(month.month, request.format),
						table: "daily_summary",
						store: null,
						month: month.month,
						from: month.from,
						to: month.to,
						running: month.storeMonths.some((storeMonth) => storeMonth.running),
						rows: daily.rows.length,
						received_bytes: daily.bytes,
						database_totals: null,
						exporter_totals: null,
						verified: true,
						reason: null,
					},
					fileBytes({
						format: request.format,
						dialect: request.dialect,
						meta: { table: "daily_summary", store: null, month: month.month },
						columns: columnsFor("daily_summary", false),
						rows: daily.rows,
					}),
					files,
				);
			}
			const monthDailyChecks: ManifestDailyCheck[] = [];
			for (const storeMonth of month.storeMonths) {
				const result = await readStoreMonth(plan, storeMonth, reader, options);
				receivedTotal += result.bytes;
				const rows: Partial<Record<StoreTableId, number>> = {};
				for (const table of plan.storeTables) {
					const tableResult = result.tables[table];
					if (tableResult === undefined) continue;
					rows[table] = tableResult.records.length;
					const columns = columnsFor(table, request.personal);
					await addFile(
						archive,
						{
							path: storeFilePath(
								storeMonth.month,
								storeMonth.store.label,
								table,
								request.format,
							),
							table,
							store: storeMonth.store.label,
							month: storeMonth.month,
							from: storeMonth.from,
							to: storeMonth.to,
							running: storeMonth.running,
							rows: tableResult.records.length,
							received_bytes: tableResult.bytes,
							database_totals: totalsJson(result.control.tables[table]),
							exporter_totals: totalsJson(tableResult.totals),
							verified: result.verified[table] === true,
							reason:
								result.verified[table] === true
									? null
									: (result.reason ?? "mismatch"),
						},
						fileBytes({
							format: request.format,
							dialect: request.dialect,
							meta: {
								table,
								store: storeMonth.store.label,
								month: storeMonth.month,
							},
							columns,
							rows: tableResult.records.map((record) =>
								storeTableRow(table, record, storeMonth.store),
							),
						}),
						files,
					);
				}
				const verified = plan.storeTables.every(
					(table) => result.verified[table] === true,
				);
				checks.push({
					month: storeMonth.month,
					store: storeMonth.store.label,
					storeName: storeMonth.store.name,
					running: storeMonth.running,
					verified,
					reason: verified ? null : result.reason,
					rereads: result.rereads,
					rows,
				});
				if (daily !== null) {
					monthDailyChecks.push({
						month: storeMonth.month,
						store: storeMonth.store.label,
						matched: dailySummaryMatches(
							dailyFigures(daily.records, storeMonth),
							result.control,
						),
					});
				}
				options.onProgress?.({
					kind: "store_month_done",
					month: storeMonth.month,
					store: storeMonth.store.label,
					verified,
				});
			}
			dailyChecks.push(...monthDailyChecks);
			const dailyFile = files[dailyFileIndex];
			if (dailyFile !== undefined && dailyFileIndex >= 0) {
				const matched = monthDailyChecks.every((check) => check.matched);
				files[dailyFileIndex] = {
					...dailyFile,
					verified: matched,
					reason: matched ? null : "aggregates_lag",
				};
			}
		}
		throwIfAborted(signal);
		const now = options.now?.() ?? new Date();
		const manifest: ExportManifest = {
			format: MANIFEST_FORMAT,
			version: MANIFEST_VERSION,
			generated_at: generatedAtOf(now),
			file_format: request.format,
			dialect: request.format === "csv" ? request.dialect : null,
			personal_columns: request.personal,
			first_month: request.firstMonth,
			last_month: request.lastMonth,
			stores: plan.stores.map((store) => ({
				label: store.label,
				id: store.id,
				name: store.name,
				time_zone: store.timeZone,
			})),
			files,
			daily_summary_checks: dailyChecks,
			egress: {
				received_bytes: receivedTotal,
				estimated_bytes: options.estimatedBytes ?? null,
				uncompressed_upper_bound: true,
			},
		};
		const guide = new TextEncoder().encode(
			`\u{FEFF}${guideText({
				format: request.format,
				dialect: request.dialect,
				personal: request.personal,
				firstMonth: request.firstMonth,
				lastMonth: request.lastMonth,
				receivedMegabytes: megabytes(receivedTotal).toFixed(1),
				verificationLines: checks.map(guideCheckLine),
			})}`,
		);
		const chunks = await archive.finish(manifestBytes(manifest), guide);
		return {
			archive: archiveBlob(chunks),
			archiveName: plan.archiveName,
			manifest,
			checks,
			dailyChecks,
			receivedBytes: receivedTotal,
		};
	} catch (error) {
		archive.abort();
		throw error;
	}
}
