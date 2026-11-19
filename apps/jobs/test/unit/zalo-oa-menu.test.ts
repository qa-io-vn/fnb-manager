import { DEFAULT_OA_MENU, zaloButtons } from "@fnb/zalo/oa";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	type MenuSource,
	planLines,
	planMenu,
} from "../../src/commands/zalo-oa-menu.js";
import { capture } from "../support/capture.js";

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
