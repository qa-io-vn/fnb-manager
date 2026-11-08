import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

export type Health = "green" | "yellow" | "red" | "unavailable";

export interface DoctorCheck {
	name: string;
	health: Health;
	detail: string;
}

export const FREE_PLAN_DATABASE_BYTES = 500 * 1024 * 1024;
export const UPGRADE_TRIGGER_BYTES = 400 * 1024 * 1024;
export const PAUSE_AFTER_DAYS = 7;

export function databaseSizeHealth(bytes: number): Health {
	if (bytes >= FREE_PLAN_DATABASE_BYTES * 0.95) {
		return "red";
	}
	return bytes >= UPGRADE_TRIGGER_BYTES ? "yellow" : "green";
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
