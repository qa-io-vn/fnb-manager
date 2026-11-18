import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	type BrandOverview,
	configFromFlags,
	miniAppTitleValid,
	parseBrandConfig,
	parseBrandFile,
	secretNameValid,
	showLines,
} from "../../src/commands/zalo-config.js";
import { resolveStoreIds } from "../../src/commands/zalo-queries.js";
import { UsageError } from "../../src/context.js";
import { capture } from "../support/capture.js";

const MINI_STAFF = {
	kind: "staff",
	id: "synthetic-mini-staff",
	title: "Quán Mẫu Nội Bộ",
	header_title_vi: "Nội bộ",
	header_title_en: "Staff",
	header_color_light: "#1f6f4a",
	header_color_dark: "#0E2A1F",
	text_color_light: "white",
	text_color_dark: "white",
};

const FILE_CONFIG = {
	brand: "brand-1",
	name: "Quán Mẫu Một",
	stores: ["store-1", "store-2"],
	zalo_app: { id: "synthetic-app-1", secret_name: "ZALO_APP_SECRET_BRAND_1" },
	oa: {
		id: "synthetic-oa-1",
		secret_name: "ZALO_OA_SECRET_BRAND_1",
		package_tier: "tang_truong",
		package_expires_on: "2027-06-30",
		verified: true,
	},
	mini_apps: [MINI_STAFF],
};

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

