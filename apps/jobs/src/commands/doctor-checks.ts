import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";
import { ageText } from "./formatting.js";

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

export const FREE_PLAN_STORAGE_MIB = 1024;
export const STORAGE_UPGRADE_TRIGGER_MIB = FREE_PLAN_STORAGE_MIB * 0.8;
export const STORAGE_RED_MIB = FREE_PLAN_STORAGE_MIB * 0.95;
export const EXPIRED_PHOTO_PROBE = 1000;

export interface PhotoStorageUse {
	buckets: number;
	objects: number;
	bytes: number;
	oldestAt: Date | null;
	expired: number;
}

export function photoStorageHealth(bytes: number): Health {
	const mebibytes = toMebibytes(bytes);
	if (mebibytes >= STORAGE_RED_MIB) {
		return "red";
	}
	return mebibytes >= STORAGE_UPGRADE_TRIGGER_MIB ? "yellow" : "green";
}

export function photoStorageCheck(
	use: PhotoStorageUse | null,
	now: Date,
): DoctorCheck {
	const name = "operations photo storage";
	if (use === null) {
		return {
			name,
			health: "unavailable",
			detail: "app.ops_photo_storage is missing; apply the migrations",
		};
	}
	const oldest =
		use.oldestAt === null
			? "no photo yet"
			: `oldest ${ageText(use.oldestAt, now)}`;
	const expired =
		use.expired === 0
			? "none past retention"
			: `${use.expired >= EXPIRED_PHOTO_PROBE ? `at least ${EXPIRED_PHOTO_PROBE}` : use.expired} past retention (fnb photos prune removes them)`;
	return {
		name,
		health: photoStorageHealth(use.bytes),
		detail: `${toMebibytes(use.bytes).toFixed(1)} MiB in ${use.objects} photo(s) across ${use.buckets} ops- bucket(s) (${oldest}; ${expired}) of the ${FREE_PLAN_STORAGE_MIB} MiB free-plan storage quota (upgrade trigger ${STORAGE_UPGRADE_TRIGGER_MIB.toFixed(1)} MiB, red from ${STORAGE_RED_MIB.toFixed(1)} MiB)`,
	};
}

