import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalValue,
	canonicalJson,
	type DataPack,
	lintPlan,
	planLintCodeOf,
	planRecord,
	sha256Hex,
} from "@fnb/datapack";
import { miniPack, samplePlan } from "@fnb/datapack/testing";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { findRepositoryRoot } from "../../src/config/env-file.js";
import { capture } from "../support/capture.js";

const ROOT = findRepositoryRoot();
const ENABLED = process.env.DATAPACK_INTEGRATION === "1";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const FIXTURES = join(
	ROOT,
	"packages",
	"datapack",
	"test",
	"fixtures",
	"plans",
);
const GOLDEN_PACK = join(
	ROOT,
	"packages",
	"datapack",
	"test",
	"fixtures",
	"demo-pack.json",
);
const LOOPBACK = /^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost|\[::1\]):/;
const PASSWORD_PREFIX = "it-datapack-";
const AUTH_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";

interface Login {
	readonly userId: string;
	readonly email: string;
	readonly password: string;
}

let sql: postgres.Sql;
let scratch: string;
let pack: DataPack;
let tenantId: string;
let owner: Login;
let publisher: Login;
let planText: string;
const plansBefore = { count: 0 };

async function insertLogin(role: string, hex: string): Promise<Login> {
	const userId = randomUUID();
	const email = `it-${role}-${hex}@example.com`;
	const password = `${PASSWORD_PREFIX}${hex}`;
	await sql`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
		values (${AUTH_INSTANCE_ID}, ${userId}, 'authenticated', 'authenticated', ${email}, extensions.crypt(${password}, extensions.gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false)`;
	await sql`insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
		values (${randomUUID()}, ${userId}, ${userId}, 'email', jsonb_build_object('sub', ${userId}::text, 'email', ${email}::text, 'email_verified', true, 'phone_verified', false), now(), now(), now())`;
	await sql`insert into public.tenant_members (tenant_id, user_id, role) values (${tenantId}, ${userId}, ${role}::public.tenant_role)`;
	return { userId, email, password };
}

async function signedIn(login: Login): Promise<SupabaseClient> {
	const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const { error } = await client.auth.signInWithPassword({
		email: login.email,
		password: login.password,
	});
	if (error) throw error;
	return client;
}

