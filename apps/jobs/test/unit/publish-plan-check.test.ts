import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanonicalValue,
	canonicalJson,
	type DataPack,
	PLAN_LINT_CODE_IDS,
} from "@fnb/datapack";
import { miniPack, samplePlan } from "@fnb/datapack/testing";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { runCli } from "../../src/cli.js";
import {
	PLAN_LINT_MESSAGES,
	planIssueMessage,
} from "../../src/commands/publish-plan-messages.js";
import type { Environment } from "../../src/config/env-file.js";
import { findRepositoryRoot } from "../../src/config/env-file.js";
import { Services } from "../../src/services.js";
import { capture } from "../support/capture.js";

const ROOT = findRepositoryRoot();
const FIXTURES = join(ROOT, "packages", "datapack", "test", "fixtures");
const GOLDEN_PACK = join(FIXTURES, "demo-pack.json");
const LINT_PACK = join(FIXTURES, "plans", "lint-pack.json");
const MISSING_SECTION =
	"packages/datapack/test/fixtures/plans/missing-section.md";
const UNKNOWN_KPI = "packages/datapack/test/fixtures/plans/unknown-kpi.md";
const GOLDEN_RELATIVE = "packages/datapack/test/fixtures/demo-pack.json";
const UNREACHABLE_DB =
	"postgresql://postgres:never-printed-pw@127.0.0.1:1/postgres";
const BOM = "﻿";

interface Ran {
	code: number;
	stdout: string;
	stderr: string;
}

let scratch: string;

async function run(argv: string[], env: Environment = {}): Promise<Ran> {
	const io = capture();
	const code = await runCli(argv, env, {
		streams: io.streams,
		loadEnvFile: false,
		rootDir: ROOT,
	});
	return { code, stdout: io.stdout(), stderr: io.stderr() };
}

function check(plan: string, pack: string, ...rest: string[]): string[] {
	return ["publish-plan", "--check", "--plan", plan, "--pack", pack, ...rest];
}

function writeScratch(name: string, text: string): string {
	const path = join(scratch, name);
	writeFileSync(path, text);
	return path;
}

function goldenPack(): DataPack {
	return JSON.parse(readFileSync(GOLDEN_PACK, "utf8")) as DataPack;
}

function lintFixture(name: string): string {
	return join(FIXTURES, "plans", "lint", name);
}

