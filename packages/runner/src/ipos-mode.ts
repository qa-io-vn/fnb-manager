import { DEFAULT_BASE_URL } from "@fnb/connector-ipos";
import {
	manifestCoverage,
	type SnapshotCoverage,
	type SnapshotStorage,
	unionCoverage,
} from "@fnb/connector-ipos/snapshot";
import { AccountConfigError, type AccountEntry } from "./accounts.js";

export const IPOS_REAL_API_VARIABLE = "IPOS_REAL_API";

export type IposApiMode = "real" | "snapshot";

export const IPOS_API_HOST = new URL(DEFAULT_BASE_URL).host;

export interface IposSnapshots {
	open(accountKey: string): SnapshotStorage;
	recordTo(accountKey: string): SnapshotStorage | null;
	warn(message: string): void;
}

export function iposApiMode(
	environment: Readonly<Record<string, string | undefined>>,
): IposApiMode {
	const raw = environment[IPOS_REAL_API_VARIABLE]?.trim() ?? "";
	switch (raw.toLowerCase()) {
		case "":
		case "on":
			return "real";
		case "off":
			return "snapshot";
		default:
			throw new AccountConfigError(
				`${IPOS_REAL_API_VARIABLE} must be on or off, not "${raw}"`,
			);
	}
}

export function usesIpos(entries: readonly AccountEntry[]): boolean {
	return entries.some((entry) => entry.connector === "ipos-fabi");
}

export function iposModeLine(
	mode: IposApiMode,
	coverage: SnapshotCoverage | null,
): string {
	if (mode === "real") {
		return `iPOS: REAL API (${IPOS_API_HOST})`;
	}
	return coverage === null
		? "iPOS: snapshot, none built yet (no network)"
		: `iPOS: snapshot of ${coverage.from}..${coverage.to} (no network)`;
}

export async function snapshotCoverage(
	snapshots: IposSnapshots,
	entries: readonly AccountEntry[],
): Promise<SnapshotCoverage | null> {
	const manifests = await Promise.all(
		entries
			.filter((entry) => entry.connector === "ipos-fabi")
			.map((entry) => snapshots.open(entry.key).readManifest()),
	);
	return unionCoverage(manifests.map(manifestCoverage));
}

export function requestCountText(
	count: number,
	mode: IposApiMode | null,
): string {
	return mode === "snapshot"
		? `iPOS snapshot requests ${count} (no network)`
		: `POS HTTP requests ${count}`;
}
