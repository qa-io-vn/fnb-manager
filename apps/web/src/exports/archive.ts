import type * as Fflate from "fflate";
import type { CsvDialect } from "../lib/csv";
import type { ExportFormat, ExportTableId, MonthKey } from "./plan";
import type { TotalsJson, UnverifiedReason } from "./totals";

export type ZipEngine = Pick<typeof Fflate, "Zip" | "ZipDeflate">;

export async function loadZipEngine(): Promise<ZipEngine> {
	return import("fflate");
}

export const MANIFEST_PATH = "manifest.json";
export const GUIDE_PATH = "doc-truoc.txt";
export const MANIFEST_FORMAT = "fnb-export-manifest";
export const MANIFEST_VERSION = 1;
export const DEFLATE_LEVEL = 6;

const ASCII_PATH = /^[\x21-\x7e]+$/;

export function entryTime(): Date {
	return new Date(1980, 0, 1, 0, 0, 0);
}

export interface ArchiveWriter {
	add(path: string, bytes: Uint8Array): void;
	finish(manifest: Uint8Array, guide: Uint8Array): Promise<Uint8Array[]>;
	abort(): void;
}

export function createArchiveWriter(engine: ZipEngine): ArchiveWriter {
	const chunks: Uint8Array[] = [];
	let settle: {
		resolve: (chunks: Uint8Array[]) => void;
		reject: (error: Error) => void;
	} | null = null;
	let failure: Error | null = null;
	let complete = false;
	const zip = new engine.Zip((error, chunk, final) => {
		if (error) {
			failure = error;
			settle?.reject(error);
			return;
		}
		chunks.push(chunk);
		if (final) {
			complete = true;
			settle?.resolve(chunks);
		}
	});
	const entry = (path: string) => {
		if (!ASCII_PATH.test(path)) {
			throw new RangeError(`archive paths are printable ASCII: ${path}`);
		}
		const file = new engine.ZipDeflate(path, { level: DEFLATE_LEVEL });
		file.mtime = entryTime();
		zip.add(file);
		return file;
	};
	const manifest = entry(MANIFEST_PATH);
	const guide = entry(GUIDE_PATH);
	return {
		add(path, bytes) {
			entry(path).push(bytes, true);
		},
		finish(manifestBytes, guideBytes) {
			const done = new Promise<Uint8Array[]>((resolve, reject) => {
				settle = { resolve, reject };
			});
			manifest.push(manifestBytes, true);
			guide.push(guideBytes, true);
			zip.end();
			if (failure !== null) return Promise.reject(failure);
			if (complete) return Promise.resolve(chunks);
			return done;
		},
		abort() {
			zip.terminate();
		},
	};
}

export interface ManifestStore {
	readonly label: string;
	readonly id: string;
	readonly name: string;
	readonly time_zone: string;
}

export interface ManifestFile {
	readonly path: string;
	readonly table: ExportTableId;
	readonly store: string | null;
	readonly month: MonthKey;
	readonly from: string;
	readonly to: string;
	readonly running: boolean;
	readonly rows: number;
	readonly bytes: number;
	readonly sha256: string;
	readonly received_bytes: number;
	readonly database_totals: TotalsJson | null;
	readonly exporter_totals: TotalsJson | null;
	readonly verified: boolean;
	readonly reason: UnverifiedReason | "aggregates_lag" | null;
}

export interface ManifestDailyCheck {
	readonly month: MonthKey;
	readonly store: string;
	readonly matched: boolean;
}

export interface ExportManifest {
	readonly format: typeof MANIFEST_FORMAT;
	readonly version: typeof MANIFEST_VERSION;
	readonly generated_at: string;
	readonly file_format: ExportFormat;
	readonly dialect: CsvDialect | null;
	readonly personal_columns: boolean;
	readonly first_month: MonthKey;
	readonly last_month: MonthKey;
	readonly stores: readonly ManifestStore[];
	readonly files: readonly ManifestFile[];
	readonly daily_summary_checks: readonly ManifestDailyCheck[];
	readonly egress: {
		readonly received_bytes: number;
		readonly estimated_bytes: number | null;
		readonly uncompressed_upper_bound: true;
	};
}

export function generatedAtOf(now: Date): string {
	return `${now.toISOString().slice(0, 19)}Z`;
}

export function manifestBytes(manifest: ExportManifest): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

export function archiveBlob(chunks: readonly Uint8Array[]): Blob {
	return new Blob(chunks as Uint8Array<ArrayBuffer>[], {
		type: "application/zip",
	});
}