beforeAll(() => {
	scratch = mkdtempSync(join(tmpdir(), "fnb-publish-plan-"));
});

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("fnb publish-plan --check: options and help", () => {
	it("is listed and documents --check, its offline reading and its exit codes", async () => {
		const general = await run(["--help"]);
		expect(general.stdout).toContain("publish-plan");
		expect(general.stdout).toContain(
			"fnb publish-plan --check reads only the plan and the pack files",
		);
		const help = await run(["publish-plan", "--help"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain(
			"fnb publish-plan --check --plan <plan.md> --pack <pack.json> [--json]",
		);
		expect(help.stdout).toContain("needs no credential, opens no connection");
		expect(help.stdout).toContain("3 the plan has lint errors");
		expect(help.stdout).toContain("4 the pack is invalid");
	});

	it.each([
		[
			["publish-plan", "--plan", "a.md", "--pack", "b.json"],
			"only --check is available",
		],
		[["publish-plan", "--check", "--pack", "b.json"], "--plan is required"],
		[["publish-plan", "--check", "--plan", "a.md"], "--pack is required"],
		[
			["publish-plan", "--check", "--plan", "", "--pack", "b.json"],
			"--plan needs a file",
		],
		[
			["publish-plan", "--check", "--plan", "a.md", "--pack", "b.json", "x"],
			'unexpected argument "x"',
		],
		[["publish-plan", "--check", "--tenant", "t1"], "Unknown option"],
	])("refuses %j with exit 2", async (argv, message) => {
		const result = await run(argv, { DATABASE_URL: UNREACHABLE_DB });
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(message);
	});

	it("exits 2 for a file it cannot read, naming which one", async () => {
		const plan = await run(check(join(scratch, "missing.md"), GOLDEN_PACK));
		expect(plan.code).toBe(2);
		expect(plan.stderr).toContain("--plan: cannot read");
		const pack = await run(
			check(join(ROOT, MISSING_SECTION), join(scratch, "missing.json")),
		);
		expect(pack.code).toBe(2);
		expect(pack.stderr).toContain("--pack: cannot read");
	});
});

describe("fnb publish-plan --check: the rejection fixtures", () => {
	it("from the repository root, refuses missing-section.md with section_missing:7 and exit 3", async () => {
		const result = await run(check(MISSING_SECTION, GOLDEN_RELATIVE), {
			INIT_CWD: ROOT,
		});
		expect(result.stderr).toBe("");
		expect(result.code).toBe(3);
		expect(result.stdout).toContain(
			`publish-plan: checked ${MISSING_SECTION} against ${GOLDEN_RELATIVE}\n`,
		);
		expect(result.stdout).toContain("ok: false\n");
		expect(result.stdout).toContain("errors: 1\n");
		expect(result.stdout).toContain(
			"issue: error section_missing:7 at line –: section 7 (Promotion calendar) is missing\n",
		);
	});

	it("from the repository root, refuses unknown-kpi.md with kpi_unknown:net_sales and exit 3", async () => {
		const result = await run(check(UNKNOWN_KPI, GOLDEN_RELATIVE), {
			INIT_CWD: ROOT,
		});
		expect(result.code).toBe(3);
		expect(result.stdout).toMatch(
			/^issue: error kpi_unknown:net_sales at line \d+: net_sales is not a metric id of the registry$/m,
		);
		expect(
			result.stdout.split("\n").filter((line) => line.startsWith("issue: ")),
		).toHaveLength(1);
	});
});

describe("fnb publish-plan --check: clean plans, warnings and invalid packs", () => {
	it("passes the sample plan of the golden pack with exit 0, a sample pack that is never publishable", async () => {
		const plan = writeScratch("golden-sample.md", samplePlan(goldenPack()));
		const result = await run(check(plan, GOLDEN_PACK));
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("ok: true\n");
		expect(result.stdout).toContain("sample: true\n");
		expect(result.stdout).toContain("publishable: false\n");
		expect(result.stdout).toContain(
			"not_publishable: sample_pack_not_publishable\n",
		);
		expect(result.stdout).toContain("errors: 0\n");
		expect(result.stdout).toContain("warnings: 0\n");
		expect(result.stdout).toContain("initiatives: 5\n");
		expect(result.stdout).not.toContain("issue: ");
	});

	it("passes the sample plan of a live-shaped pack as publishable", async () => {
		const pack = miniPack();
		const packFile = writeScratch(
			"mini-pack.json",
			canonicalJson(pack as unknown as CanonicalValue),
		);
		const plan = writeScratch("mini-sample.md", samplePlan(pack));
		const result = await run(check(plan, packFile, "--json"));
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			pack_valid: true,
			pack_id: pack.pack_id,
			sample: false,
			publishable: true,
			not_publishable: null,
			errors: 0,
			warnings: 0,
			issues: [],
		});
	});

	it("exits 0 for a plan with warnings only and lists them", async () => {
		const result = await run(
			check(lintFixture("front_matter_extra_fields.md"), LINT_PACK),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("ok: true\n");
		expect(result.stdout).toContain("warnings: 1\n");
		expect(result.stdout).toContain(
			"issue: warning front_matter_extra_fields at line 1: unknown front-matter keys were dropped; the plan stays valid (detail: note)\n",
		);
	});

	it("refuses a pack edited by hand with exit 4 and does not check the plan", async () => {
		const text = readFileSync(GOLDEN_PACK, "utf8");
		const editedText = text.replace(
			/("ALL\/avg_ticket":\s*\[\s*)([1-9])/,
			(_match, row: string, digit: string) =>
				`${row}${digit === "9" ? "8" : String(Number(digit) + 1)}`,
		);
		expect(editedText).not.toBe(text);
		expect(editedText).toHaveLength(text.length);
		const edited = writeScratch("edited.json", editedText);
		const result = await run(check(join(ROOT, MISSING_SECTION), edited));
		expect(result.code).toBe(4);
		expect(result.stdout).toContain("pack_valid: false\n");
		expect(result.stdout).toContain("pack_issue: pack_id_mismatch");
		expect(result.stdout).not.toContain("issue: error");
		const json = await run(
			check(join(ROOT, MISSING_SECTION), edited, "--json"),
		);
		expect(json.code).toBe(4);
		expect(JSON.parse(json.stdout)).toEqual({
			ok: false,
			pack_valid: false,
			pack_issues: ["pack_id_mismatch"],
		});
		const notJson = await run(
			check(join(ROOT, MISSING_SECTION), writeScratch("text.json", "nope")),
		);
		expect(notJson.code).toBe(4);
	});

	it("reads a plan and a pack that start with a byte order mark, and a plan with Windows line ends", async () => {
		const pack = writeScratch(
			"bom-pack.json",
			`${BOM}${readFileSync(GOLDEN_PACK, "utf8")}`,
		);
		const text = samplePlan(goldenPack());
		const plan = writeScratch(
			"bom-plan.md",
			`${BOM}${text.replaceAll("\n", "\r\n")}`,
		);
		const result = await run(check(plan, pack));
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("ok: true\n");
		const missing = writeScratch(
			"bom-missing.md",
			`${BOM}${readFileSync(join(ROOT, MISSING_SECTION), "utf8")}`,
		);
		const refused = await run(check(missing, pack));
		expect(refused.code).toBe(3);
		expect(refused.stdout).toContain("issue: error section_missing:7");
	});
});

describe("fnb publish-plan --check: offline and quiet in CI", () => {
	it("prints the written value and the paths outside CI", async () => {
		const result = await run(
			check(lintFixture("citation_mismatch.md"), LINT_PACK),
		);
		expect(result.code).toBe(3);
		expect(result.stdout).toContain(
			"issue: error citation_mismatch:kpi:ALL/net_revenue:w28 at line 21: the number written before [[kpi:ALL/net_revenue:w28]] does not match the cited cell (detail: 1,32 tỷ đồng)\n",
		);
		expect(result.stdout).toContain(
			"against packages/datapack/test/fixtures/plans/lint-pack.json\n",
		);
	});

	it("names no path, value or full pack id in CI, as text or JSON", async () => {
		const lintPack = JSON.parse(readFileSync(LINT_PACK, "utf8")) as DataPack;
		for (const env of [{ CI: "1" }, { GITHUB_ACTIONS: "true" }]) {
			const result = await run(
				check(lintFixture("citation_mismatch.md"), LINT_PACK),
				env,
			);
			expect(result.code).toBe(3);
			expect(result.stdout).toContain(
				"publish-plan: checked citation_mismatch.md against lint-pack.json\n",
			);
			expect(result.stdout).toContain(
				`pack_id: ${lintPack.pack_id.slice(0, 8)}\n`,
			);
			expect(result.stdout).toContain(
				"issue: error citation_mismatch:kpi:ALL/net_revenue:w28 at line 21: the number written before [[kpi:ALL/net_revenue:w28]] does not match the cited cell\n",
			);
			for (const hidden of [
				"1,32",
				"detail",
				lintPack.pack_id,
				ROOT,
				"packages/datapack",
			]) {
				expect(result.stdout, hidden).not.toContain(hidden);
			}
			const json = await run(
				check(lintFixture("citation_mismatch.md"), LINT_PACK, "--json"),
				env,
			);
			const parsed = JSON.parse(json.stdout) as {
				pack_id: string;
				issues: Record<string, unknown>[];
			};
			expect(parsed.pack_id).toBe(lintPack.pack_id.slice(0, 8));
			expect(parsed.issues).toEqual([
				{
					level: "error",
					code: "citation_mismatch:kpi:ALL/net_revenue:w28",
					line: 21,
					message:
						"the number written before [[kpi:ALL/net_revenue:w28]] does not match the cited cell",
				},
			]);
		}
	});

	it("reads no credential and opens no connection, in an empty environment or with a database configured", async () => {
		const database = vi.spyOn(Services.prototype, "db");
		const admin = vi.spyOn(Services.prototype, "supabaseAdmin");
		const empty = await run(check(join(ROOT, MISSING_SECTION), GOLDEN_PACK));
		expect(empty.code).toBe(3);
		expect(empty.stderr).toBe("");
		const configured = await run(check(join(ROOT, UNKNOWN_KPI), GOLDEN_PACK), {
			DATABASE_URL: UNREACHABLE_DB,
			SUPABASE_DB_URL: UNREACHABLE_DB,
			SUPABASE_URL: "http://127.0.0.1:1",
			SUPABASE_SECRET_KEY: "never-printed-key",
		});
		expect(configured.code).toBe(3);
		expect(configured.stderr).toBe("");
		expect(`${configured.stdout}${configured.stderr}`).not.toContain(
			"never-printed",
		);
		expect(database).not.toHaveBeenCalled();
		expect(admin).not.toHaveBeenCalled();
	});
});

describe("the fixed English messages", () => {
	it("give every lint code its own message, reading the parameter after the first colon", () => {
		expect(Object.keys(PLAN_LINT_MESSAGES).sort()).toEqual(
			[...PLAN_LINT_CODE_IDS].sort(),
		);
		expect(planIssueMessage("initiative_field_missing:2:effort")).toBe(
			"initiative 2 lacks its field Effort (effort), or the field is empty",
		);
		expect(planIssueMessage("citation_unknown:kpi:ALL/avg_ticket:w29")).toBe(
			"[[kpi:ALL/avg_ticket:w29]] names no cell of the pack; context is never cited",
		);
		expect(planIssueMessage("section_missing:10")).toBe(
			"section 10 (Assumptions) is missing",
		);
		expect(planIssueMessage("uncited_numbers:2")).toBe(
			"numbers without a citation in sections 1 and 2 or in an Evidence field: 2",
		);
		expect(planIssueMessage("something_else:1")).toBe("unknown lint code");
	});
});
