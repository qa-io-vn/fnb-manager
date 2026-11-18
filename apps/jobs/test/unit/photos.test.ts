import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { backendTarget } from "../../src/commands/backend-target.js";
import {
	type ExpiredPhoto,
	isPrunableObject,
	type PhotoDatabase,
	type PhotoStorage,
	pruneBackendProblem,
	pruneLine,
	prunePhotos,
} from "../../src/commands/photos.js";
import { ConfigError } from "../../src/config/errors.js";
import { capture } from "../support/capture.js";

const AT = new Date("2026-11-18T03:00:00.000Z");
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const LOCAL_DATABASE =
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SECRET_KEY = ["sb", "secret", "synthetic", "unit"].join("_");

function photo(tenant: string, index: number, bucketId = "ops-brand-1") {
	return {
		bucketId,
		name: `${tenant}/33333333-3333-4333-8333-333333333333/run/44444444-4444-4444-8444-44444444444${index % 10}/p${index}.jpg`,
	};
}

interface Fakes {
	database: PhotoDatabase;
	storage: PhotoStorage;
	removed: string[];
	removeCalls: string[][];
	marks: (string | null)[];
}

function fakes(
	initial: readonly ExpiredPhoto[],
	options: {
		apiId?: (photo: ExpiredPhoto) => string | null;
		failBucket?: string;
		ignoreRemoval?: boolean;
	} = {},
): Fakes {
	const objects = new Map(
		initial.map((entry) => [
			`${entry.bucketId}/${entry.name}`,
			{ ...entry, id: `id-${entry.name}` },
		]),
	);
	const removed: string[] = [];
	const removeCalls: string[][] = [];
	const marks: (string | null)[] = [];
	return {
		removed,
		removeCalls,
		marks,
		database: {
			async expired(_at, limit) {
				return [...objects.values()].slice(0, limit);
			},
			async objectId(entry) {
				return objects.get(`${entry.bucketId}/${entry.name}`)?.id ?? null;
			},
			async markRemoved(_at, tenantId) {
				marks.push(tenantId);
				return { marked: removed.length, deferred: false };
			},
		},
		storage: {
			async objectId(entry) {
				return options.apiId === undefined
					? (objects.get(`${entry.bucketId}/${entry.name}`)?.id ?? null)
					: options.apiId(entry);
			},
			async remove(bucketId, names) {
				removeCalls.push([...names]);
				if (bucketId === options.failBucket) {
					throw new Error("storage refused");
				}
				if (options.ignoreRemoval === true) {
					return [];
				}
				const done: string[] = [];
				for (const name of names) {
					if (objects.delete(`${bucketId}/${name}`)) {
						removed.push(name);
						done.push(name);
					}
				}
				return done;
			},
		},
	};
}

