import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { customerDemoPaths } from "../../src/local-dev/customer.js";
import { customerDemoEnvironment } from "../../src/local-dev/environment.js";
import { localLoopPaths } from "../../src/local-dev/loop.js";
import {
	CUSTOMER_LOOP_PORT,
	LocalLoopError,
	parseLocalLoopArgs,
} from "../../src/local-dev/options.js";
import { isSeedableTenant, syntheticBrand } from "../../src/local-dev/seed.js";

const KEY = "k".repeat(43);

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof LocalLoopError) return error.message;
		throw error;
	}
	throw new Error("expected a refusal");
}

describe("the customer app in pnpm zalo:dev", () => {
	it("runs the demo on its own port by default, or live against the local stack", () => {
		expect(parseLocalLoopArgs(["--app", "customer"])).toMatchObject({
			app: "customer",
			live: false,
			port: CUSTOMER_LOOP_PORT,
			exposure: "loopback",
		});
		expect(
			parseLocalLoopArgs(["--app", "customer", "--live", "--tunnel"]),
		).toMatchObject({ app: "customer", live: true, exposure: "tunnel" });
		expect(
			parseLocalLoopArgs(["--app", "customer", "--lan", "--port", "5766"]),
		).toMatchObject({ port: 5766, exposure: "lan" });
		expect(parseLocalLoopArgs(["--app", "staff"])).not.toHaveProperty("app");
		expect(parseLocalLoopArgs([])).not.toHaveProperty("live");
	});

	it("refuses an unknown app, --live for the staff app and a member for the customer app", () => {
		expect(refusal(() => parseLocalLoopArgs(["--app", "shop"]))).toBe(
			"--app must be staff or customer",
		);
		expect(refusal(() => parseLocalLoopArgs(["--live"]))).toContain(
			"add --app customer",
		);
		expect(
			refusal(() =>
				parseLocalLoopArgs([
					"--app",
					"customer",
					"--member",
					"owner@example.com",
				]),
			),
		).toContain("--member is for the staff app");
	});

	it("starts the demo dev server in browser mode with the stand-in session and only the access variables", () => {
		const outside = {
			PATH: "/usr/bin",
			FNB_MEMBER_EMAIL: "owner@example.com",
			SUPABASE_SECRET_KEY: "sb_secret_synthetic",
			VITE_SUPABASE_URL: "https://project.example.com",
		};
		expect(
			customerDemoEnvironment(outside, { brand: "brand-2", access: null }),
		).toEqual({
			PATH: "/usr/bin",
			VITE_ZALO_RUNTIME: "browser",
			VITE_ZALO_SESSION: "stand-in",
			VITE_BRAND_KEY: "brand-2",
		});
		expect(
			customerDemoEnvironment(outside, {
				brand: "brand-1",
				access: { key: KEY, tunnelHost: "sample-words.trycloudflare.com" },
			}),
		).toMatchObject({
			ZALO_LOCAL_ACCESS_KEY: KEY,
			ZALO_LOCAL_TUNNEL_HOST: "sample-words.trycloudflare.com",
		});
	});

	it("knows where the customer app lives", () => {
		const root = join("repo");
		expect(customerDemoPaths(root).customerDir).toBe(
			join("repo", "apps", "zalo-customer"),
		);
		expect(localLoopPaths(root).customerDir).toBe(
			join("repo", "apps", "zalo-customer"),
		);
	});
});

describe("the synthetic brand of the customer trial", () => {
	it("targets loyalty-sim for --live and seeds only synthetic tenants", () => {
		expect(parseLocalLoopArgs(["--app", "customer", "--live"])).toMatchObject({
			tenant: "loyalty-sim",
		});
		expect(parseLocalLoopArgs(["--app", "customer"])).toMatchObject({
			tenant: "live-local",
		});
		expect(
			parseLocalLoopArgs([
				"--app",
				"customer",
				"--live",
				"--tenant",
				"zalo-it-a",
			]),
		).toMatchObject({ tenant: "zalo-it-a" });
		expect(isSeedableTenant("loyalty-sim")).toBe(true);
		expect(isSeedableTenant("zalo-it-fixture-1")).toBe(true);
		expect(isSeedableTenant("live-local")).toBe(false);
		expect(isSeedableTenant("demo-fnb")).toBe(false);
	});

	it("uses mock Zalo ids, secret names the database accepts and valid Mini App titles", () => {
		const brand = syntheticBrand("loyalty-sim", "brand-1");
		expect(brand).toMatchObject({
			appId: "mock-sim-app-1",
			appSecretName: "ZALO_APP_SECRET_BRAND_1",
			oaId: "mock-sim-oa-1",
			oaSecretName: "ZALO_OA_SECRET_BRAND_1",
		});
		for (const id of [
			brand.appId,
			brand.oaId,
			...brand.miniApps.map((app) => app.externalId),
		]) {
			expect(id).toMatch(/^mock-[A-Za-z0-9_-]{1,59}$/);
		}
		expect(brand.miniApps.map((app) => [app.kind, app.title])).toEqual([
			["staff", "Nhân viên Quán Mẫu 1"],
			["customer", "Thành viên Quán Mẫu 1"],
		]);
		expect(syntheticBrand("zalo-it-x", "brand-12").appId).toBe(
			"mock-it-x-app-12",
		);
	});
});
