import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_OA_MENU, zaloButtons } from "@fnb/zalo/oa";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	type MenuSource,
	planLines,
	planMenu,
} from "../../src/commands/zalo-oa-menu.js";
import { capture } from "../support/capture.js";
import { fakeSql, type Row, tenantRows } from "../support/fake-services.js";
import {
	ECHOING_ERRORS,
	expectNoIdentifiers,
	identifierFindings,
	intl,
	PATH_SEGMENT,
	PHONES,
	POOL_CODES,
	ZALO_USER_ID,
} from "../support/identifiers.js";
import { runFakeCli } from "../support/run-fake-cli.js";

vi.mock("../../src/services.js", async () => {
	const { FakeServices } = await import("../support/fake-services.js");
	return { Services: FakeServices };
});

const MINI_APP = "synthetic-mini-app-1";
const APPLIED_AT = new Date("2026-11-18T03:00:00.000Z");

function source(overrides: Partial<MenuSource> = {}): MenuSource {
	return {
		brandKey: "brand-1",
		menuId: "11111111-1111-4111-8111-111111111111",
		oaId: "22222222-2222-4222-8222-222222222222",
		packageTier: "tang_truong",
		buttons: DEFAULT_OA_MENU.buttons,
		appliedButtons: null,
		appliedAt: null,
		miniAppId: MINI_APP,
		...overrides,
	};
}

async function fnb(argv: readonly string[]) {
	const out = capture();
	const code = await runCli(
		argv,
		{},
		{ streams: out.streams, loadEnvFile: false },
	);
	return { code, stdout: out.stdout(), stderr: out.stderr() };
}

describe("the menu plan", () => {
	it("lists every button as added before the first apply", async () => {
		const plan = await planMenu(source());
		expect(plan.kind).toBe("ready");
		expect(planLines("tenant-a brand-1", plan, false)).toEqual([
			"tenant-a brand-1: 4 button(s), 4 change(s) (never applied)",
			'  1. + "Tham gia thành viên" → keyword #join',
			`  2. + "Điểm của tôi" → https://zalo.me/s/${MINI_APP}/the-thanh-vien?src=oa`,
			`  3. + "Voucher của tôi" → https://zalo.me/s/${MINI_APP}/vi-voucher?src=oa`,
			`  4. + "Mở ứng dụng thành viên" → https://zalo.me/s/${MINI_APP}/?src=oa`,
		]);
	});

	it("has nothing to push once the applied menu equals the configuration", async () => {
		const applied = zaloButtons(DEFAULT_OA_MENU.buttons, MINI_APP);
		const plan = await planMenu(
			source({ appliedButtons: applied, appliedAt: APPLIED_AT }),
		);
		expect(plan.kind === "ready" && plan.changed).toBe(false);
		expect(planLines("brand 1", plan, true)).toEqual([
			"brand 1: 4 button(s), no change (last applied 2026-11-18T03:00:00.000Z)",
			"  1. unchanged OA keyword",
			"  2. unchanged Mini App link",
			"  3. unchanged Mini App link",
			"  4. unchanged Mini App link",
		]);
	});

	it("numbers the diff without labels or links in CI", async () => {
		const applied = zaloButtons(DEFAULT_OA_MENU.buttons.slice(0, 2), MINI_APP);
		const plan = await planMenu(
			source({
				appliedButtons: applied,
				appliedAt: APPLIED_AT,
				miniAppId: "synthetic-mini-app-2",
			}),
		);
		const lines = planLines("brand 2", plan, true);
		expect(lines).toEqual([
			"brand 2: 4 button(s), 3 change(s) (last applied 2026-11-18T03:00:00.000Z)",
			"  1. unchanged OA keyword",
			"  2. ~ Mini App link becomes Mini App link",
			"  3. + Mini App link",
			"  4. + Mini App link",
		]);
		for (const line of lines) {
			expect(line).not.toMatch(/zalo\.me|Điểm|synthetic/);
		}
	});

	it("needs a menu row and, for deep links, the brand's customer Mini App", async () => {
		const missing = await planMenu(source({ menuId: null, buttons: null }));
		expect(planLines("brand 1", missing, true)).toEqual([
			"brand 1: no OA menu is configured; set one with fnb zalo oa-menu set",
		]);
		const noApp = await planMenu(source({ miniAppId: null }));
		expect(noApp.kind).toBe("no_mini_app");
		const keywordOnly = await planMenu(
			source({
				miniAppId: null,
				buttons: [{ action: "join", label: "Tham gia", target: "query" }],
			}),
		);
		expect(keywordOnly.kind).toBe("ready");
	});
});

