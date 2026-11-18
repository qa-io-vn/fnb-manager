import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	type CanonicalValue,
	canonicalJson,
	type DataPack,
	DataPackError,
	sha256Hex,
	strategyPrompt,
} from "@fnb/datapack";
import { miniPack } from "@fnb/datapack/testing";
import type { ReportSource } from "@fnb/reports";
import { ConsoleNotifier } from "@fnb/runner";
import { createRedactor } from "@fnb/sync";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	chosenStoreIds,
	type DatapackBackend,
	datapackCommand,
	datapackOptions,
	type PackMember,
	postgresDatapackBackend,
	runDatapack,
	type VisibleStore,
} from "../../src/commands/datapack.js";
import { isCi } from "../../src/config/config.js";
import type { Environment } from "../../src/config/env-file.js";
import { collectSecrets } from "../../src/config/secrets.js";
import type { CommandContext } from "../../src/context.js";
import { Output } from "../../src/output.js";
import { Services } from "../../src/services.js";
import { capture } from "../support/capture.js";

const UNREACHABLE_DB =
	"postgresql://postgres:never-printed-pw@127.0.0.1:1/postgres";
const TENANT_SLUG = "pack-fixture-tenant";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_EMAIL = "pack-owner@example.com";
const STORE_ONE = "22222222-2222-4222-8222-000000000001";
const STORE_TWO = "22222222-2222-4222-8222-000000000002";
const STORE_NAMES = ["Quán Thử Một", "Quán Thử Hai"];
const NOW = new Date("2026-11-12T03:00:00Z");

let scratch: string;
let root: string;
let outside: string;

interface Ran {
	code: number;
	stdout: string;
	stderr: string;
}

