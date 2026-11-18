import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPostgresClient } from "@fnb/sync/postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	photoStorageCheck,
	photoStorageUse,
} from "../../src/commands/doctor-checks.js";
import { capture } from "../support/capture.js";

const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY =
	process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED =
	process.env.ZALO_INTEGRATION === "1" &&
	Boolean(DATABASE_URL) &&
	Boolean(SUPABASE_URL);
const FIXTURE_PREFIX = "zalo-it-";
const BUCKET = "ops-brand-1";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
const LOOPBACK = /^[a-z]+:\/\/[^/]*@?(127\.0\.0\.1|localhost)[:/]/;
const JPEG = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
	0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

interface Result {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

interface Fixture {
	readonly slug: string;
	readonly tenantId: string;
	readonly ownerId: string;
	readonly runPaths: readonly string[];
	readonly answerIds: readonly string[];
	readonly incidentPath: string | null;
	readonly incidentId: string | null;
}

async function asMember<T>(
	sql: Sql,
	userId: string,
	run: (transaction: Sql) => Promise<T>,
): Promise<T> {
	return sql.begin(async (transaction) => {
		await transaction.unsafe("set local role authenticated");
		await transaction.unsafe(
			"select set_config('request.jwt.claims', $1, true)",
			[JSON.stringify({ sub: userId, role: "authenticated" })],
		);
		return run(transaction as unknown as Sql);
	}) as Promise<T>;
}

describe.skipIf(!ENABLED)("fnb photos prune on the local stack", () => {
	let sql: Sql;
	let storage: SupabaseClient;
	let decoy: Server | undefined;
	let decoyUrl = "";
	const decoyRequests: string[] = [];
	const logins: string[] = [];
	const fixtures: Fixture[] = [];
	let foreignObjects: string[] = [];

	function environment(
		extra: Readonly<Record<string, string>> = {},
	): Record<string, string> {
		return {
			DATABASE_URL: DATABASE_URL ?? "",
			SUPABASE_URL: SUPABASE_URL ?? "",
			SUPABASE_SECRET_KEY: SERVICE_KEY ?? "",
			ZALO_INTEGRATION: "1",
			...extra,
		};
	}

	async function fnb(
		argv: readonly string[],
		env: Readonly<Record<string, string>> = environment(),
	): Promise<Result> {
		const out = capture();
		const code = await runCli(["photos", "prune", ...argv], env, {
			streams: out.streams,
			loadEnvFile: false,
		});
		return { code, stdout: out.stdout(), stderr: out.stderr() };
	}

	async function insertLogin(email: string): Promise<string> {
		const userId = randomUUID();
		await sql`
			insert into auth.users (
				instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
				raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
				confirmation_token, recovery_token, email_change_token_new, email_change,
				email_change_token_current, phone_change, phone_change_token, reauthentication_token,
				is_sso_user, is_anonymous
			)
			values (
				${AUTH_INSTANCE_ID}::uuid, ${userId}::uuid, 'authenticated', 'authenticated', ${email},
				extensions.crypt(${randomBytes(18).toString("base64url")}, extensions.gen_salt('bf')), now(),
				'{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
				'', '', '', '', '', '', '', '', false, false
			)
		`;
		logins.push(userId);
		return userId;
	}

	async function upload(path: string): Promise<void> {
		const { error } = await storage.storage
			.from(BUCKET)
			.upload(path, JPEG, { contentType: "image/jpeg", upsert: false });
		if (error !== null) {
			throw new Error(`the fixture upload failed (${error.message})`);
		}
	}

	async function createFixture(photos: number, incident: boolean) {
		const suffix = randomBytes(4).toString("hex");
		const slug = `${FIXTURE_PREFIX}${suffix}`;
		const [tenant] = await sql<{ id: string }[]>`
			insert into public.tenants (slug, name) values (${slug}, ${`Photo fixture ${suffix}`})
			returning id::text as id
		`;
		const tenantId = tenant?.id ?? "";
		const [account] = await sql<{ id: string }[]>`
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${tenantId}::uuid, 'mock', ${`${slug}-account`}, 'Synthetic account')
			returning id::text as id
		`;
		const [store] = await sql<{ id: string }[]>`
			insert into public.stores (tenant_id, pos_account_id, external_id, name)
			values (${tenantId}::uuid, ${account?.id ?? ""}::uuid, ${`${slug}-store-1`}, 'Synthetic store 1')
			returning id::text as id
		`;
		const storeId = store?.id ?? "";
		const ownerId = await insertLogin(`${slug}-owner@example.com`);
		await sql`
			insert into public.tenant_members (tenant_id, user_id, role)
			values (${tenantId}::uuid, ${ownerId}::uuid, 'owner')
		`;
		await sql`
			insert into public.brands (tenant_id, brand_key, display_name, store_ids)
			values (${tenantId}::uuid, 'brand-1', 'Quán Thử Một', array[${storeId}::uuid])
		`;
		const fixture = { slug, tenantId, ownerId };
		const items = Array.from({ length: photos }, (_, index) => ({
			label: `Ảnh thử ${index + 1}`,
			requires_photo: true,
		}));
		const run = await asMember(sql, ownerId, async (transaction) => {
			const [saved] = await transaction<{ result: { template_id: string } }[]>`
				select public.save_checklist_template(
					${tenantId}::uuid, ${storeId}::uuid, 'opening', 'Ảnh mở ca thử', ${JSON.stringify(items)}::text::jsonb
				) as result
			`;
			const [started] = await transaction<
				{ result: { run_id: string; photo_prefix: string } }[]
			>`
				select public.start_checklist_run(${saved?.result.template_id ?? ""}::uuid, ${storeId}::uuid) as result
			`;
			return started?.result;
		});
		const answers = await sql<{ id: string }[]>`
			select a.id::text as id
			from public.checklist_answers a
			join public.checklist_items i on i.id = a.item_id
			where a.run_id = ${run?.run_id ?? ""}::uuid
			order by i.position
		`;
		const runPaths = answers.map(
			(_, index) => `${run?.photo_prefix ?? ""}p${index + 1}.jpg`,
		);
		for (const path of runPaths) {
			await upload(path);
		}
		await asMember(sql, ownerId, async (transaction) => {
			for (const [index, answer] of answers.entries()) {
				await transaction`
					select public.save_checklist_answer(${answer.id}::uuid, true, null, ${runPaths[index] ?? ""})
				`;
			}
		});
		let incidentPath: string | null = null;
		let incidentId: string | null = null;
		if (incident) {
			const reported = await asMember(sql, ownerId, async (transaction) => {
				const [row] = await transaction<
					{ result: { incident_id: string; photo_prefix: string } }[]
				>`
					select public.report_incident(${storeId}::uuid, 'incident', 'thiet_bi', 'Mô tả thử') as result
				`;
				return row?.result;
			});
			incidentId = reported?.incident_id ?? null;
			incidentPath = `${reported?.photo_prefix ?? ""}i1.jpg`;
			await upload(incidentPath);
			await asMember(sql, ownerId, (transaction) =>
				transaction`
					select public.update_incident(${incidentId}::uuid, 'thiet_bi', 'Mô tả thử', null, array[${incidentPath}]::text[])
				`.then(() => undefined),
			);
		}
		const created: Fixture = {
			...fixture,
			runPaths,
			answerIds: answers.map((answer) => answer.id),
			incidentPath,
			incidentId,
		};
		fixtures.push(created);
		return created;
	}

	async function backdate(paths: readonly string[]): Promise<void> {
		await sql`
			update storage.objects
			set created_at = now() - interval '100 days'
			where bucket_id = ${BUCKET}
				and name in (select jsonb_array_elements_text(${JSON.stringify(paths)}::text::jsonb))
		`;
	}

	async function objectNames(tenantId: string): Promise<string[]> {
		const rows = await sql<{ name: string }[]>`
			select o.name from storage.objects o
			where o.bucket_id = ${BUCKET} and o.name like ${`${tenantId}/%`}
			order by o.name
		`;
		return rows.map((row) => row.name);
	}

	async function foreignObjectIds(): Promise<string[]> {
		const prefixes = fixtures.map((fixture) => `${fixture.tenantId}/%`);
		const rows = await sql<{ id: string }[]>`
			select o.id::text as id from storage.objects o
			where not (o.name like any (array(select jsonb_array_elements_text(${JSON.stringify(prefixes)}::text::jsonb))))
		`;
		return rows.map((row) => row.id);
	}

	async function foreignObjectsKept(): Promise<boolean> {
		const now = new Set(await foreignObjectIds());
		return foreignObjects.every((id) => now.has(id));
	}

	async function markers(answerIds: readonly string[]): Promise<boolean[]> {
		const rows = await sql<{ id: string; removed: boolean }[]>`
			select a.id::text as id, a.photo_removed_at is not null as removed
			from public.checklist_answers a
			where a.id in (select jsonb_array_elements_text(${JSON.stringify(answerIds)}::text::jsonb)::uuid)
		`;
		const byId = new Map(rows.map((row) => [row.id, row.removed]));
		return answerIds.map((id) => byId.get(id) ?? false);
	}

	beforeAll(async () => {
		if (!SERVICE_KEY) {
			throw new Error(
				"set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) of the local stack to run the photo housekeeping suite",
			);
		}
		if (
			!LOOPBACK.test(DATABASE_URL ?? "") ||
			!LOOPBACK.test(SUPABASE_URL ?? "")
		) {
			throw new Error(
				"the photo housekeeping suite runs only against the local stack",
			);
		}
		sql = createPostgresClient(DATABASE_URL ?? "", {
			maxConnections: 2,
			applicationName: "photos-prune-it",
		});
		storage = createClient(SUPABASE_URL ?? "", SERVICE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		});
		await sql`
			delete from public.tenants
			where slug like ${`${FIXTURE_PREFIX}%`} and created_at < now() - interval '1 hour'
		`;
		await sql`
			delete from auth.users
			where email like ${`${FIXTURE_PREFIX}%@example.com`} and created_at < now() - interval '1 hour'
		`;
		decoy = createServer((request, response) => {
			decoyRequests.push(request.method ?? "");
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id: randomUUID(),
					name: "decoy",
					bucket_id: BUCKET,
					size: JPEG.length,
				}),
			);
		});
		await new Promise<void>((resolve) =>
			decoy?.listen(0, "127.0.0.1", resolve),
		);
		decoyUrl = `http://127.0.0.1:${(decoy.address() as AddressInfo).port}`;
		const main = await createFixture(3, true);
		foreignObjects = await foreignObjectIds();
		await backdate([
			main.runPaths[0] ?? "",
			main.runPaths[1] ?? "",
			main.incidentPath ?? "",
		]);
	}, 120_000);

	afterAll(async () => {
		if (sql !== undefined) {
			for (const fixture of fixtures) {
				const names = await objectNames(fixture.tenantId);
				if (names.length > 0) {
					await storage.storage.from(BUCKET).remove(names);
				}
				await sql`delete from public.tenants where id = ${fixture.tenantId}::uuid`;
			}
			if (logins.length > 0) {
				await sql`
					delete from auth.users
					where id in (select jsonb_array_elements_text(${JSON.stringify(logins)}::text::jsonb)::uuid)
				`;
			}
			await sql.end({ timeout: 5 });
		}
		await new Promise<void>((resolve) =>
			decoy === undefined ? resolve() : decoy.close(() => resolve()),
		);
	});

	it("refuses an unconfigured backend or a Storage API of another backend and removes nothing", async () => {
		const [main] = fixtures;
		const before = await objectNames(main?.tenantId ?? "");
		const noApi = await fnb(["--tenant", main?.slug ?? ""], {
			DATABASE_URL: DATABASE_URL ?? "",
			ZALO_INTEGRATION: "1",
		});
		expect(noApi.code).toBe(1);
		expect(noApi.stderr).toContain("refused: set SUPABASE_URL");
		const elsewhere = await fnb(
			["--tenant", main?.slug ?? ""],
			environment({ SUPABASE_URL: decoyUrl }),
		);
		expect(elsewhere.code).toBe(1);
		expect(elsewhere.stderr).toContain(
			"does not serve the photos this database lists",
		);
		expect(decoyRequests).toContain("GET");
		expect(decoyRequests).not.toContain("DELETE");
		const notFixture = await fnb(["--tenant", "demo-fnb"]);
		expect(notFixture.code).toBe(2);
		expect(await objectNames(main?.tenantId ?? "")).toEqual(before);
		expect(before).toHaveLength(4);
	});

	it("shows the photos in the doctor's storage reading", async () => {
		const now = new Date();
		const use = await photoStorageUse(sql, now);
		expect(use).not.toBeNull();
		expect(use?.buckets).toBeGreaterThanOrEqual(1);
		expect(use?.objects).toBeGreaterThanOrEqual(4);
		expect(use?.bytes).toBeGreaterThanOrEqual(4 * JPEG.length);
		expect(use?.expired).toBeGreaterThanOrEqual(3);
		const check = photoStorageCheck(use, now);
		expect(check.name).toBe("operations photo storage");
		expect(check.health).toBe("green");
		expect(check.detail).toMatch(
			/past retention \(fnb photos prune removes them\)/,
		);
	});

	it("counts on a dry run and removes nothing", async () => {
		const [main] = fixtures;
		const result = await fnb(["--tenant", main?.slug ?? "", "--dry-run"]);
		expect(result.code, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe(
			"photos prune (dry run): 3 photo(s) past their retention; nothing removed",
		);
		expect(await objectNames(main?.tenantId ?? "")).toHaveLength(4);
		expect(await markers(main?.answerIds ?? [])).toEqual([false, false, false]);
	});

	it("removes exactly the expired photos through the Storage API and marks their rows", async () => {
		const [main] = fixtures;
		const result = await fnb(["--tenant", main?.slug ?? ""]);
		expect(result.code, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe(
			"photos prune: 3 photo(s) past their retention, 3 removed, 3 row(s) marked photo-removed",
		);
		for (const hidden of [
			main?.tenantId ?? "",
			main?.slug ?? "",
			BUCKET,
			".jpg",
		]) {
			expect(`${result.stdout}${result.stderr}`).not.toContain(hidden);
		}
		expect(await objectNames(main?.tenantId ?? "")).toEqual([
			main?.runPaths[2],
		]);
		const kept = await storage.storage
			.from(BUCKET)
			.exists(main?.runPaths[2] ?? "");
		expect(kept.data).toBe(true);
		const gone = await storage.storage
			.from(BUCKET)
			.exists(main?.runPaths[0] ?? "");
		expect(gone.data).toBe(false);
		expect(await markers(main?.answerIds ?? [])).toEqual([true, true, false]);
		const [incident] = await sql<{ removed: boolean; paths: string[] }[]>`
			select photo_removed_at is not null as removed, photo_paths as paths
			from public.incidents where id = ${main?.incidentId ?? ""}::uuid
		`;
		expect(incident).toEqual({
			removed: true,
			paths: [main?.incidentPath],
		});
		expect(await foreignObjectsKept()).toBe(true);
	});

	it("finds nothing more on a second run", async () => {
		const [main] = fixtures;
		const result = await fnb(["--tenant", main?.slug ?? ""]);
		expect(result.code, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe(
			"photos prune: 0 photo(s) past their retention, 0 removed, 0 row(s) marked photo-removed",
		);
		expect(await objectNames(main?.tenantId ?? "")).toHaveLength(1);
	});

	it("finishes the marking of an interrupted run, and never marks another tenant's rows from a scoped run", async () => {
		const [main] = fixtures;
		const { error } = await storage.storage
			.from(BUCKET)
			.remove([main?.runPaths[2] ?? ""]);
		expect(error).toBeNull();
		const other = await createFixture(1, false);
		await storage.storage.from(BUCKET).remove([other.runPaths[0] ?? ""]);
		const scoped = await fnb(["--tenant", main?.slug ?? ""]);
		expect(scoped.code, scoped.stderr).toBe(0);
		expect(scoped.stdout).toContain(
			"photos prune: 0 photo(s) past their retention, 0 removed, 0 row(s) marked photo-removed",
		);
		expect(scoped.stdout).toContain(
			"rows of other tenants also lost their photos; their marking is left to a run without --tenant",
		);
		expect(await markers(main?.answerIds ?? [])).toEqual([true, true, false]);
		expect(await markers(other.answerIds)).toEqual([false]);
		await sql`
			update public.checklist_answers set photo_removed_at = now()
			where id = ${other.answerIds[0] ?? ""}::uuid
		`;
		const finished = await fnb(["--tenant", main?.slug ?? ""]);
		expect(finished.code, finished.stderr).toBe(0);
		expect(finished.stdout.trim()).toBe(
			"photos prune: 0 photo(s) past their retention, 0 removed, 1 row(s) marked photo-removed",
		);
		expect(await markers(main?.answerIds ?? [])).toEqual([true, true, true]);
		expect(await foreignObjectsKept()).toBe(true);
	});
});
