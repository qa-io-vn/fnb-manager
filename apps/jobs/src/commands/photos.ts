import { isFixtureTenantSlug } from "@fnb/zalo";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { findTenant } from "../admin/tenants.js";
import { supabaseApiSetting } from "../config/config.js";
import type { Environment } from "../config/env-file.js";
import { ConfigError } from "../config/errors.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	stringOption,
	UsageError,
} from "../context.js";
import { type BackendTarget, backendTarget } from "./backend-target.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";

export const PRUNE_BATCH = 500;
export const PRUNE_MAX_ROUNDS = 20;
const MAX_OBJECT_NAME = 1024;
const OPS_BUCKET = /^ops-[a-z0-9-]{1,60}$/;

export interface ExpiredPhoto {
	readonly bucketId: string;
	readonly name: string;
}

export interface MarkResult {
	readonly marked: number;
	readonly deferred: boolean;
}

export interface PhotoDatabase {
	expired(at: Date, limit: number): Promise<ExpiredPhoto[]>;
	objectId(photo: ExpiredPhoto): Promise<string | null>;
	markRemoved(at: Date, tenantId: string | null): Promise<MarkResult>;
}

export interface PhotoStorage {
	objectId(photo: ExpiredPhoto): Promise<string | null>;
	remove(bucketId: string, names: readonly string[]): Promise<string[]>;
}

export interface PruneOptions {
	readonly database: PhotoDatabase;
	readonly storage: PhotoStorage;
	readonly at: Date;
	readonly tenantId: string | null;
	readonly dryRun: boolean;
	readonly batch?: number;
	readonly maxRounds?: number;
}

export interface PruneReport {
	found: number;
	removed: number;
	marked: number;
	skipped: number;
	failed: number;
	more: boolean;
	markDeferred: boolean;
}

export function isPrunableObject(photo: ExpiredPhoto): boolean {
	const { name } = photo;
	if (
		!OPS_BUCKET.test(photo.bucketId) ||
		name.length === 0 ||
		name.length > MAX_OBJECT_NAME ||
		name.includes("\\")
	) {
		return false;
	}
	for (let index = 0; index < name.length; index += 1) {
		const code = name.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) {
			return false;
		}
	}
	return name
		.split("/")
		.every((part) => part !== "" && part !== "." && part !== "..");
}

function photoKey(photo: ExpiredPhoto): string {
	return `${photo.bucketId}\n${photo.name}`;
}

function byBucket(photos: readonly ExpiredPhoto[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const photo of photos) {
		const names = groups.get(photo.bucketId) ?? [];
		names.push(photo.name);
		groups.set(photo.bucketId, names);
	}
	return groups;
}

async function requireSameStorage(
	options: PruneOptions,
	photo: ExpiredPhoto,
): Promise<void> {
	const [databaseId, apiId] = await Promise.all([
		options.database.objectId(photo),
		options.storage.objectId(photo),
	]);
	if (databaseId === null || apiId === null || databaseId !== apiId) {
		throw new ConfigError(
			"the Storage API at SUPABASE_URL does not serve the photos this database lists, so they belong to another backend; nothing was removed",
		);
	}
}

export async function prunePhotos(options: PruneOptions): Promise<PruneReport> {
	const batch = options.batch ?? PRUNE_BATCH;
	const maxRounds = options.maxRounds ?? PRUNE_MAX_ROUNDS;
	const report: PruneReport = {
		found: 0,
		removed: 0,
		marked: 0,
		skipped: 0,
		failed: 0,
		more: false,
		markDeferred: false,
	};
	const seen = new Set<string>();
	let verified = false;
	for (let round = 0; round < maxRounds; round += 1) {
		const page = await options.database.expired(options.at, batch);
		const full = page.length >= batch;
		const candidates = page.filter(
			(photo) =>
				!seen.has(photoKey(photo)) &&
				(options.tenantId === null ||
					photo.name.startsWith(`${options.tenantId}/`)),
		);
		for (const photo of candidates) {
			seen.add(photoKey(photo));
		}
		const safe = candidates.filter(isPrunableObject);
		report.found += candidates.length;
		report.skipped += candidates.length - safe.length;
		if (options.dryRun || safe.length === 0) {
			report.more = full;
			break;
		}
		const [first] = safe;
		if (!verified && first !== undefined) {
			await requireSameStorage(options, first);
			verified = true;
		}
		let removed = 0;
		let failed = false;
		for (const [bucketId, names] of byBucket(safe)) {
			try {
				const allowed = new Set(names);
				removed += (await options.storage.remove(bucketId, names)).filter(
					(name) => allowed.has(name),
				).length;
			} catch {
				report.failed += names.length;
				failed = true;
			}
		}
		report.removed += removed;
		if (failed || !full || removed === 0) {
			break;
		}
		report.more = round === maxRounds - 1;
	}
	if (!options.dryRun) {
		const marking = await options.database.markRemoved(
			options.at,
			options.tenantId,
		);
		report.marked = marking.marked;
		report.markDeferred = marking.deferred;
	}
	return report;
}

