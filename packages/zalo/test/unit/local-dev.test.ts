import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { staffAppConfig } from "../../src/local-dev/app-config.js";
import {
	forgetProblems,
	type LoopTarget,
	startProblems,
} from "../../src/local-dev/database.js";
import {
	findRepositoryRoot,
	localStackFrom,
	sessionFunctionEnvironment,
	staffAppEnvironment,
	withRepositoryEnv,
} from "../../src/local-dev/environment.js";
import {
	LOCAL_PHONE_NUMBER,
	LOCAL_PHONE_TOKEN,
	localLoopPaths,
} from "../../src/local-dev/loop.js";
import {
	isMockId,
	LOCAL_LOOP_DEFAULTS,
	LocalLoopError,
	parseLocalLoopArgs,
} from "../../src/local-dev/options.js";
import { zaloSettings } from "../../src/settings.js";

const TENANT = "44444444-4444-4444-8444-444444444444";
const STACK_ENV = {
	SUPABASE_URL: "http://127.0.0.1:54321",
	DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
	SUPABASE_SECRET_KEY: "sb_secret_synthetic",
	SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
};
const OUTSIDE_ENV = {
	PATH: "/usr/bin",
	FNB_MEMBER_EMAIL: "owner@example.com",
	FNB_MEMBER_PASSWORD: "synthetic-password",
	POS_ACCOUNTS_JSON: "[]",
	IPOS_APP_KEY: "synthetic-ipos-key",
	VITE_SUPABASE_URL: "https://project.example.com",
	ZALO_INTEGRATION: "1",
};

