import {
	MILLISECONDS_PER_DAY,
	vietnamDateISO,
	vietnamMidnight,
} from "../time.js";

export type SnapshotRow = Record<string, unknown>;

export type SnapshotOrigin = "database" | "api";

export const SNAPSHOT_VERSION = 1;

export interface SnapshotManifest {
	version: typeof SNAPSHOT_VERSION;
	origin: SnapshotOrigin;
	coveredFrom: string | null;
	coveredTo: string | null;
	updatedAt: string;
}

export interface StoredResponse {
	status: number;
	body: unknown;
}

export interface SnapshotStorage {
	readManifest(): Promise<SnapshotManifest | null>;
	writeManifest(manifest: SnapshotManifest): Promise<void>;
	readResponse(key: string): Promise<StoredResponse | null>;
	writeResponse(key: string, response: StoredResponse): Promise<void>;
	readRows(key: string, month: string): Promise<SnapshotRow[]>;
	writeRows(
		key: string,
		month: string,
		rows: readonly SnapshotRow[],
	): Promise<void>;
}

export interface SnapshotCoverage {
	from: string;
	to: string;
}

export function emptyManifest(
	origin: SnapshotOrigin,
	now: Date,
): SnapshotManifest {
	return {
		version: SNAPSHOT_VERSION,
		origin,
		coveredFrom: null,
		coveredTo: null,
		updatedAt: now.toISOString(),
	};
}

export function manifestCoverage(
	manifest: SnapshotManifest | null,
): SnapshotCoverage | null {
	return manifest?.coveredFrom && manifest.coveredTo
		? { from: manifest.coveredFrom, to: manifest.coveredTo }
		: null;
}

export function widenCoverage(
	manifest: SnapshotManifest,
	from: string,
	to: string,
	now: Date,
): SnapshotManifest {
	return {
		...manifest,
		coveredFrom:
			manifest.coveredFrom === null || from < manifest.coveredFrom
				? from
				: manifest.coveredFrom,
		coveredTo:
			manifest.coveredTo === null || to > manifest.coveredTo
				? to
				: manifest.coveredTo,
		updatedAt: now.toISOString(),
	};
}

export function unionCoverage(
	coverages: readonly (SnapshotCoverage | null)[],
): SnapshotCoverage | null {
	const known = coverages.filter(
		(coverage): coverage is SnapshotCoverage => coverage !== null,
	);
	if (known.length === 0) {
		return null;
	}
	return {
		from: known.map((coverage) => coverage.from).sort()[0] ?? "",
		to:
			known
				.map((coverage) => coverage.to)
				.sort()
				.at(-1) ?? "",
	};
}

export function rowMonth(epochMs: number): string {
	return vietnamDateISO(epochMs).slice(0, 7);
}

const MAX_MONTHS = 240;

export function monthsBetween(startMs: number, endMs: number): string[] {
	const months: string[] = [];
	if (endMs < startMs) {
		return months;
	}
	const last = rowMonth(endMs);
	let [year, month] = rowMonth(startMs).split("-").map(Number) as [
		number,
		number,
	];
	for (let guard = 0; guard < MAX_MONTHS; guard += 1) {
		const label = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
		months.push(label);
		if (label >= last) {
			break;
		}
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
	}
	return months;
}

export function dayStartMs(date: string): number {
	return vietnamMidnight(date);
}

export function dayEndMs(date: string): number {
	return vietnamMidnight(date) + MILLISECONDS_PER_DAY - 1;
}

export function rowInRange(
	row: SnapshotRow,
	field: string,
	start: number | null,
	end: number | null,
): boolean {
	const value = Number(row[field]);
	if (!Number.isFinite(value)) {
		return false;
	}
	return (start === null || value >= start) && (end === null || value <= end);
}

export interface MemorySnapshotStorage extends SnapshotStorage {
	responseKeys(): string[];
	rowKeys(): string[];
}

export function createMemorySnapshotStorage(): MemorySnapshotStorage {
	let manifest: SnapshotManifest | null = null;
	const responses = new Map<string, StoredResponse>();
	const rows = new Map<string, Map<string, SnapshotRow[]>>();
	return {
		async readManifest() {
			return manifest === null ? null : structuredClone(manifest);
		},
		async writeManifest(next) {
			manifest = structuredClone(next);
		},
		async readResponse(key) {
			const stored = responses.get(key);
			return stored === undefined ? null : structuredClone(stored);
		},
		async writeResponse(key, response) {
			responses.set(key, structuredClone(response));
		},
		async readRows(key, month) {
			return structuredClone(rows.get(key)?.get(month) ?? []);
		},
		async writeRows(key, month, list) {
			const months = rows.get(key) ?? new Map<string, SnapshotRow[]>();
			months.set(month, structuredClone([...list]));
			rows.set(key, months);
		},
		responseKeys: () => [...responses.keys()].sort(),
		rowKeys: () => [...rows.keys()].sort(),
	};
}