export function pruneBackendProblem(target: BackendTarget): string | null {
	if (target.api === null) {
		return "set SUPABASE_URL to the API URL of the backend that DATABASE_URL names; photos are removed through its Storage API";
	}
	if (target.problem !== null) {
		return target.problem;
	}
	if (
		target.database.locality === "remote" &&
		(target.database.projectRef === null || target.api.projectRef === null)
	) {
		return `${target.databaseVariable} and SUPABASE_URL do not both name a Supabase project, so they cannot be shown to be the same backend`;
	}
	return null;
}

function configuredBackend(environment: Environment): BackendTarget {
	const target = backendTarget(environment);
	const problem = pruneBackendProblem(target);
	if (problem !== null) {
		throw new ConfigError(`refused: ${problem}; nothing was removed`);
	}
	supabaseApiSetting(environment);
	return target;
}

function requireFixtureInIntegration(
	environment: Environment,
	target: BackendTarget,
	slug: string | undefined,
): void {
	if (environment.ZALO_INTEGRATION !== "1") {
		return;
	}
	if (slug === undefined || !isFixtureTenantSlug(slug)) {
		throw new UsageError(
			"with ZALO_INTEGRATION=1 fnb photos prune touches only a zalo-it- fixture tenant named by --tenant",
		);
	}
	if (
		target.database.locality !== "local" ||
		target.api?.locality !== "local"
	) {
		throw new UsageError(
			"with ZALO_INTEGRATION=1 fnb photos prune runs only against the local stack",
		);
	}
}

class DeferMarking extends Error {}

export function postgresPhotoDatabase(sql: Sql): PhotoDatabase {
	return {
		async expired(at, limit) {
			const rows = await sql<{ bucket_id: string; name: string }[]>`
				select e.bucket_id, e.name
				from app.expired_ops_photos(${at}::timestamptz, ${limit}::integer) e
			`;
			return rows.map((row) => ({ bucketId: row.bucket_id, name: row.name }));
		},
		async objectId(photo) {
			const [row] = await sql<{ id: string }[]>`
				select o.id::text as id
				from storage.objects o
				where o.bucket_id = ${photo.bucketId} and o.name = ${photo.name}
			`;
			return row?.id ?? null;
		},
		async markRemoved(at, tenantId) {
			if (tenantId === null) {
				const [row] = await sql<{ marked: number }[]>`
					select app.mark_removed_ops_photos(${at}::timestamptz)::integer as marked
				`;
				return { marked: Number(row?.marked ?? 0), deferred: false };
			}
			try {
				return await sql.begin(async (transaction) => {
					const [row] = await transaction<{ marked: number }[]>`
						select app.mark_removed_ops_photos(${at}::timestamptz)::integer as marked
					`;
					const [others] = await transaction<{ rows: number }[]>`
						select (
							(select count(*) from public.checklist_answers a
							 where a.photo_removed_at = ${at}::timestamptz and a.tenant_id <> ${tenantId}::uuid)
							+ (select count(*) from public.incidents i
							 where i.photo_removed_at = ${at}::timestamptz and i.tenant_id <> ${tenantId}::uuid)
						)::integer as rows
					`;
					if (Number(others?.rows ?? 0) > 0) {
						throw new DeferMarking();
					}
					return { marked: Number(row?.marked ?? 0), deferred: false };
				});
			} catch (error) {
				if (error instanceof DeferMarking) {
					return { marked: 0, deferred: true };
				}
				throw error;
			}
		},
	};
}