function target(overrides: Partial<LoopTarget> = {}): LoopTarget {
	return {
		tenantId: TENANT,
		tenantSlug: "live-local",
		brand: "brand-1",
		brandId: "55555555-5555-4555-8555-555555555555",
		storeCount: 1,
		zaloAppId: "66666666-6666-4666-8666-666666666666",
		zaloAppExternalId: "mock-app-1",
		secretName: "ZALO_APP_SECRET_BRAND_1",
		appStatus: "active",
		oaExternalId: "mock-oa-1",
		miniAppExternalIds: ["mock-mini-customer-1", "mock-mini-staff-1"],
		staffMiniApp: null,
		...overrides,
	};
}

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(LocalLoopError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

describe("pnpm zalo:dev options", () => {
	it("default to brand-1 of live-local and the member in FNB_MEMBER_EMAIL", () => {
		expect(parseLocalLoopArgs([])).toEqual({
			command: "start",
			tenant: "live-local",
			brand: "brand-1",
			member: null,
			mockUser: "mock-user-1",
			mockName: LOCAL_LOOP_DEFAULTS.mockName,
			port: 5741,
			exposure: "loopback",
			host: null,
			tunnelHours: 4,
		});
		expect(parseLocalLoopArgs(["--help"])).toBe("help");
	});

	it("take any tenant, brand, member, mock user and port, and the forget command", () => {
		expect(
			parseLocalLoopArgs([
				"--",
				"forget",
				"--tenant",
				"shop-two",
				"--brand",
				"brand-12",
				"--member",
				" staff@example.com ",
				"--mock-user",
				"mock-user-2",
				"--mock-name",
				"Nhân viên thử",
				"--port",
				"5761",
			]),
		).toEqual({
			command: "forget",
			tenant: "shop-two",
			brand: "brand-12",
			member: "staff@example.com",
			mockUser: "mock-user-2",
			mockName: "Nhân viên thử",
			port: 5761,
			exposure: "loopback",
			host: null,
			tunnelHours: 4,
		});
	});

	it("refuse a brand name, a real-looking Zalo user, a low port and unknown commands", () => {
		expect(refusal(() => parseLocalLoopArgs(["--brand", "Shop"]))).toContain(
			"neutral key",
		);
		expect(
			refusal(() => parseLocalLoopArgs(["--mock-user", "8800000000000000001"])),
		).toContain("starts with mock-");
		expect(refusal(() => parseLocalLoopArgs(["--port", "80"]))).toContain(
			"1024 to 65535",
		);
		expect(refusal(() => parseLocalLoopArgs(["deploy"]))).toContain(
			"unknown command",
		);
		expect(refusal(() => parseLocalLoopArgs(["--unknown"]))).toContain(
			"--unknown",
		);
		expect(
			refusal(() => parseLocalLoopArgs(["--mock-name", "a\u0007b"])),
		).toContain("control characters");
	});

	it("mark mock ids by their prefix", () => {
		expect(isMockId("mock-app-1")).toBe(true);
		expect(isMockId("mock-")).toBe(false);
		expect(isMockId("1234567890123456789")).toBe(false);
	});
});

describe("the local stack", () => {
	const root = mkdtempSync(join(tmpdir(), "fnb-zalo-local-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("is read from .env with the process environment winning", () => {
		writeFileSync(
			join(root, ".env"),
			'SUPABASE_URL=http://127.0.0.1:54321\nDATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\nTZ=UTC\n',
		);
		const merged = withRepositoryEnv(root, {
			TZ: "Asia/Ho_Chi_Minh",
			PATH: "",
		});
		expect(merged.SUPABASE_URL).toBe("http://127.0.0.1:54321");
		expect(merged.DATABASE_URL).toBe(
			"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
		);
		expect(merged.TZ).toBe("Asia/Ho_Chi_Minh");
		expect(merged.PATH).toBeUndefined();
	});

	it("must be complete and on loopback addresses, and refusals name no value", () => {
		expect(localStackFrom(STACK_ENV)).toEqual({
			supabaseUrl: "http://127.0.0.1:54321",
			databaseUrl: STACK_ENV.DATABASE_URL,
			secretKey: "sb_secret_synthetic",
			publishableKey: "sb_publishable_synthetic",
		});
		expect(
			refusal(() =>
				localStackFrom({ ...STACK_ENV, SUPABASE_SECRET_KEY: undefined }),
			),
		).toContain("needs SUPABASE_SECRET_KEY");
		const remote = refusal(() =>
			localStackFrom({
				...STACK_ENV,
				SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
			}),
		);
		expect(remote).toContain("SUPABASE_URL is not the local stack");
		expect(remote).not.toContain("supabase.co");
		expect(
			refusal(() =>
				localStackFrom({
					...STACK_ENV,
					DATABASE_URL:
						"postgresql://db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
				}),
			),
		).toBe(
			"DATABASE_URL is not the local stack: the local loop runs only against a database on 127.0.0.1",
		);
	});
});

describe("the local zalo-session's environment", () => {
	const stack = localStackFrom(STACK_ENV);
	const environment = sessionFunctionEnvironment(OUTSIDE_ENV, {
		stack,
		tenantId: TENANT,
		graphBaseUrl: "http://127.0.0.1:40123",
		secretName: "ZALO_APP_SECRET_BRAND_1",
		appSecret: "local-synthetic-secret",
		port: 40124,
	});

	it("meets the ZALO_LOCAL_DEV gate with the mock graph and the tenant", () => {
		expect(zaloSettings(environment)).toEqual({
			integration: false,
			local: true,
			tenantId: TENANT,
			graphBaseUrl: "http://127.0.0.1:40123",
		});
		expect(environment).toMatchObject({
			DENO_SERVE_ADDRESS: "tcp:127.0.0.1:40124",
			SUPABASE_URL: "http://127.0.0.1:54321",
			SUPABASE_DB_URL: STACK_ENV.DATABASE_URL,
			SUPABASE_SECRET_KEYS: '{"default":"sb_secret_synthetic"}',
			ZALO_APP_SECRET_BRAND_1: "local-synthetic-secret",
		});
	});

	it("carries nothing else from the developer's environment", () => {
		expect(Object.keys(environment).sort()).toEqual(
			[
				"DENO_SERVE_ADDRESS",
				"NO_COLOR",
				"PATH",
				"SUPABASE_DB_URL",
				"SUPABASE_SECRET_KEYS",
				"SUPABASE_URL",
				"ZALO_APP_SECRET_BRAND_1",
				"ZALO_GRAPH_BASE_URL",
				"ZALO_LOCAL_DEV",
				"ZALO_TENANT_ID",
			].sort(),
		);
	});

	it("gives the staff app the local session, the local zalo-phone and only the publishable key", () => {
		const app = staffAppEnvironment(OUTSIDE_ENV, {
			brand: "brand-1",
			publishableKey: stack.publishableKey,
			functionUrl: "http://127.0.0.1:40124",
			phoneFunctionUrl: "http://127.0.0.1:40125",
			accessToken: "mock-zalo-access-synthetic",
			appConfigPath: null,
			access: null,
		});
		expect(app).toEqual({
			PATH: "/usr/bin",
			VITE_ZALO_RUNTIME: "browser",
			VITE_ZALO_SESSION: "local",
			VITE_BRAND_KEY: "brand-1",
			VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
			ZALO_LOCAL_SESSION_URL: "http://127.0.0.1:40124",
			ZALO_LOCAL_PHONE_URL: "http://127.0.0.1:40125",
			ZALO_LOCAL_ACCESS_TOKEN: "mock-zalo-access-synthetic",
		});
	});

	it("runs the unmodified zalo-phone next to zalo-session", () => {
		const paths = localLoopPaths(findRepositoryRoot());
		expect(paths.phoneFunctionDir).toBe(
			join(paths.rootDir, "supabase", "functions", "zalo-phone"),
		);
		expect(
			readFileSync(join(paths.phoneFunctionDir, "index.ts"), "utf8"),
		).toContain("handleZaloPhone");
	});

	it("answers the phone token of the browser mock SDK with a synthetic number", () => {
		const mockSdk = readFileSync(
			join(
				findRepositoryRoot(),
				"packages",
				"zalo-mini",
				"src",
				"testing",
				"mock-sdk.ts",
			),
			"utf8",
		);
		expect(mockSdk).toContain(
			`export const MOCK_PHONE_TOKEN = "${LOCAL_PHONE_TOKEN}";`,
		);
		expect(LOCAL_PHONE_NUMBER).toMatch(/^84900000[0-9]{3}$/);
	});
});

describe("the brands the local loop serves and forgets", () => {
	it("starts only on an active mock Zalo App", () => {
		expect(startProblems(target())).toEqual([]);
		expect(
			startProblems(
				target({ zaloAppExternalId: "1234567890", appStatus: "disabled" }),
			),
		).toEqual([
			"brand-1's Zalo App is not a mock app (mock-…); the local loop binds mock Zalo users to mock apps only",
			"brand-1's Zalo App is disabled",
		]);
	});

	it("forgets a brand only while every id, identity and dependent row is mock", () => {
		const clean = {
			identities: ["mock-user-1"],
			dependentRows: 0,
			foreignTables: [],
		};
		expect(forgetProblems(target(), clean)).toEqual([]);
		expect(
			forgetProblems(
				target({
					oaExternalId: "4321",
					miniAppExternalIds: ["mock-mini-staff-1", "9876"],
				}),
				{
					identities: ["mock-user-1", "8800000000000000001"],
					dependentRows: 2,
					foreignTables: ["staff_roster"],
				},
			),
		).toEqual([
			"2 of brand-1's Zalo ids are not mock ids (mock-…); forget removes mock configuration only",
			"1 bound identities are not mock Zalo users; forget removes mock identities only",
			"2 token, template, group or OA event rows hang off brand-1",
			"staff_roster refer to the Zalo configuration tables; remove the brand by hand",
		]);
	});
});

describe("the staff app-config of the local loop", () => {
	it("has the shape of a generated app-config.json", () => {
		expect(
			staffAppConfig({
				title: "Nhân viên Quán Mẫu Một",
				header_title_vi: "Quán Mẫu Một",
				header_title_en: "Sample Shop One",
				header_color_light: "#0a6b56",
				header_color_dark: "#17161A",
				text_color_light: "white",
				text_color_dark: "white",
			}),
		).toEqual({
			app: {
				title: "Nhân viên Quán Mẫu Một",
				headerTitle: { vi: "Quán Mẫu Một", en: "Sample Shop One" },
				headerColor: { light: "#0A6B56", dark: "#17161A" },
				textColor: { light: "white", dark: "white" },
				statusBarType: "normal",
				hideIOSSafeAreaBottom: false,
				hideAndroidBottomNavigationBar: false,
			},
			listCSS: [],
			listSyncJS: [],
			listAsyncJS: [],
		});
	});
});
