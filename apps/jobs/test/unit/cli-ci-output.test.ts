import { parseArgs } from "node:util";
import { createRedactor } from "@fnb/sync";
import { DEFAULT_OA_MENU } from "@fnb/zalo/oa";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { findCommand } from "../../src/commands/index.js";
import { isCi } from "../../src/config/config.js";
import type { CommandContext } from "../../src/context.js";
import { Output } from "../../src/output.js";
import type { Services } from "../../src/services.js";
import { capture } from "../support/capture.js";

// G-24: with CI set, none of the loyalty and OA-menu commands prints a store name,
// tenant slug, phone, code or URL.

const SLUG = "synthetic-slug-alpha";
const STORE = "Synthetic Store Name";
const PHONE = "0900000123";
const CODE = "SYN00042";
const MINI_APP = "synthetic-mini-app-9";
const FORBIDDEN = [SLUG, STORE, PHONE, CODE, MINI_APP, "synthetic"];

function expectNoIdentifiers(text: string): void {
	for (const word of FORBIDDEN) {
		expect(text).not.toContain(word);
	}
	expect(text).not.toMatch(/https?:\/\/|zalo\.me|0\d{9}\b/);
}

const NOW = new Date("2026-11-20T21:00:00.000Z");

function fakeServices(): Services {
	const sql = (strings: TemplateStringsArray) => {
		const text = strings.join("?");
		if (text.includes("from public.tenants")) {
			return Promise.resolve([
				{
					id: "tenant-id-1",
					slug: SLUG,
					name: STORE,
					country_code: "VN",
					currency_code: "VND",
					timezone: "Asia/Ho_Chi_Minh",
					legal_form: "unknown",
				},
			]);
		}
		if (text.includes("oa_menu_source")) {
			return Promise.resolve([
				{
					brand_key: "brand-1",
					menu_id: "11111111-1111-4111-8111-111111111111",
					oa_id: "22222222-2222-4222-8222-222222222222",
					package_tier: "tang_truong",
					buttons: DEFAULT_OA_MENU.buttons,
					applied_buttons: null,
					applied_at: null,
					mini_app_id: MINI_APP,
				},
			]);
		}
		return Promise.resolve([]);
	};
	const runner = {
		loyaltyTenants: async () => [{ tenantId: "tenant-id-1", slug: SLUG }],
		reconcileLoyalty: async () => ({ a_earned: 1 }),
		loyaltyNightly: async () => ({ clawbacks: 2 }),
	};
	return {
		db: () => ({ sql, runner }),
		close: async () => {},
	} as unknown as Services;
}

async function runWithFakes(argv: string[], ci: boolean) {
	const command = findCommand(argv);
	if (command === undefined) {
		throw new Error("unknown command");
	}
	const io = capture();
	const env = ci ? { CI: "1" } : {};
	const redact = createRedactor([]);
	const output = new Output({ ci: isCi(env), streams: io.streams, redact });
	const context = {
		env,
		rootDir: process.cwd(),
		output,
		services: fakeServices(),
		redact,
		notifier: { notify: async () => {} },
		now: () => NOW,
	} as unknown as CommandContext;
	const { values } = parseArgs({
		args: argv.slice(command.path.length),
		options: command.options,
		strict: true,
	});
	const code = await command.run(context, values as never);
	return { code, text: io.stdout() + io.stderr() };
}

async function fnb(argv: string[]) {
	const io = capture();
	const code = await runCli(
		argv,
		{ CI: "1" },
		{
			streams: io.streams,
			loadEnvFile: false,
		},
	);
	return { code, text: io.stdout() + io.stderr() };
}

describe("CLI output with CI=1 names no identifier", () => {
	it("fnb loyalty nightly", async () => {
		const ran = await runWithFakes(
			["loyalty", "nightly", "--tenant", SLUG],
			true,
		);
		expect(ran.code).toBe(0);
		expect(ran.text).toContain("nightly");
		expectNoIdentifiers(ran.text);
		const all = await runWithFakes(
			["loyalty", "nightly", "--all-tenants"],
			true,
		);
		expectNoIdentifiers(all.text);
	});

	it("fnb loyalty nightly with an unknown tenant", async () => {
		const result = await fnb(["loyalty", "nightly", "--tenant", SLUG]);
		expectNoIdentifiers(result.text);
	});

	it("fnb loyalty callback-path issue is refused", async () => {
		const result = await fnb([
			"loyalty",
			"callback-path",
			"issue",
			"--tenant",
			SLUG,
			"--label",
			"pos-crm",
		]);
		expect(result.code).toBe(2);
		expect(result.text).toContain("not in CI");
		expectNoIdentifiers(result.text);
	});

	it("fnb loyalty codes import and export are refused", async () => {
		const imported = await fnb([
			"loyalty",
			"codes",
			"import",
			"--tenant",
			SLUG,
			"--store",
			STORE,
			"--reward",
			"free-drink",
			"--file",
			`${CODE}.csv`,
		]);
		expect(imported.code).toBe(2);
		expect(imported.text).toContain("not in CI");
		expectNoIdentifiers(imported.text);
		const exported = await fnb([
			"loyalty",
			"codes",
			"export",
			"--tenant",
			SLUG,
			"--state",
			"used",
			"--out",
			`${CODE}.csv`,
		]);
		expect(exported.code).toBe(2);
		expect(exported.text).toContain("not in CI");
		expectNoIdentifiers(exported.text);
	});

	it("fnb zalo oa-menu apply --dry-run", async () => {
		const ran = await runWithFakes(
			["zalo", "oa-menu", "apply", "--tenant", SLUG, "--dry-run"],
			true,
		);
		expect(ran.code).toBe(0);
		expect(ran.text).toContain("dry run");
		expectNoIdentifiers(ran.text);
	});
});