describe("the commands refuse bad input before touching anything", () => {
	it("needs a tenant and a neutral brand key", async () => {
		const missing = await fnb(["zalo", "oa-menu", "apply", "--dry-run"]);
		expect(missing.code).toBe(2);
		expect(missing.stderr).toContain("--tenant is required");
		const brand = await fnb([
			"zalo",
			"oa-menu",
			"apply",
			"--tenant",
			"zalo-it-unit",
			"--brand",
			"Quán Một",
		]);
		expect(brand.code).toBe(2);
		expect(brand.stderr).toContain("neutral key");
	});

	it("needs the form image for the default join form and keeps the menu file out of the repository", async () => {
		const image = await fnb([
			"zalo",
			"oa-menu",
			"set",
			"--tenant",
			"zalo-it-unit",
			"--brand",
			"brand-1",
		]);
		expect(image.code).toBe(2);
		expect(image.stderr).toContain("form_image_url");
		const http = await fnb([
			"zalo",
			"oa-menu",
			"set",
			"--tenant",
			"zalo-it-unit",
			"--brand",
			"brand-1",
			"--form-image-url",
			"http://example.com/logo.png",
		]);
		expect(http.code).toBe(2);
		expect(http.stderr).toContain("https");
		const inside = await fnb([
			"zalo",
			"oa-menu",
			"set",
			"--tenant",
			"zalo-it-unit",
			"--brand",
			"brand-1",
			"--file",
			"package.json",
		]);
		expect(inside.code).toBe(2);
		expect(inside.stderr).toContain("outside the repository");
	});

	it("takes a mock OA API only with the integration or local switch", async () => {
		const out = capture();
		const code = await runCli(
			["zalo", "oa-menu", "apply", "--tenant", "zalo-it-unit"],
			{ ZALO_OA_API_BASE_URL: "http://127.0.0.1:8788" },
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(2);
		expect(out.stderr()).toContain("accepted only");
	});
});

// G-24 (security, component). The menu rows hold the most text of the three
// commands: a brand's labels, Mini App id, the menu applied last (labels and
// deep links) and the files the owner keeps. Technique: error guessing with a
// fixture that puts a phone, a pool code, a 43-character segment and a Zalo user id
// into every field the commands read, and equivalence partitioning of the paths
// (a clean diff, a rejected stored label, a rejected Mini App id, a database
// error, a file with unknown keys, a file that is accepted). With CI set every
// line of stdout, stderr and the job summary is checked for the four shapes.
// Nothing here pushes: apply runs with --dry-run only, so no Zalo call is made.
describe("fnb zalo oa-menu prints no identifier with CI set (G-24)", () => {
	const directory = mkdtempSync(join(tmpdir(), "fnb-oa-menu-"));
	const ci = { CI: "1" };

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	function menuRow(overrides: Row = {}): Row {
		return {
			brand_key: "brand-1",
			menu_id: "11111111-1111-4111-8111-111111111111",
			oa_id: "22222222-2222-4222-8222-222222222222",
			package_tier: "tang_truong",
			buttons: DEFAULT_OA_MENU.buttons,
			applied_buttons: [
				{
					title: `Gọi ${PHONES[0]}`,
					type: "oa.open.url",
					payload: { url: `https://zalo.me/s/${ZALO_USER_ID}/?src=oa` },
				},
				{
					title: `Mã ${POOL_CODES[0]}`,
					type: "oa.query.hide",
					payload: `#${POOL_CODES[1]}`,
				},
				{
					title: "Mở",
					type: "oa.open.url",
					payload: { url: `https://example.test/cb/${PATH_SEGMENT}` },
				},
			],
			applied_at: new Date("2026-11-18T03:00:00.000Z"),
			mini_app_id: ZALO_USER_ID,
			...overrides,
		};
	}

	const sourcesHandler = (rows: readonly Row[]) => (query: string) =>
		query.includes("oa_menu_source") ? rows : undefined;
	const dryRun = [
		"zalo",
		"oa-menu",
		"apply",
		"--tenant",
		"fixture-a",
		"--dry-run",
	];

	function apply(rows: readonly Row[], env: Record<string, string> = ci) {
		const sql = fakeSql([tenantRows(), sourcesHandler(rows)]);
		return runFakeCli(dryRun, { sql }, { env });
	}

	it("prints counts and button kinds only for a diff against a menu whose labels and links carry identifiers", async () => {
		const result = await apply([
			menuRow(),
			menuRow({ brand_key: "brand-2", mini_app_id: PATH_SEGMENT }),
		]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("brand 1: 4 button(s), 4 change(s)");
		expect(result.stdout).toContain("brand 2: 4 button(s), 4 change(s)");
		expect(result.stdout).toContain("brand 2: dry run, nothing pushed");
		expect(result.stderr).toBe("");
		expectNoIdentifiers(result);
	});

	it("control: without CI the same dry run prints the labels and links, and the harness sees them", async () => {
		const result = await apply([menuRow({ mini_app_id: PATH_SEGMENT })], {});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("fixture-a brand-1");
		expect(identifierFindings("stdout", result.stdout)).not.toEqual([]);
	});

	it("reports a stored label that holds a phone without repeating it", async () => {
		const result = await apply([
			menuRow({
				buttons: [
					{ action: "join", label: `Gọi ${PHONES[1]}`, target: "query" },
				],
			}),
		]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("brand 1: button 1: the label is 1 to");
		expectNoIdentifiers(result);
	});

	it("reports a Mini App id in the international phone form without repeating it", async () => {
		const result = await apply([
			menuRow({ mini_app_id: intl(PHONES[1]?.slice(1) ?? "") }),
		]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("a Mini App id is 1 to 64 letters");
		expectNoIdentifiers(result);
	});

	it.each(ECHOING_ERRORS)(
		"keeps a %s out of the output when the database fails the menu lookup with it",
		async (_kind, message) => {
			const sql = fakeSql([
				tenantRows(),
				(query) => {
					if (query.includes("oa_menu_source")) {
						throw new Error(message);
					}
					return undefined;
				},
			]);
			const result = await runFakeCli(dryRun, { sql }, { env: ci });
			expect(result.code).toBe(1);
			expect(result.stderr).toContain("fnb zalo oa-menu apply failed");
			expectNoIdentifiers(result);
		},
	);

	function menuFile(name: string, content: unknown): string {
		const file = join(directory, name);
		writeFileSync(file, JSON.stringify(content));
		return file;
	}

	const set = (file: string) => [
		"zalo",
		"oa-menu",
		"set",
		"--tenant",
		"fixture-a",
		"--brand",
		"brand-1",
		"--file",
		file,
	];

	it("does not repeat the keys of a menu file that is keyed by phones, codes, segments and ids", async () => {
		const file = menuFile("keyed.json", {
			[PHONES[0] ?? ""]: 1,
			[POOL_CODES[0] ?? ""]: 2,
			[PATH_SEGMENT]: 3,
			[ZALO_USER_ID]: 4,
		});
		const sql = fakeSql([tenantRows()]);
		const result = await runFakeCli(set(file), { sql }, { env: ci });
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("the OA menu file has unknown fields:");
		expectNoIdentifiers(result);
	});

	it("control: without CI the same file's keys are echoed to the owner's own terminal", async () => {
		const file = menuFile("keyed-control.json", { [PHONES[0] ?? ""]: 1 });
		const result = await runFakeCli(set(file), { sql: fakeSql([]) });
		expect(result.code).toBe(2);
		expect(identifierFindings("stderr", result.stderr)).not.toEqual([]);
	});

	it("does not repeat a label that holds a phone, from a file", async () => {
		const file = menuFile("phone-label.json", {
			buttons: [{ action: "join", label: `Gọi ${PHONES[2]}`, target: "query" }],
			form_image_url: "https://example.test/form.png",
		});
		const result = await runFakeCli(
			set(file),
			{ sql: fakeSql([tenantRows()]) },
			{ env: ci },
		);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("without a link or a phone number");
		expectNoIdentifiers(result);
	});

	it.each([
		["a Zalo user id", ZALO_USER_ID],
		["a path segment", PATH_SEGMENT],
	])(
		"does not repeat a text that holds %s, which has too many digits to be a text",
		async (_kind, text) => {
			const file = menuFile("long-digits.json", {
				welcome_text: `Mời ${text}`,
				form_image_url: "https://example.test/form.png",
			});
			const result = await runFakeCli(
				set(file),
				{ sql: fakeSql([tenantRows()]) },
				{ env: ci },
			);
			expect(result.code).toBe(2);
			expect(result.stderr).toContain("welcome_text is 1 to");
			expectNoIdentifiers(result);
		},
	);

	it("accepts a file whose texts carry a pool code and prints the outcome only", async () => {
		const file = menuFile("accepted.json", {
			buttons: [{ action: "points", label: "Điểm", target: "mini_app" }],
			welcome_text: `Mã ${POOL_CODES[0]}`,
			joined_text: `Mã ${POOL_CODES[1]}`,
			form_image_url: `https://example.test/${PATH_SEGMENT}.png`,
		});
		const sql = fakeSql([
			tenantRows(),
			(query) =>
				query.includes("set_oa_menu") ? [{ outcome: "created" }] : undefined,
		]);
		const result = await runFakeCli(set(file), { sql }, { env: ci });
		expect(result.code).toBe(0);
		expect(result.stdout).toBe(
			"the brand: OA menu created; fnb zalo oa-menu apply --dry-run shows what the next apply pushes\n",
		);
		expectNoIdentifiers(result);
	});
});