async function run(argv: string[], env: Environment = {}): Promise<Ran> {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
		rootDir: root,
		now: () => NOW,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

function profile(id: string, label: string, name: string) {
	return {
		store_id: id,
		tenant_id: TENANT_ID,
		label,
		name,
		timezone: "Asia/Ho_Chi_Minh",
		business_day_start_minutes: 0,
		opened_on: "2025-10-07",
		opening_hours: null,
		seat_count: 24,
		e_invoice_status: "configured",
		currency_code: "VND",
		country_code: "VN",
	};
}

const PROFILES = [
	profile(STORE_ONE, "S1", STORE_NAMES[0] ?? ""),
	profile(STORE_TWO, "S2", STORE_NAMES[1] ?? ""),
];

function fakeSource(failWith: DataPackError | null): ReportSource {
	return {
		kind: "postgres",
		async call() {
			if (failWith !== null) throw failWith;
			return [] as never;
		},
		async callTheme(name, args) {
			if (name !== "store_profiles") return [] as never;
			const wanted = (args as { store_ids: string[] }).store_ids;
			return PROFILES.filter((row) => wanted.includes(row.store_id)) as never;
		},
	};
}

interface FakeOptions {
	readonly stores?: readonly VisibleStore[];
	readonly failWith?: DataPackError;
}

function fakeBackend(options: FakeOptions = {}): DatapackBackend & {
	readonly members: string[];
} {
	const members: string[] = [];
	return {
		members,
		async tenant() {
			return { id: TENANT_ID };
		},
		async member(_context, _tenantId, email): Promise<PackMember> {
			members.push(email ?? "default owner");
			return {
				userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				role: email === null ? "owner" : "manager",
				email,
			};
		},
		snapshot(_context, _tenantId, _member, run) {
			return run({
				source: fakeSource(options.failWith ?? null),
				stores: async () => [
					...(options.stores ?? [
						{
							id: STORE_ONE,
							label: "S1",
							name: STORE_NAMES[0] ?? "",
							active: true,
						},
						{
							id: STORE_TWO,
							label: "S2",
							name: STORE_NAMES[1] ?? "",
							active: true,
						},
					]),
				],
			});
		},
	};
}

function contextFor(env: Environment, rootDir: string) {
	const io = capture();
	const redact = createRedactor(collectSecrets(env));
	const output = new Output({ ci: isCi(env), streams: io.streams, redact });
	const context: CommandContext = {
		env,
		rootDir,
		output,
		services: new Services(env),
		redact,
		notifier: new ConsoleNotifier((line) => output.error(line), redact),
		now: () => NOW,
	};
	return { context, io };
}

async function runBuild(
	argv: string[],
	env: Environment,
	backend: DatapackBackend = fakeBackend(),
): Promise<Ran> {
	const { values } = parseArgs({
		args: argv,
		options: datapackCommand.options,
		strict: true,
	});
	const { context, io } = contextFor(env, root);
	try {
		const code = await runDatapack(context, values, backend);
		return { code, stdout: io.stdout(), stderr: io.stderr() };
	} finally {
		await context.services.close();
	}
}

function packFiles(): string[] {
	const folder = join(root, "docs", "private", "strategy", "packs");
	return existsSync(folder) ? readdirSync(folder).sort() : [];
}

async function withPackId(pack: DataPack): Promise<string> {
	const blank = canonicalJson({
		...pack,
		pack_id: "",
		generated_at: "",
	} as unknown as CanonicalValue);
	return canonicalJson({
		...pack,
		pack_id: await sha256Hex(blank),
	} as unknown as CanonicalValue);
}

function writeScratch(name: string, text: string): string {
	const path = join(outside, name);
	writeFileSync(path, text);
	return path;
}

beforeAll(() => {
	scratch = realpathSync(mkdtempSync(join(tmpdir(), "fnb-datapack-cli-")));
	root = join(scratch, "repository");
	outside = join(scratch, "outside");
	mkdirSync(root, { recursive: true });
	mkdirSync(outside, { recursive: true });
	if (spawnSync("git", ["init", "-q"], { cwd: root }).status !== 0) {
		throw new Error("git init failed");
	}
	writeFileSync(join(root, ".gitignore"), "docs/private/\n");
	writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
});

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("fnb datapack: options", () => {
	it("is listed and documents its three modes, the private folders and the exit codes", async () => {
		expect((await run(["--help"])).stdout).toContain("datapack");
		const help = await run(["datapack", "--help"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("--check <file> [--against <file>]");
		expect(help.stdout).toContain("--list-stores");
		expect(help.stdout).toContain("docs/private/");
		expect(help.stdout).toContain("4 the pack is invalid or over budget");
	});

	it("reads the build flags with their defaults", () => {
		expect(
			datapackOptions(
				{
					tenant: "demo-fnb",
					store: ["s2", "22222222-2222-4222-8222-00000000000A"],
					"as-of": "2026-11-10",
					focus: "  Tăng giá trị hóa đơn ",
				},
				false,
			),
		).toEqual({
			kind: "build",
			tenant: "demo-fnb",
			stores: ["S2", "22222222-2222-4222-8222-00000000000a"],
			member: null,
			asOf: "2026-11-10",
			horizon: "90d",
			language: "vi",
			focus: "Tăng giá trị hóa đơn",
			noteFile: null,
			out: null,
			bundle: null,
			json: false,
		});
		expect(
			datapackOptions({ check: "a.json", against: "b.json" }, true),
		).toEqual({
			kind: "check",
			file: "a.json",
			against: "b.json",
			json: false,
		});
		expect(
			datapackOptions({ tenant: "demo-fnb", "list-stores": true }, false),
		).toEqual({ kind: "list", tenant: "demo-fnb", member: null, json: false });
	});

	it.each([
		[["datapack"], "--tenant is required"],
		[["datapack", "--tenant", "Not A Slug"], "--tenant must be"],
		[
			["datapack", "--tenant", "t1", "--as-of", "2026-02-30"],
			"--as-of must be",
		],
		[
			["datapack", "--tenant", "t1", "--horizon", "7d"],
			"--horizon must be one of 30d, 90d, 180d, 12m",
		],
		[
			["datapack", "--tenant", "t1", "--language", "fr"],
			"--language must be one of vi, en",
		],
		[
			["datapack", "--tenant", "t1", "--store", "Cửa hàng 1"],
			"--store takes a store label",
		],
		[
			["datapack", "--tenant", "t1", "--store", "S1", "--store", "s1"],
			"the same store twice",
		],
		[
			["datapack", "--tenant", "t1", "--member", "nobody"],
			"--member must be a login e-mail",
		],
		[["datapack", "--against", "a.json"], "--against needs --check"],
		[
			["datapack", "--check", "a.json", "--tenant", "t1"],
			"--tenant does not go with --check",
		],
		[
			["datapack", "--tenant", "t1", "--list-stores", "--out", "x.json"],
			"--out does not go with --list-stores",
		],
		[["datapack", "--tenant", "t1", "--out", ""], "--out needs a file"],
		[["datapack", "--tenant", "t1", "--nope"], "Unknown option"],
	])("refuses %j with exit 2 before connecting", async (argv, message) => {
		const result = await run(argv, { DATABASE_URL: UNREACHABLE_DB });
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(message);
		expect(result.stderr).not.toContain("cannot reach");
	});

	it("refuses more than ten stores", async () => {
		const stores = Array.from({ length: 11 }, (_, index) => [
			"--store",
			`S${index + 1}`,
		]).flat();
		const result = await run(["datapack", "--tenant", "t1", ...stores]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("at most 10 stores");
	});

	it("refuses the store list in CI, which would print names and ids", async () => {
		for (const env of [{ CI: "1" }, { GITHUB_ACTIONS: "true" }]) {
			const result = await run(
				["datapack", "--tenant", TENANT_SLUG, "--list-stores"],
				{ ...env, DATABASE_URL: UNREACHABLE_DB },
			);
			expect(result.code).toBe(2);
			expect(result.stderr).toContain("--list-stores is refused in CI");
			expect(`${result.stdout}${result.stderr}`).not.toContain(TENANT_SLUG);
		}
	});

	it("refuses an output in a tracked folder before connecting, and names only its base name in CI", async () => {
		const result = await run(
			[
				"datapack",
				"--tenant",
				TENANT_SLUG,
				"--out",
				"apps/jobs/docs/private/strategy/pack.json",
			],
			{ CI: "1", INIT_CWD: root, DATABASE_URL: UNREACHABLE_DB },
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(
			"--out refused: pack.json is inside the repository but not below docs/private/",
		);
		expect(result.stderr).not.toContain(root);
		expect(result.stderr).not.toContain("apps/jobs");
		expect(existsSync(join(root, "apps"))).toBe(false);
		const local = await run(
			["datapack", "--tenant", TENANT_SLUG, "--bundle", "docs/bundle.md"],
			{ INIT_CWD: root, DATABASE_URL: UNREACHABLE_DB },
		);
		expect(local.code).toBe(2);
		expect(local.stderr).toContain(
			"--bundle refused: docs/bundle.md is inside",
		);
	});
});

describe("fnb datapack --check", () => {
	let valid: string;
	let later: string;
	let other: string;
	let edited: string;

	beforeAll(async () => {
		const pack = miniPack();
		valid = writeScratch(
			"valid.json",
			canonicalJson(pack as unknown as CanonicalValue),
		);
		later = writeScratch(
			"later.json",
			`﻿${canonicalJson({ ...pack, generated_at: "2026-11-12T09:30:00Z" } as unknown as CanonicalValue)}`,
		);
		const items = pack.tables.items;
		if (items === undefined) throw new Error("no items");
		const top = items.rows["ALL/r01"];
		if (top === undefined) throw new Error("no top item");
		other = writeScratch(
			"other.json",
			await withPackId({
				...pack,
				tables: {
					...pack.tables,
					items: {
						...items,
						rows: {
							...items.rows,
							"ALL/r01": [
								top[0] ?? null,
								top[1] ?? null,
								3121,
								...top.slice(3),
							],
						},
					},
				},
			}),
		);
		edited = writeScratch(
			"edited.json",
			canonicalJson({
				...pack,
				tables: { ...pack.tables, items: { ...items, rows: {} } },
			} as unknown as CanonicalValue),
		);
	});

	it("exits 0 for a valid pack and needs no credential or connection", async () => {
		const result = await run(["datapack", "--check", valid]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("valid: true");
		expect(result.stdout).toContain("aggregates_only: true");
		expect(result.stdout).toContain(`pack_id: ${miniPack().pack_id}`);
		expect(result.stdout).toContain("issues: 0");
	});

	it("exits 4 for a pack edited by hand or a file that is not JSON, listing the issue codes", async () => {
		const result = await run(["datapack", "--check", edited]);
		expect(result.code).toBe(4);
		expect(result.stdout).toContain("valid: false");
		expect(result.stdout).toContain("issue: pack_id_mismatch");
		const text = writeScratch("text.json", "not json");
		const notJson = await run(["datapack", "--check", text, "--json"]);
		expect(notJson.code).toBe(4);
		expect(JSON.parse(notJson.stdout)).toMatchObject({
			valid: false,
			aggregates_only: false,
			issues: 1,
		});
	});

	it("exits 2 for a file it cannot read", async () => {
		const result = await run([
			"datapack",
			"--check",
			join(outside, "missing.json"),
		]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("--check: cannot read");
	});

	it("compares two packs: identical apart from generated_at exits 0", async () => {
		const result = await run([
			"datapack",
			"--check",
			valid,
			"--against",
			later,
		]);
		expect(result.code).toBe(0);
		expect(result.stdout.split("\n").filter(Boolean)).toEqual([
			"valid: true",
			"identical_apart_from_generated_at: true",
			"pack_id_equal: true",
			"tables_differing: none",
		]);
	});

	it("exits 1 when both packs are valid but differ, and 4 when one is invalid", async () => {
		const differ = await run([
			"datapack",
			"--check",
			valid,
			"--against",
			other,
			"--json",
		]);
		expect(differ.code).toBe(1);
		expect(JSON.parse(differ.stdout)).toEqual({
			valid: true,
			identical_apart_from_generated_at: false,
			pack_id_equal: false,
			tables_differing: ["items"],
		});
		const invalid = await run([
			"datapack",
			"--check",
			valid,
			"--against",
			edited,
		]);
		expect(invalid.code).toBe(4);
		expect(invalid.stdout).toContain("valid: false");
	});

	it("masks the credentials before any other output on GitHub Actions", async () => {
		const result = await run(["datapack", "--check", valid], {
			GITHUB_ACTIONS: "true",
			DATABASE_URL: UNREACHABLE_DB,
			FNB_MEMBER_PASSWORD: "member-secret-pw",
		});
		expect(result.code).toBe(0);
		const lines = result.stdout.split("\n");
		const masks = lines.filter((line) => line.startsWith("::add-mask::"));
		expect(masks).toEqual(
			expect.arrayContaining(["::add-mask::member-secret-pw"]),
		);
		expect(lines.slice(0, masks.length)).toEqual(masks);
		expect(lines[masks.length]).toBe("valid: true");
		expect(lines.slice(masks.length).join("\n")).not.toContain(
			"member-secret-pw",
		);
	});

	it("starts relative paths from INIT_CWD and prints no path or full id in CI", async () => {
		const result = await run(["datapack", "--check", "valid.json"], {
			INIT_CWD: outside,
			CI: "1",
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			`pack_id: ${miniPack().pack_id.slice(0, 8)}\n`,
		);
		expect(result.stdout).not.toContain(miniPack().pack_id);
		expect(result.stdout).not.toContain(outside);
	});
});

describe("fnb datapack: building as a member", () => {
	it("writes the default file below docs/private/strategy/packs/ and names nothing in CI", async () => {
		const env = {
			CI: "1",
			INIT_CWD: join(root, "apps", "jobs"),
			DATABASE_URL: UNREACHABLE_DB,
		};
		const backend = fakeBackend();
		const result = await runBuild(
			["--tenant", TENANT_SLUG, "--member", MEMBER_EMAIL],
			env,
			backend,
		);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		const [file] = packFiles();
		expect(file).toMatch(/^2026-11-11_tat-ca_[0-9a-f]{8}\.json$/);
		const text = readFileSync(
			join(root, "docs", "private", "strategy", "packs", file ?? ""),
			"utf8",
		);
		const pack = JSON.parse(text) as DataPack;
		expect(pack.sample).toBe(false);
		expect(pack.request.stores.map((store) => store.id)).toEqual([
			STORE_ONE,
			STORE_TWO,
		]);
		expect(file).toContain(pack.pack_id.slice(0, 8));
		expect(result.stdout).toContain(`datapack: pack written to ${file}\n`);
		expect(result.stdout).toContain("valid: true\n");
		expect(result.stdout).toContain("aggregates_only: true\n");
		expect(result.stdout).toContain("stores: S1, S2\n");
		expect(result.stdout).toContain("member: manager\n");
		expect(result.stdout).toContain(`pack_id: ${pack.pack_id.slice(0, 8)}\n`);
		for (const secret of [
			TENANT_SLUG,
			TENANT_ID,
			MEMBER_EMAIL,
			STORE_ONE,
			STORE_TWO,
			...STORE_NAMES,
			root,
			"docs/private",
			pack.pack_id,
			"never-printed-pw",
		]) {
			expect(result.stdout, secret).not.toContain(secret);
		}
		expect(result.stdout).not.toMatch(/[0-9]{1,3}(?:[.,][0-9]{3})+/);
		expect(existsSync(join(root, "apps"))).toBe(false);
		expect(backend.members).toEqual([MEMBER_EMAIL]);
	});

	it("reports the path from the repository root outside CI and writes the chat bundle", async () => {
		const result = await runBuild(
			[
				"--tenant",
				TENANT_SLUG,
				"--store",
				"S2",
				"--language",
				"en",
				"--out",
				"docs/private/strategy/en.json",
				"--bundle",
				join(outside, "bundle.md"),
				"--json",
			],
			{ INIT_CWD: root },
		);
		expect(result.code).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report).toMatchObject({
			valid: true,
			aggregates_only: true,
			as_of: "2026-11-11",
			horizon: "90d",
			language: "en",
			stores: ["S2"],
			member: "the first owner with every store (owner)",
			limit: 30000,
			trimmed: [],
			out: "docs/private/strategy/en.json",
			bundle: join(outside, "bundle.md"),
		});
		expect(report.pack_id).toMatch(/^[0-9a-f]{64}$/);
		const pack = JSON.parse(
			readFileSync(
				join(root, "docs", "private", "strategy", "en.json"),
				"utf8",
			),
		) as DataPack;
		expect(pack.request.stores).toEqual([{ id: STORE_TWO, label: "S2" }]);
		const bundle = readFileSync(join(outside, "bundle.md"), "utf8");
		expect(bundle.startsWith(strategyPrompt("en").text)).toBe(true);
		expect(bundle).toContain(`"pack_id":"${pack.pack_id}"`);
	});

	it("names the default file after the chosen labels and reads the owner note from a file", async () => {
		const note = join(outside, "note.txt");
		writeFileSync(note, "﻿Quán đông   vào buổi tối.\n");
		const result = await runBuild(
			[
				"--tenant",
				TENANT_SLUG,
				"--store",
				STORE_ONE,
				"--store",
				"S2",
				"--as-of",
				"2026-11-01",
				"--note-file",
				"note.txt",
			],
			{ INIT_CWD: outside },
		);
		expect(result.code).toBe(0);
		const file = packFiles().find((name) => name.startsWith("2026-11-01_"));
		expect(file).toMatch(/^2026-11-01_s1-s2_[0-9a-f]{8}\.json$/);
		expect(result.stdout).toContain(
			`datapack: pack written to docs/private/strategy/packs/${file}`,
		);
		const pack = JSON.parse(
			readFileSync(
				join(root, "docs", "private", "strategy", "packs", file ?? ""),
				"utf8",
			),
		) as DataPack;
		expect(pack.request.owner_note).toBe("Quán đông vào buổi tối.");
	});

	it("maps refused requests to exit 2 and invalid packs to exit 4", async () => {
		const later = await runBuild(
			["--tenant", TENANT_SLUG, "--as-of", "2026-11-12"],
			{ INIT_CWD: root },
		);
		expect(later.code).toBe(2);
		expect(later.stderr).toContain("datapack: pack_as_of_not_complete:");
		const unseen = await runBuild(["--tenant", TENANT_SLUG, "--store", "S9"], {
			INIT_CWD: root,
		});
		expect(unseen.code).toBe(2);
		expect(unseen.stderr).toContain(
			"pack_stores_invalid: no store the member can see has the label S9",
		);
		const contact = await runBuild(
			["--tenant", TENANT_SLUG, "--focus", "gọi 0901234567"],
			{ INIT_CWD: root },
		);
		expect(contact.code).toBe(2);
		expect(contact.stderr).toContain("pack_text_contact_details");
		for (const code of [
			"pack_over_budget",
			"pack_invalid",
			"pack_not_aggregate",
		] as const) {
			const failed = await runBuild(
				["--tenant", TENANT_SLUG, "--out", join(outside, `${code}.json`)],
				{ INIT_CWD: root },
				fakeBackend({ failWith: new DataPackError(code, "refused") }),
			);
			expect(failed.code, code).toBe(4);
			expect(failed.stderr).toContain(`datapack: ${code}: refused`);
			expect(existsSync(join(outside, `${code}.json`))).toBe(false);
		}
		const nothing = await runBuild(
			["--tenant", TENANT_SLUG],
			{ INIT_CWD: root },
			fakeBackend({ stores: [] }),
		);
		expect(nothing.code).toBe(2);
		expect(nothing.stderr).toContain("sees no active store");
	});

	it("chooses every active store by default, labels through the member's view and ids as given", () => {
		const stores: VisibleStore[] = [
			{ id: STORE_ONE, label: "S1", name: "a", active: true },
			{ id: STORE_TWO, label: "S2", name: "b", active: false },
		];
		expect(chosenStoreIds(stores, [])).toEqual([STORE_ONE]);
		expect(chosenStoreIds(stores, ["S2", STORE_ONE])).toEqual([
			STORE_TWO,
			STORE_ONE,
		]);
		expect(() => chosenStoreIds(stores, ["S3"])).toThrow(
			/^pack_stores_invalid: /,
		);
	});
});

describe("fnb datapack: the member", () => {
	function contextWithRows(rows: readonly Record<string, unknown>[]) {
		const sql = (() => Promise.resolve(rows)) as unknown;
		const { context } = contextFor({}, root);
		context.services = { db: () => ({ sql }) } as unknown as Services;
		return context;
	}

	it("refuses a publisher login and a login that is not a member", async () => {
		await expect(
			postgresDatapackBackend.member(
				contextWithRows([
					{ user_id: "u1", role: "publisher", store_ids: null },
				]),
				TENANT_ID,
				MEMBER_EMAIL,
			),
		).rejects.toThrow("a publisher login reads no figures");
		await expect(
			postgresDatapackBackend.member(
				contextWithRows([]),
				TENANT_ID,
				MEMBER_EMAIL,
			),
		).rejects.toThrow("no member of the tenant has that login e-mail");
		await expect(
			postgresDatapackBackend.member(contextWithRows([]), TENANT_ID, null),
		).rejects.toThrow("the tenant has no owner with every store");
	});

	it("accepts every data role and defaults to the first unlimited owner", async () => {
		for (const role of ["owner", "manager", "staff", "viewer"]) {
			expect(
				await postgresDatapackBackend.member(
					contextWithRows([{ user_id: "u1", role, store_ids: null }]),
					TENANT_ID,
					MEMBER_EMAIL,
				),
			).toEqual({ userId: "u1", role, email: MEMBER_EMAIL });
		}
		expect(
			await postgresDatapackBackend.member(
				contextWithRows([{ user_id: "u2" }]),
				TENANT_ID,
				null,
			),
		).toEqual({ userId: "u2", role: "owner", email: null });
	});

	it("exits 1 through the command when the member is refused", async () => {
		const backend: DatapackBackend = {
			...fakeBackend(),
			async member() {
				throw new Error(
					"a publisher login reads no figures, so it cannot build a pack",
				);
			},
		};
		await expect(
			runBuild(
				["--tenant", TENANT_SLUG, "--member", MEMBER_EMAIL],
				{},
				backend,
			),
		).rejects.toThrow("publisher");
		const result = await run(["datapack", "--tenant", TENANT_SLUG], {
			CI: "1",
			DATABASE_URL: UNREACHABLE_DB,
		});
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("fnb datapack failed:");
		expect(result.stderr).not.toContain("never-printed-pw");
		expect(result.stderr).not.toContain(TENANT_SLUG);
	});
});