describe("photo housekeeping", () => {
	it("accepts only plain object names in ops- buckets", () => {
		expect(isPrunableObject(photo(TENANT, 1))).toBe(true);
		for (const name of [
			"",
			"/a/b.jpg",
			"a//b.jpg",
			"a/b.jpg/",
			"a/../b.jpg",
			"./b.jpg",
			"a\\b.jpg",
			"a/b\n.jpg",
			"x".repeat(1025),
		]) {
			expect(isPrunableObject({ bucketId: "ops-brand-1", name }), name).toBe(
				false,
			);
		}
		expect(isPrunableObject({ bucketId: "avatars", name: "a/b.jpg" })).toBe(
			false,
		);
	});

	it("removes exactly the photos the database lists as expired, then marks the rows", async () => {
		const listed = [photo(TENANT, 1), photo(TENANT, 2), photo(OTHER, 3)];
		const fake = fakes(listed);
		const report = await prunePhotos({
			database: fake.database,
			storage: fake.storage,
			at: AT,
			tenantId: null,
			dryRun: false,
		});
		expect(report).toEqual({
			found: 3,
			removed: 3,
			marked: 3,
			skipped: 0,
			failed: 0,
			more: false,
			markDeferred: false,
		});
		expect(fake.removeCalls.flat().sort()).toEqual(
			listed.map((entry) => entry.name).sort(),
		);
		expect(fake.marks).toEqual([null]);
		const again = await prunePhotos({
			database: fake.database,
			storage: fake.storage,
			at: AT,
			tenantId: null,
			dryRun: false,
		});
		expect(again.found).toBe(0);
		expect(again.removed).toBe(0);
		expect(fake.removeCalls).toHaveLength(1);
		expect(fake.marks).toEqual([null, null]);
	});

	it("keeps to one tenant's photos with --tenant", async () => {
		const fake = fakes([photo(OTHER, 1), photo(TENANT, 2), photo(OTHER, 3)]);
		const report = await prunePhotos({
			database: fake.database,
			storage: fake.storage,
			at: AT,
			tenantId: TENANT,
			dryRun: false,
		});
		expect(report.found).toBe(1);
		expect(fake.removeCalls).toEqual([[photo(TENANT, 2).name]]);
		expect(fake.marks).toEqual([TENANT]);
	});

	it("counts without removing or marking on a dry run", async () => {
		const fake = fakes([photo(TENANT, 1), photo(TENANT, 2)]);
		const report = await prunePhotos({
			database: fake.database,
			storage: fake.storage,
			at: AT,
			tenantId: null,
			dryRun: true,
		});
		expect(report.found).toBe(2);
		expect(fake.removeCalls).toEqual([]);
		expect(fake.marks).toEqual([]);
		expect(pruneLine(report, true)).toBe(
			"photos prune (dry run): 2 photo(s) past their retention; nothing removed",
		);
	});

	it("refuses before removing anything when the Storage API serves another backend", async () => {
		const fake = fakes([photo(TENANT, 1)], { apiId: () => "id-elsewhere" });
		await expect(
			prunePhotos({
				database: fake.database,
				storage: fake.storage,
				at: AT,
				tenantId: null,
				dryRun: false,
			}),
		).rejects.toBeInstanceOf(ConfigError);
		const missing = fakes([photo(TENANT, 1)], { apiId: () => null });
		await expect(
			prunePhotos({
				database: missing.database,
				storage: missing.storage,
				at: AT,
				tenantId: null,
				dryRun: false,
			}),
		).rejects.toThrow(/nothing was removed/);
		expect(fake.removeCalls).toEqual([]);
		expect(missing.removeCalls).toEqual([]);
		expect(fake.marks).toEqual([]);
	});

	it("skips unsafe names, stops on a refused removal and still marks what is gone", async () => {
		const fake = fakes(
			[
				photo(TENANT, 1, "ops-brand-2"),
				{ bucketId: "ops-brand-1", name: `${TENANT}/../escape.jpg` },
				photo(TENANT, 3, "ops-brand-1"),
			],
			{ failBucket: "ops-brand-1" },
		);
		const report = await prunePhotos({
			database: fake.database,
			storage: fake.storage,
			at: AT,
			tenantId: null,
			dryRun: false,
		});
		expect(report).toMatchObject({
			found: 3,
			removed: 1,
			skipped: 1,
			failed: 1,
			marked: 1,
		});
		expect(fake.removeCalls.flat()).not.toContain(`${TENANT}/../escape.jpg`);
		expect(pruneLine(report, false)).toBe(
			"photos prune: 3 photo(s) past their retention, 1 removed, 1 row(s) marked photo-removed, 1 skipped for an unsafe name, 1 not removed (Storage API error)",
		);
	});

	it("never loops on photos the Storage API does not remove, and stops after its rounds", async () => {
		const stuck = fakes(
			Array.from({ length: 4 }, (_, index) => photo(TENANT, index)),
			{ ignoreRemoval: true },
		);
		const report = await prunePhotos({
			database: stuck.database,
			storage: stuck.storage,
			at: AT,
			tenantId: null,
			dryRun: false,
			batch: 2,
		});
		expect(report.removed).toBe(0);
		expect(stuck.removeCalls).toHaveLength(1);
		const many = fakes(
			Array.from({ length: 9 }, (_, index) => photo(TENANT, index)),
		);
		const limited = await prunePhotos({
			database: many.database,
			storage: many.storage,
			at: AT,
			tenantId: null,
			dryRun: false,
			batch: 2,
			maxRounds: 3,
		});
		expect(limited).toMatchObject({ found: 6, removed: 6, more: true });
		expect(pruneLine(limited, false)).toMatch(/; more remain, run again$/);
	});

	it("accepts only a database and an API of the same backend", () => {
		const problem = (environment: Record<string, string>) =>
			pruneBackendProblem(backendTarget(environment));
		expect(
			problem({
				DATABASE_URL: LOCAL_DATABASE,
				SUPABASE_URL: "http://127.0.0.1:54321",
			}),
		).toBeNull();
		expect(problem({ DATABASE_URL: LOCAL_DATABASE })).toMatch(
			/^set SUPABASE_URL/,
		);
		expect(
			problem({
				DATABASE_URL: LOCAL_DATABASE,
				SUPABASE_URL: "https://abcdefghijkl.supabase.co",
			}),
		).toMatch(/local stack but SUPABASE_URL at a remote project/);
		expect(
			problem({
				DATABASE_URL:
					"postgresql://postgres.abcdefghijkl:x@example.com:5432/postgres",
				SUPABASE_URL: "https://abcdefghijkl.supabase.co",
			}),
		).toBeNull();
		expect(
			problem({
				DATABASE_URL:
					"postgresql://postgres.abcdefghijkl:x@example.com:5432/postgres",
				SUPABASE_URL: "https://mnopqrstuvwx.supabase.co",
			}),
		).toMatch(/two different Supabase projects/);
		expect(
			problem({
				DATABASE_URL: "postgresql://postgres:x@example.com:5432/postgres",
				SUPABASE_URL: "https://api.example.com",
			}),
		).toMatch(/cannot be shown to be the same backend/);
	});
});