describe("fnb zalo config parsing", () => {
	it("reads a brand file with defaults for status, webhook mode and colours", () => {
		const config = parseBrandFile(JSON.stringify(FILE_CONFIG));
		expect(config).toEqual({
			brand: "brand-1",
			name: "Quán Mẫu Một",
			stores: ["store-1", "store-2"],
			zaloApp: {
				id: "synthetic-app-1",
				secretName: "ZALO_APP_SECRET_BRAND_1",
				status: "active",
			},
			oa: {
				id: "synthetic-oa-1",
				secretName: "ZALO_OA_SECRET_BRAND_1",
				packageTier: "tang_truong",
				packageExpiresOn: "2027-06-30",
				verified: true,
				webhookMode: "observe",
			},
			miniApps: [
				{
					kind: "staff",
					id: "synthetic-mini-staff",
					title: "Quán Mẫu Nội Bộ",
					headerTitleVi: "Nội bộ",
					headerTitleEn: "Staff",
					headerColorLight: "#1F6F4A",
					headerColorDark: "#0E2A1F",
					textColorLight: "white",
					textColorDark: "white",
				},
			],
		});
	});

	it("reads the same brand from flags, without an OA when no OA flag is given", () => {
		const config = configFromFlags({
			brand: "brand-2",
			name: "Quán Mẫu Hai",
			stores: ["store-3"],
			appId: "synthetic-app-2",
			appSecretName: "ZALO_APP_SECRET_BRAND_2",
			appStatus: "disabled",
			oaId: undefined,
			oaSecretName: undefined,
			oaTier: undefined,
			oaExpiresOn: undefined,
			oaVerified: false,
			webhookMode: undefined,
		});
		expect(config.zaloApp.status).toBe("disabled");
		expect(config.oa).toBeNull();
		expect(config.miniApps).toEqual([]);
	});

	it("refuses a value where a secret name is expected", () => {
		for (const value of [
			"ZALO_APP_SECRET_aW52YWxpZC1zZWNyZXQtdmFsdWU",
			"ZALO_APP_SECRET_6F1C0A9B2D7E4F3A",
			"ZALO_APP_SECRET_1234567890",
			"ZALO_OA_SECRET_BRAND_1",
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
			"https://example.com/secret",
			"ZALO_APP_SECRET_",
		]) {
			expect(secretNameValid(value, "ZALO_APP_SECRET_")).toBe(false);
		}
		expect(secretNameValid("ZALO_APP_SECRET_BRAND_1", "ZALO_APP_SECRET_")).toBe(
			true,
		);
		expect(
			secretNameValid("ZALO_OA_SECRET_IT_BRAND_17", "ZALO_OA_SECRET_"),
		).toBe(true);
		const message = refusal(() =>
			parseBrandConfig({
				...FILE_CONFIG,
				zalo_app: {
					id: "synthetic-app-1",
					secret_name: "0123456789abcdef0123456789abcdef",
				},
			}),
		);
		expect(message).toContain(
			"zalo_app.secret_name must name a function secret",
		);
		expect(message).not.toContain("0123456789abcdef0123456789abcdef");
	});

	it("applies Zalo's naming rules to Mini App titles", () => {
		expect(miniAppTitleValid("Quán Mẫu Nội Bộ")).toBe(true);
		expect(miniAppTitleValid("Happy Tea")).toBe(true);
		for (const title of [
			"Quán Mẫu Zalo",
			"Quán Mẫu App",
			"Quán Mẫu Mini App",
			"QuánApp",
			"Trà apps",
			"QUÁN MẪU",
			"Qu",
			"Q".repeat(51),
			" Quán Mẫu",
		]) {
			expect(miniAppTitleValid(title), title).toBe(false);
		}
		expect(
			refusal(() =>
				parseBrandConfig({
					...FILE_CONFIG,
					mini_apps: [{ ...MINI_STAFF, title: "Quán Mẫu App" }],
				}),
			),
		).toContain("breaks Zalo's naming rules");
	});

	it("lists every problem of a refused configuration", () => {
		const message = refusal(() =>
			parseBrandConfig({
				brand: "Brand One",
				name: "",
				stores: [],
				zalo_app: { id: "has spaces", secret_name: "ZALO_APP_SECRET_BRAND_1" },
				oa: {
					id: "synthetic-oa",
					secret_name: "ZALO_OA_SECRET_BRAND_1",
					package_tier: "vip",
					package_expires_on: "2027-02-30",
					webhook_mode: "strict",
				},
				mini_apps: [MINI_STAFF, { ...MINI_STAFF, header_color_dark: "black" }],
			}),
		);
		for (const part of [
			"brand must be a neutral key",
			"name is required",
			"stores must list 1 to 50",
			"zalo_app.id must be a Zalo id",
			"oa.package_tier must be one of",
			"oa.package_expires_on must be a date",
			"oa.webhook_mode must be one of",
			"mini_apps[1].header_color_dark must be a colour",
			"one staff and one customer Mini App at most",
		]) {
			expect(message).toContain(part);
		}
	});

	it("refuses a file that is not JSON", () => {
		expect(refusal(() => parseBrandFile("{"))).toBe(
			"the brand configuration file is not JSON",
		);
	});

	it("matches stores by external id or id and refuses unknown or shared ones by count", () => {
		const stores = [
			{ id: "bbbbbbbb-0000-4000-8000-000000000002", external_id: "store-2" },
			{ id: "aaaaaaaa-0000-4000-8000-000000000001", external_id: "store-1" },
			{ id: "cccccccc-0000-4000-8000-000000000003", external_id: "store-1" },
		];
		expect(
			resolveStoreIds(stores, [
				"store-2",
				"aaaaaaaa-0000-4000-8000-000000000001",
			]),
		).toEqual([
			"aaaaaaaa-0000-4000-8000-000000000001",
			"bbbbbbbb-0000-4000-8000-000000000002",
		]);
		expect(refusal(() => resolveStoreIds(stores, ["store-9", "store-8"]))).toBe(
			"2 store value(s) are not stores of this tenant",
		);
		expect(refusal(() => resolveStoreIds(stores, ["store-1"]))).toContain(
			"match stores of several POS accounts",
		);
	});
});