export async function photoStorageUse(
	sql: Sql,
	now: Date,
): Promise<PhotoStorageUse | null> {
	const [probe] = await sql<{ present: boolean }[]>`
		select to_regprocedure('app.ops_photo_storage()') is not null
			and to_regprocedure('app.expired_ops_photos(timestamptz, integer)') is not null as present
	`;
	if (!probe?.present) {
		return null;
	}
	const [row] = await sql<
		{
			buckets: number;
			objects: string;
			bytes: string;
			oldest_at: Date | null;
		}[]
	>`
		select count(*)::integer as buckets, coalesce(sum(s.objects), 0)::text as objects,
			coalesce(sum(s.bytes), 0)::text as bytes, min(s.oldest_at) as oldest_at
		from app.ops_photo_storage() s
	`;
	const [expired] = await sql<{ expired: number }[]>`
		select count(*)::integer as expired
		from app.expired_ops_photos(${now}::timestamptz, ${EXPIRED_PHOTO_PROBE}::integer)
	`;
	return {
		buckets: Number(row?.buckets ?? 0),
		objects: Number(row?.objects ?? 0),
		bytes: Number(row?.bytes ?? 0),
		oldestAt: row?.oldest_at ?? null,
		expired: Number(expired?.expired ?? 0),
	};
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

export const NOTIFY_TICK_RED_MINUTES = 60;
export const ZALO_BOT_MONTHLY_QUOTA = 3000;
export const ZALO_BOT_QUOTA_YELLOW = 0.8;

function minutesAgo(from: Date | null, now: Date): number | null {
	return from === null
		? null
		: Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
}

function agoText(minutes: number | null): string {
	return minutes === null ? "never" : `${minutes} min ago`;
}

export function notifyScheduleChecks(
	schedule: { readonly enabled: boolean; readonly lastTickAt: Date | null },
	now: Date,
): DoctorCheck[] {
	const tickMinutes = minutesAgo(schedule.lastTickAt, now);
	const scheduleCheck: DoctorCheck = schedule.enabled
		? {
				name: "notify schedule",
				health: "green",
				detail:
					"enabled: pg_cron ticks every 5 minutes and wakes the notify function when work is due",
			}
		: {
				name: "notify schedule",
				health: "yellow",
				detail:
					"disabled: digests and alerts go out through Actions only (sync.yml after the nightly, notify.yml at 06:07, 07:07 and 08:07); docs/go-live.md step 8 enables it",
			};
	const late = tickMinutes === null || tickMinutes > NOTIFY_TICK_RED_MINUTES;
	const tickCheck: DoctorCheck = {
		name: "notify tick",
		health: schedule.enabled && late ? "red" : "green",
		detail: schedule.enabled
			? `last tick ${agoText(tickMinutes)} (red beyond ${NOTIFY_TICK_RED_MINUTES} min while the schedule is enabled)`
			: `last tick ${agoText(tickMinutes)}; none is expected while the schedule is disabled`,
	};
	return [scheduleCheck, tickCheck];
}

export function notifySecretsCheck(input: {
	readonly here: readonly string[];
	readonly dispatchers: readonly {
		readonly runtime: string;
		readonly names: readonly string[];
		readonly at: Date | null;
	}[];
	readonly destinationSecrets: readonly string[];
	readonly missing: readonly { readonly key: string; readonly count: number }[];
	readonly now: Date;
}): DoctorCheck {
	const name = "notify secrets";
	const reported = new Set(input.dispatchers.flatMap((entry) => entry.names));
	const held = new Set([...input.here, ...reported]);
	const uncovered = input.destinationSecrets.filter(
		(secret) => !held.has(secret),
	);
	const dispatchers =
		input.dispatchers.length === 0
			? "no dispatcher has reported yet"
			: input.dispatchers
					.map(
						(entry) =>
							`${entry.runtime} ${entry.names.length === 0 ? "none" : entry.names.join(", ")} (${agoText(minutesAgo(entry.at, input.now))})`,
					)
					.join("; ");
	const base = `here: ${input.here.length === 0 ? "none" : input.here.join(", ")}; last dispatchers: ${dispatchers}`;
	if (input.missing.length > 0) {
		return {
			name,
			health: "red",
			detail: `${input.missing.map((entry) => `${entry.count} message(s) cancelled because no dispatcher holds ${entry.key}`).join("; ")} in the last 7 days; ${base}`,
		};
	}
	if (uncovered.length > 0) {
		return {
			name,
			health: "yellow",
			detail: `no dispatcher has reported ${uncovered.join(", ")}, which a destination uses; ${base}`,
		};
	}
	return { name, health: "green", detail: base };
}

export function notifyDestinationsCheck(
	total: number,
	failing: number,
): DoctorCheck {
	const name = "notify destinations";
	if (failing > 0) {
		return {
			name,
			health: "red",
			detail: `${failing} of ${total} destination(s) failing (marked failing or 3 or more failures in a row); fnb notify status shows the codes`,
		};
	}
	if (total === 0) {
		return {
			name,
			health: "yellow",
			detail:
				"no active destination yet; link one with fnb notify link (docs/go-live.md step 8)",
		};
	}
	return {
		name,
		health: "green",
		detail: `${total} active destination(s), none failing`,
	};
}

export function zaloBotQuotaCheck(
	counts: readonly { readonly key: string; readonly count: number }[],
): DoctorCheck {
	const name = "Zalo Bot quota";
	if (counts.length === 0) {
		return {
			name,
			health: "green",
			detail: `no Zalo Bot message this month (Basic plan: ${ZALO_BOT_MONTHLY_QUOTA} a month)`,
		};
	}
	const threshold = ZALO_BOT_MONTHLY_QUOTA * ZALO_BOT_QUOTA_YELLOW;
	const high = counts.some((entry) => entry.count >= threshold);
	return {
		name,
		health: high ? "yellow" : "green",
		detail: `${counts.map((entry) => `${entry.key} ${entry.count} of ${ZALO_BOT_MONTHLY_QUOTA}`).join(", ")} this month (yellow from ${threshold})`,
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