describe("fnb photos prune", () => {
	async function fnb(environment: Record<string, string>, argv: string[] = []) {
		const out = capture();
		const code = await runCli(["photos", "prune", ...argv], environment, {
			streams: out.streams,
			loadEnvFile: false,
		});
		return { code, stdout: out.stdout(), stderr: out.stderr() };
	}

	it("refuses an unconfigured or mismatched backend before connecting", async () => {
		const noApi = await fnb({ DATABASE_URL: LOCAL_DATABASE });
		expect(noApi.code).toBe(1);
		expect(noApi.stderr).toContain("configuration: refused: set SUPABASE_URL");
		const noKey = await fnb({
			DATABASE_URL: LOCAL_DATABASE,
			SUPABASE_URL: "http://127.0.0.1:54321",
		});
		expect(noKey.code).toBe(1);
		expect(noKey.stderr).toContain("SUPABASE_SECRET_KEY");
		const mismatched = await fnb({
			DATABASE_URL: LOCAL_DATABASE,
			SUPABASE_URL: "https://abcdefghijkl.supabase.co",
			SUPABASE_SECRET_KEY: SECRET_KEY,
		});
		expect(mismatched.code).toBe(1);
		expect(mismatched.stderr).toContain("nothing was removed");
		expect(`${mismatched.stdout}${mismatched.stderr}`).not.toContain(
			SECRET_KEY,
		);
	});

	it("touches only a zalo-it- fixture tenant on the local stack under ZALO_INTEGRATION=1", async () => {
		const environment = {
			DATABASE_URL: LOCAL_DATABASE,
			SUPABASE_URL: "http://127.0.0.1:54321",
			SUPABASE_SECRET_KEY: SECRET_KEY,
			ZALO_INTEGRATION: "1",
		};
		const bare = await fnb(environment);
		expect(bare.code).toBe(2);
		expect(bare.stderr).toContain("only a zalo-it- fixture tenant");
		const real = await fnb(environment, ["--tenant", "demo-fnb"]);
		expect(real.code).toBe(2);
		const help = await fnb({}, ["--help"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain(
			"Usage: fnb photos prune [--tenant <slug>] [--dry-run]",
		);
	});
});