export function supabasePhotoStorage(client: SupabaseClient): PhotoStorage {
	return {
		async objectId(photo) {
			const { data, error } = await client.storage
				.from(photo.bucketId)
				.info(photo.name);
			return error !== null || data === null ? null : String(data.id);
		},
		async remove(bucketId, names) {
			const { data, error } = await client.storage
				.from(bucketId)
				.remove([...names]);
			if (error !== null) {
				throw error;
			}
			return (data ?? []).map((object) => object.name);
		},
	};
}

export function pruneLine(report: PruneReport, dryRun: boolean): string {
	if (dryRun) {
		return `photos prune (dry run): ${report.found} photo(s) past their retention${report.more ? " in the first batch; more remain" : ""}${report.skipped > 0 ? `, ${report.skipped} with a name the job would skip` : ""}; nothing removed`;
	}
	const parts = [
		`${report.found} photo(s) past their retention`,
		`${report.removed} removed`,
		`${report.marked} row(s) marked photo-removed`,
		...(report.skipped > 0
			? [`${report.skipped} skipped for an unsafe name`]
			: []),
		...(report.failed > 0
			? [`${report.failed} not removed (Storage API error)`]
			: []),
	];
	return `photos prune: ${parts.join(", ")}${report.more ? "; more remain, run again" : ""}`;
}

async function prune(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const slug = stringOption(values, "tenant")?.trim();
	const dryRun = flag(values, "dry-run");
	const target = configuredBackend(context.env);
	requireFixtureInIntegration(context.env, target, slug);
	const { sql } = context.services.db();
	let tenantId: string | null = null;
	if (slug !== undefined) {
		const tenant = await findTenant(sql, slug);
		if (tenant === null) {
			throw new UsageError(
				context.output.ci
					? "no tenant with that slug"
					: `no tenant with slug "${slug}"`,
			);
		}
		tenantId = tenant.id;
	}
	const report = await prunePhotos({
		database: postgresPhotoDatabase(sql),
		storage: supabasePhotoStorage(context.services.supabaseAdmin()),
		at: context.now(),
		tenantId,
		dryRun,
	});
	const line = pruneLine(report, dryRun);
	context.output.line(line);
	context.output.summary(`- ${line}`);
	if (report.markDeferred) {
		const deferred =
			"photos prune: rows of other tenants also lost their photos; their marking is left to a run without --tenant";
		context.output.line(deferred);
		context.output.summary(`- ${deferred}`);
	}
	return report.failed > 0 ? 1 : 0;
}

export const photosPruneCommand: CommandSpec = {
	path: ["photos", "prune"],
	summary:
		"Remove operations photos past their tenant's retention and mark their rows",
	usage: "fnb photos prune [--tenant <slug>] [--dry-run]",
	options: {
		...HELP_OPTION,
		tenant: { type: "string" },
		"dry-run": { type: "boolean" },
	},
	details: [
		"Lists the photos app.expired_ops_photos returns (older than the tenant's ops_photo_retention_days, oldest first, 500 a round, at most 20 rounds), removes exactly those objects through the Storage API with the service role (SUPABASE_URL and SUPABASE_SECRET_KEY), then app.mark_removed_ops_photos marks the checklist answers and reports whose photos are gone. Nothing else is ever removed.",
		"Refuses unless DATABASE_URL (or SUPABASE_DB_URL) and SUPABASE_URL name the same backend (both the local stack, or the same Supabase project), and unless the Storage API returns the database's own object id for the first photo; nothing is removed before both checks pass.",
		"Idempotent and safe to interrupt: a second run finds nothing more to remove, and every run ends by marking the rows of photos already gone, so an interrupted run is finished by the next one.",
		"--tenant removes only that tenant's photos, and its marking is rolled back if it would also mark another tenant's rows. With ZALO_INTEGRATION=1 only a zalo-it- fixture tenant on the local stack is accepted. --dry-run counts and removes nothing.",
		"Not scheduled by itself: run it weekly from the operations calendar, or from a scheduled job with those three secrets.",
		"Output carries counts only. Exit codes: 0 done or nothing to do; 1 refused configuration or a removal the Storage API refused; 2 usage error.",
	],
	run: prune,
};
