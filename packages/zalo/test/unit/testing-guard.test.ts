import { describe, expect, it } from "vitest";
import { requireBrandApp } from "../../src/session.js";
import {
	ZALO_GRAPH_BASE_URL_VARIABLE,
	ZaloConfigError,
	zaloSettings,
} from "../../src/settings.js";
import {
	assertSyntheticZaloEnvironment,
	SyntheticEnvironmentError,
	zaloIntegrationGate,
} from "../../src/testing/environment.js";
import { createFakeBackend } from "../../src/testing/fake-backend.js";

const FIXTURE_TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

function refusalOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(ZaloConfigError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

describe("the ZALO_INTEGRATION gate", () => {
	it("runs against the real graph with no variable set", () => {
		expect(zaloSettings({})).toEqual({
			integration: false,
			local: false,
			tenantId: null,
			graphBaseUrl: "https://graph.zalo.me",
		});
	});

	it("needs a tenant filter before it touches a database", () => {
		expect(refusalOf(() => zaloSettings({ ZALO_INTEGRATION: "1" }))).toContain(
			"needs ZALO_TENANT_ID",
		);
		expect(
			zaloSettings({
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: FIXTURE_TENANT.toUpperCase(),
				ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
			}),
		).toEqual({
			integration: true,
			local: false,
			tenantId: FIXTURE_TENANT,
			graphBaseUrl: "http://127.0.0.1:8788",
		});
	});

	it("accepts a graph override only on a loopback address and only with the gate", () => {
		expect(
			refusalOf(() =>
				zaloSettings({ ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788" }),
			),
		).toContain("only with ZALO_INTEGRATION=1, or with ZALO_LOCAL_DEV=1");
		for (const address of [
			"https://graph.example.test",
			"http://10.0.0.5:8788",
			"http://127.0.0.1:8788/path",
			"http://user@127.0.0.1:8788",
		]) {
			expect(
				refusalOf(() =>
					zaloSettings({
						ZALO_INTEGRATION: "1",
						ZALO_TENANT_ID: FIXTURE_TENANT,
						[ZALO_GRAPH_BASE_URL_VARIABLE]: address,
					}),
				),
			).toContain("loopback");
		}
	});

	it("refuses unknown gate values and malformed tenant ids without echoing them", () => {
		expect(refusalOf(() => zaloSettings({ ZALO_INTEGRATION: "yes" }))).toBe(
			"ZALO_INTEGRATION must be 1, 0 or unset",
		);
		const message = refusalOf(() =>
			zaloSettings({ ZALO_TENANT_ID: "live-tenant-slug" }),
		);
		expect(message).not.toContain("live-tenant-slug");
	});

	it("serves only zalo-it- fixture tenants while the gate is on", async () => {
		const backend = createFakeBackend();
		backend.addApp({
			brandKey: "brand-1",
			tenantId: OTHER_TENANT,
			tenantSlug: "live-local",
			zaloAppId: "app-live",
			secretName: "ZALO_APP_SECRET_BRAND_1",
			status: "active",
		});
		const settings = zaloSettings({
			ZALO_INTEGRATION: "1",
			ZALO_TENANT_ID: OTHER_TENANT,
		});
		await expect(
			requireBrandApp(backend, settings, "brand-1"),
		).rejects.toMatchObject({ status: 500, code: "not_configured" });
		backend.addApp({
			brandKey: "brand-2",
			tenantId: FIXTURE_TENANT,
			tenantSlug: "zalo-it-0a1b2c3d",
			zaloAppId: "app-fixture",
			secretName: "ZALO_APP_SECRET_IT_2",
			status: "active",
		});
		await expect(
			requireBrandApp(
				backend,
				zaloSettings({ ZALO_INTEGRATION: "1", ZALO_TENANT_ID: FIXTURE_TENANT }),
				"brand-2",
			),
		).resolves.toMatchObject({ zaloAppId: "app-fixture" });
	});

	it("is enabled only with every variable the suites need", () => {
		const full = {
			ZALO_INTEGRATION: "1",
			DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
			SUPABASE_URL: "http://127.0.0.1:54321",
			SUPABASE_SECRET_KEY: "sb_secret_synthetic",
			SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
		};
		expect(zaloIntegrationGate(full).enabled).toBe(true);
		expect(
			zaloIntegrationGate({ ...full, ZALO_INTEGRATION: "0" }).enabled,
		).toBe(false);
		expect(
			zaloIntegrationGate({ ...full, DATABASE_URL: undefined }).enabled,
		).toBe(false);
	});
});

describe("the synthetic-environment guard", () => {
	it("lets through the gate variables and synthetic _IT secrets", () => {
		expect(() =>
			assertSyntheticZaloEnvironment({
				DATABASE_URL: "postgresql://127.0.0.1:54322/postgres",
				SUPABASE_URL: "http://127.0.0.1:54321",
				SUPABASE_SECRET_KEYS: "{}",
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: FIXTURE_TENANT,
				ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
				ZALO_APP_SECRET_IT_BRAND_7: "synthetic-app-secret",
			}),
		).not.toThrow();
	});

	it("refuses real secret names, real-looking values and anything else", () => {
		for (const environment of [
			{ ZALO_APP_SECRET_BRAND_1: "synthetic-app-secret" },
			{ ZALO_APP_SECRET_IT_BRAND_1: "a-real-looking-secret" },
			{ POS_ACCOUNTS_JSON: "[]" },
			{ IPOS_REAL_API: "on" },
		]) {
			expect(() => assertSyntheticZaloEnvironment(environment)).toThrow(
				SyntheticEnvironmentError,
			);
		}
	});
});