describe("fnb zalo config show", () => {
	const brands: BrandOverview[] = [
		{
			brand: "brand-1",
			name: "Quán Mẫu Một",
			storeCount: 2,
			appId: "synthetic-app-1",
			appSecretName: "ZALO_APP_SECRET_BRAND_1",
			appStatus: "active",
			oaId: "synthetic-oa-1",
			oaSecretName: "ZALO_OA_SECRET_BRAND_1",
			oaTier: "tang_truong",
			oaExpiresOn: "2027-06-30",
			oaVerified: true,
			webhookMode: "observe",
			miniApps: [
				{ kind: "staff", id: "synthetic-mini-staff", title: "Quán Mẫu Nội Bộ" },
				{
					kind: "customer",
					id: "synthetic-mini-customer",
					title: "Quán Mẫu Thành Viên",
				},
			],
			identities: 1,
		},
		{
			brand: "brand-2",
			name: "Quán Mẫu Hai",
			storeCount: 1,
			appId: "synthetic-app-2",
			appSecretName: "ZALO_APP_SECRET_BRAND_2",
			appStatus: "disabled",
			oaId: null,
			oaSecretName: null,
			oaTier: null,
			oaExpiresOn: null,
			oaVerified: null,
			webhookMode: null,
			miniApps: [],
			identities: 0,
		},
	];

	it("prints numbered brands and states only with CI set", () => {
		const lines = showLines(brands, true);
		expect(lines).toEqual([
			"brand 1: 2 stores; Zalo App active; OA tang_truong, verified, webhook observe, package until 2027-06-30; Mini Apps staff and customer; 1 bound identities",
			"brand 2: 1 stores; Zalo App disabled; no OA; Mini Apps none; 0 bound identities",
		]);
		const text = lines.join("\n");
		for (const hidden of ["synthetic-", "ZALO_", "Quán Mẫu", "brand-1"]) {
			expect(text).not.toContain(hidden);
		}
	});

	it("prints the ids, secret names and titles on the owner's machine", () => {
		const text = showLines(brands, false).join("\n");
		for (const shown of [
			"brand-1 (Quán Mẫu Một)",
			"Zalo App synthetic-app-1, secret ZALO_APP_SECRET_BRAND_1",
			"OA synthetic-oa-1, secret ZALO_OA_SECRET_BRAND_1",
			"staff Mini App synthetic-mini-staff: Quán Mẫu Nội Bộ",
			"brand-2 (Quán Mẫu Hai)",
		]) {
			expect(text).toContain(shown);
		}
	});

	it("says when no brand is configured", () => {
		expect(showLines([], true)).toEqual([
			"no brand is configured; add one with fnb zalo config set",
		]);
	});
});

describe("fnb zalo commands without a database", () => {
	it("refuses --file together with brand flags", async () => {
		const out = capture();
		const code = await runCli(
			[
				"zalo",
				"config",
				"set",
				"--tenant",
				"zalo-it-unit",
				"--file",
				"brand.json",
				"--name",
				"x",
			],
			{},
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(2);
		expect(out.stderr()).toContain("pass either --file or the brand flags");
	});

	it("refuses a brand file inside the repository", async () => {
		const out = capture();
		const code = await runCli(
			[
				"zalo",
				"config",
				"set",
				"--tenant",
				"zalo-it-unit",
				"--file",
				"package.json",
			],
			{},
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(2);
		expect(out.stderr()).toContain(
			"--file must be kept outside the repository or below docs/private/",
		);
	});

	it("refuses a brand file with a secret value before connecting", async () => {
		const directory = mkdtempSync(join(tmpdir(), "zalo-config-"));
		const path = join(directory, "brand.json");
		writeFileSync(
			path,
			JSON.stringify({
				...FILE_CONFIG,
				oa: {
					...FILE_CONFIG.oa,
					secret_name: "ZALO_OA_SECRET_9f8e7d6c5b4a39281706f5e4",
				},
			}),
		);
		const out = capture();
		const code = await runCli(
			["zalo", "config", "set", "--tenant", "zalo-it-unit", "--file", path],
			{},
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(2);
		expect(out.stderr()).toContain(
			"oa.secret_name must name a function secret",
		);
		expect(out.stderr()).not.toContain("9f8e7d6c5b4a39281706f5e4");
	});

	it("refuses to print a binding code in CI", async () => {
		const out = capture();
		const code = await runCli(
			[
				"zalo",
				"bind",
				"--tenant",
				"zalo-it-unit",
				"--member",
				"owner@example.com",
				"--brand",
				"brand-1",
			],
			{ CI: "true" },
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(2);
		expect(out.stderr()).toContain("run it on the owner's machine, not in CI");
	});

	it("lists the zalo commands under fnb zalo", async () => {
		const out = capture();
		const code = await runCli(
			["zalo", "--help"],
			{},
			{ streams: out.streams, loadEnvFile: false },
		);
		expect(code).toBe(0);
		expect(out.stdout()).toContain("fnb zalo config set --tenant <slug>");
		expect(out.stdout()).toContain("fnb zalo config show --tenant <slug>");
		expect(out.stdout()).toContain("fnb zalo bind --tenant <slug>");
	});
});