async function fnb(argv: string[], login: Login) {
	const io = capture();
	const code = await runCli(
		argv,
		{
			SUPABASE_URL,
			SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
			FNB_PUBLISHER_EMAIL: login.email,
			FNB_PUBLISHER_PASSWORD: login.password,
			DATABASE_URL:
				"postgresql://postgres:synthetic-never-used@127.0.0.1:1/postgres",
			SUPABASE_SECRET_KEY: "sb_secret_synthetic_never_used",
		},
		{ streams: io.streams, loadEnvFile: false, rootDir: ROOT },
	);
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

function write(name: string, text: string): string {
	const path = join(scratch, name);
	writeFileSync(path, text);
	return path;
}

async function planCount(): Promise<number> {
	const [row] =
		await sql`select count(*)::int as n from public.strategy_reports where tenant_id = ${tenantId}`;
	return row?.n ?? 0;
}

describe.skipIf(!ENABLED)(
	"fnb datapack and publish-plan on the local stack",
	() => {
		beforeAll(async () => {
			if (!LOOPBACK.test(DATABASE_URL))
				throw new Error("DATAPACK_INTEGRATION needs a loopback DATABASE_URL");
			if (SUPABASE_URL === "" || PUBLISHABLE_KEY === "")
				throw new Error(
					"DATAPACK_INTEGRATION needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY",
				);
			sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
			scratch = mkdtempSync(join(tmpdir(), "fnb-datapack-it-"));
			pack = miniPack();
			const [store] =
				await sql`select tenant_id from public.stores where id = ${pack.request.stores[0]?.id ?? ""}`;
			if (store === undefined)
				throw new Error("the mini pack's stores are not seeded");
			tenantId = store.tenant_id;
			const [tenant] =
				await sql`select slug from public.tenants where id = ${tenantId}`;
			if (!String(tenant?.slug).startsWith("demo-"))
				throw new Error(
					"the mini pack's stores must belong to the seeded demo tenant",
				);
			const hex = randomBytes(4).toString("hex");
			owner = await insertLogin("owner", hex);
			publisher = await insertLogin("publisher", hex);
			planText = samplePlan(pack);
			plansBefore.count = await planCount();
		});

		afterAll(async () => {
			if (sql === undefined) return;
			const hash =
				planText === undefined
					? null
					: await sha256Hex(lintPlan(planText, pack).normalized);
			if (hash !== null)
				await sql`delete from public.strategy_reports where tenant_id = ${tenantId} and content_sha256 = ${hash}`;
			await sql`delete from auth.users where email like 'it-owner-%@example.com' or email like 'it-publisher-%@example.com'`;
			await sql.end();
			rmSync(scratch, { recursive: true, force: true });
		});

		it("scenario 2: the publisher publishes and republishes; the owner reads the plan and the publisher does not; rejections, a direct insert and the owner's login are refused", async () => {
			const packPath = write(
				"pack.json",
				canonicalJson(pack as unknown as CanonicalValue),
			);
			const planPath = write("plan.md", planText);
			const first = await fnb(
				["publish-plan", "--plan", planPath, "--pack", packPath],
				publisher,
			);
			expect(first.code, first.stderr).toBe(0);
			expect(first.stdout).toContain("publish-plan: published");
			const again = await fnb(
				["publish-plan", "--plan", planPath, "--pack", packPath],
				publisher,
			);
			expect(again.code).toBe(0);
			expect(again.stdout).toContain("already published");
			expect(await planCount()).toBe(plansBefore.count + 1);

			const ownerClient = await signedIn(owner);
			const { data: ownerRows } = await ownerClient
				.from("strategy_reports")
				.select("id,generated_via");
			expect(ownerRows?.some((row) => row.generated_via === "skill")).toBe(
				true,
			);
			const publisherClient = await signedIn(publisher);
			const { data: publisherRows } = await publisherClient
				.from("strategy_reports")
				.select("id");
			expect(publisherRows).toEqual([]);
			const { data: sales } = await publisherClient
				.from("invoices")
				.select("id")
				.limit(1);
			expect(sales ?? []).toEqual([]);
			const { error: insertError } = await publisherClient
				.from("strategy_reports")
				.insert({
					tenant_id: tenantId,
					store_ids: pack.request.stores.map((store) => store.id),
					horizon: "90d",
					language: "vi",
					generated_via: "skill",
					title: "Planted",
					content_markdown: "x",
				});
			expect(insertError?.code).toBe("42501");

			for (const [name, code] of [
				["missing-section.md", "section_missing:7"],
				["unknown-kpi.md", "kpi_unknown:net_sales"],
			] as const) {
				const refused = await fnb(
					[
						"publish-plan",
						"--plan",
						join(FIXTURES, name),
						"--pack",
						GOLDEN_PACK,
					],
					publisher,
				);
				expect(refused.code).toBe(3);
				expect(refused.stdout).toContain(code);
			}
			const guarded = await fnb(
				["publish-plan", "--plan", planPath, "--pack", packPath],
				owner,
			);
			expect(guarded.code).toBe(1);
			expect(guarded.stderr).toContain("data member");
			expect(await planCount()).toBe(plansBefore.count + 1);

			const record = planRecord(
				lintPlan(planText, pack).plan as NonNullable<
					ReturnType<typeof lintPlan>["plan"]
				>,
				pack,
				lintPlan(planText, pack),
				"pasted",
			);
			const { error: rpcError } = await publisherClient.rpc(
				"publish_strategy_plan",
				{
					...record,
					p_content_markdown: record.p_content_markdown.replace(
						/## 7\. [^\n]+\n/,
						"",
					),
				},
			);
			expect(rpcError?.code).toBe("22023");
			expect(rpcError?.details).toContain("section_missing:7");
		});

		it("scenario 4: the lint and the SQL validators give the same codes for the structural fixtures built on the mini pack", async () => {
			const base = samplePlan(pack);
			const variants: Record<string, string> = {
				clean: base,
				no_section_7: base.replace(/## 7\. [^\n]+\n/, ""),
				no_sections_7_9: base
					.replace(/## 7\. [^\n]+\n/, "")
					.replace(/## 9\. [^\n]+\n/, ""),
				four_initiatives: base.replace(/### Sáng kiến 5:[\s\S]*?(?=\n## )/, ""),
				unknown_kpi: base.replaceAll("avg_ticket", "net_sales"),
				untracked_kpi: base.replaceAll("avg_ticket", "void_rate"),
				no_front_matter: base.slice(base.indexOf("\n---\n") + 5),
			};
			const SQL_CHECKED = new Set([
				"front_matter_missing",
				"section_missing",
				"initiatives_count",
				"kpi_unknown",
				"kpi_untracked",
				"kpis_count",
			]);
			for (const [name, text] of Object.entries(variants)) {
				const lint = lintPlan(text, pack);
				const fromLint = lint.issues
					.filter((issue) => SQL_CHECKED.has(planLintCodeOf(issue.code) ?? ""))
					.map((issue) => issue.code.replace(/^kpi_untracked:/, "kpi_unknown:"))
					.sort();
				const normalized = lint.normalized;
				const front = normalized.startsWith("---\n")
					? (JSON.parse(
							normalized.slice(4, normalized.indexOf("\n---\n", 3)),
						) as {
							kpis?: Record<string, { target: number; initiatives: number[] }>;
						})
					: null;
				const kpis = Object.fromEntries(
					Object.entries(front?.kpis ?? {}).map(([id, kpi]) => [
						id,
						{
							scope: "ALL",
							store_ids: pack.request.stores.map((store) => store.id),
							baseline: kpi.target + 1,
							target: kpi.target,
							lo: null,
							hi: null,
							initiatives: kpi.initiatives,
							due_on: pack.calendar.horizon.to,
							window_days: 28,
						},
					]),
				);
				const [row] =
					await sql`select app.plan_structure_errors(${normalized}, 'vi') as structure,
				app.plan_kpi_errors(${sql.json(kpis)}::jsonb, ${pack.request.stores.map((store) => store.id)}::uuid[]) as kpi`;
				const structure = (row?.structure ?? []) as string[];
				const fromSql = [
					...structure,
					...(structure.includes("front_matter_missing")
						? []
						: ((row?.kpi ?? []) as string[])),
				]
					.filter((code) => SQL_CHECKED.has(code.split(":")[0] ?? ""))
					.sort();
				expect({ name, codes: fromSql }).toEqual({ name, codes: fromLint });
			}
			expect(readFileSync(GOLDEN_PACK, "utf8").length).toBeGreaterThan(0);
		});
	},
);
