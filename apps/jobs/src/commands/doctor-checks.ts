import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

export type Health = "green" | "yellow" | "red" | "unavailable";

export interface DoctorCheck {
	name: string;
	health: Health;
	detail: string;
}

export const BYTES_PER_MIB = 1024 * 1024;
export const FREE_PLAN_DATABASE_MIB = 500;
export const UPGRADE_TRIGGER_MIB = 400;
export const DATABASE_RED_MIB = FREE_PLAN_DATABASE_MIB * 0.95;
export const PAUSE_AFTER_DAYS = 7;

export function toMebibytes(bytes: number): number {
	return bytes / BYTES_PER_MIB;
}

export function databaseSizeHealth(bytes: number): Health {
	const mebibytes = toMebibytes(bytes);
	if (mebibytes >= DATABASE_RED_MIB) {
		return "red";
	}
	return mebibytes >= UPGRADE_TRIGGER_MIB ? "yellow" : "green";
}

export function databaseSizeDetail(bytes: number): string {
	return `${toMebibytes(bytes).toFixed(1)} MiB of the ${FREE_PLAN_DATABASE_MIB} MiB free-plan quota (upgrade trigger ${UPGRADE_TRIGGER_MIB} MiB, red from ${DATABASE_RED_MIB} MiB)`;
}

export function syncAgeHealth(hours: number | null): Health {
	if (hours === null) {
		return "yellow";
	}
	if (hours > 72) {
		return "red";
	}
	return hours > 26 ? "yellow" : "green";
}

export function pauseRiskHealth(daysIdle: number | null): Health {
	if (daysIdle === null || daysIdle >= PAUSE_AFTER_DAYS) {
		return "red";
	}
	return daysIdle >= PAUSE_AFTER_DAYS - 2 ? "yellow" : "green";
}

export function migrationFiles(rootDir: string): string[] {
	return readdirSync(join(rootDir, "supabase", "migrations"))
		.filter((file) => file.endsWith(".sql"))
		.map((file) => file.split("_")[0] ?? file)
		.sort();
}

export interface MigrationDrift {
	missing: string[];
	unknown: string[];
}

export function migrationDrift(
	files: readonly string[],
	applied: readonly string[],
): MigrationDrift {
	const appliedSet = new Set(applied);
	const fileSet = new Set(files);
	return {
		missing: files.filter((version) => !appliedSet.has(version)),
		unknown: applied.filter((version) => !fileSet.has(version)),
	};
}

export async function appliedMigrations(sql: Sql): Promise<string[] | null> {
	const [probe] = await sql<{ present: boolean }[]>`
		select to_regclass('supabase_migrations.schema_migrations') is not null as present
	`;
	if (!probe?.present) {
		return null;
	}
	const rows = await sql<{ version: string }[]>`
		select version from supabase_migrations.schema_migrations order by version
	`;
	return rows.map((row) => row.version);
}

export interface AlertCounts {
	staleStores: number;
	longestStaleMinutes: number | null;
	failedDispatchStores: number;
	failedDispatches: number;
	lastHttpStatuses: number[];
}

export function alertCounts(
	alerts: readonly {
		kind: string;
		minutes: number | null;
		occurrences: number;
		http_status: number | null;
	}[],
): AlertCounts {
	const stale = alerts.filter((alert) => alert.kind === "sync_stale");
	const failed = alerts.filter((alert) => alert.kind === "dispatch_failed");
	const minutes = stale
		.map((alert) => alert.minutes)
		.filter((value): value is number => value !== null);
	return {
		staleStores: stale.length,
		longestStaleMinutes: minutes.length > 0 ? Math.max(...minutes) : null,
		failedDispatchStores: failed.length,
		failedDispatches: failed.reduce((sum, alert) => sum + alert.occurrences, 0),
		lastHttpStatuses: [
			...new Set(
				failed
					.map((alert) => alert.http_status)
					.filter((value): value is number => value !== null),
			),
		].sort((left, right) => left - right),
	};
}

export function alertsCheck(
	counts: AlertCounts,
	scheduleEnabled: boolean,
): DoctorCheck {
	const name = "sync alerts";
	if (counts.staleStores === 0 && counts.failedDispatchStores === 0) {
		return {
			name,
			health: "green",
			detail: scheduleEnabled
				? "no open alert: at the last tick every watched store had synced within 90 minutes of opening time, and every scheduled call was claimed"
				: "no open alert; the schedule is disabled, so no tick evaluates the stores",
		};
	}
	const parts: string[] = [];
	if (counts.staleStores > 0) {
		parts.push(
			`${counts.staleStores} store(s) over the 90-minute dead-man threshold (longest ${counts.longestStaleMinutes ?? "?"} min of opening time)`,
		);
	}
	if (counts.failedDispatchStores > 0) {
		const statuses =
			counts.lastHttpStatuses.length > 0
				? `, last answers HTTP ${counts.lastHttpStatuses.join(", ")}`
				: ", no HTTP answer recorded";
		parts.push(
			`${counts.failedDispatches} scheduled call(s) to ${counts.failedDispatchStores} store(s) expired unclaimed${statuses}`,
		);
	}
	return {
		name,
		health: "red",
		detail: `${parts.join("; ")}; see app.sync_alerts and docs/sync.md "Read the incremental runs"`,
	};
}

export function openingHoursCheck(coverage: {
	active: number;
	never_entered: number;
	without_span: number;
}): DoctorCheck {
	const name = "opening hours";
	const unknown = coverage.never_entered + coverage.without_span;
	const detail = `${coverage.active - unknown} of ${coverage.active} active store(s) have opening hours; ${coverage.never_entered} never entered, ${coverage.without_span} entered without a usable span; a store without them is synced at every tick and every minute counts for the dead-man's switch`;
	return {
		name,
		health: coverage.without_span > 0 ? "yellow" : "green",
		detail,
	};
}

export function isLocalDatabase(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return [
			"127.0.0.1",
			"localhost",
			"::1",
			"[::1]",
			"host.docker.internal",
		].includes(host);
	} catch {
		return false;
	}
}
