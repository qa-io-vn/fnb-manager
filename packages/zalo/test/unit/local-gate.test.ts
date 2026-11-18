import { describe, expect, it } from "vitest";
import { requireBrandApp } from "../../src/session.js";
import {
	isLoopbackDatabaseUrl,
	ZaloConfigError,
	type ZaloEnvironment,
	zaloSettings,
} from "../../src/settings.js";
import { createFakeBackend } from "../../src/testing/fake-backend.js";

const LOCAL_TENANT = "33333333-3333-4333-8333-333333333333";
const LOCAL_STACK: ZaloEnvironment = {
	ZALO_LOCAL_DEV: "1",
	ZALO_TENANT_ID: LOCAL_TENANT,
	ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};
const DEPLOYED_SUPABASE_URLS = [
	"https://abcdefghijklmnopqrst.supabase.co",
	"http://kong:8000",
	"http://10.0.0.5:54321",
	"http://127.0.0.1:54321/rest/v1",
	"https://127.0.0.1:54321",
];
const DEPLOYED_DATABASE_URLS = [
	"postgresql://db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
	"postgresql://postgres:postgres@db:5432/postgres",
	"postgresql://postgres@127.0.0.1:54322/postgres?host=db.example.test",
	"postgresql://postgres@localhost/postgres?hostaddr=10.0.0.5",
	"mysql://root@127.0.0.1:3306/postgres",
	"127.0.0.1:54322",
];

function refusalOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(ZaloConfigError);
		return (error as Error).message;
	}
	throw new Error("nothing was refused");
}

describe("the ZALO_LOCAL_DEV switch", () => {
	it("lets a function on the local stack use the loopback graph for its tenant", () => {
		expect(zaloSettings(LOCAL_STACK)).toEqual({
			integration: false,
			local: true,
			tenantId: LOCAL_TENANT,
			graphBaseUrl: "http://127.0.0.1:8788",
		});
		expect(
			zaloSettings({
				...LOCAL_STACK,
				SUPABASE_URL: "http://localhost:54321",
				SUPABASE_DB_URL:
					"postgres://postgres:postgres@localhost:54322/postgres",
			}).local,
		).toBe(true);
	});

	it("refuses the graph override on a non-loopback Supabase URL even with the switch", () => {
		for (const url of DEPLOYED_SUPABASE_URLS) {
			expect(
				refusalOf(() => zaloSettings({ ...LOCAL_STACK, SUPABASE_URL: url })),
			).toBe(
				"ZALO_LOCAL_DEV=1 runs only on the local stack: SUPABASE_URL must be a loopback address such as http://127.0.0.1:54321",
			);
		}
		expect(
			refusalOf(() =>
				zaloSettings({ ...LOCAL_STACK, SUPABASE_URL: undefined }),
			),
		).toContain("SUPABASE_URL must be a loopback address");
	});

	it("refuses it when the function's database is not on the local machine", () => {
		for (const url of [...DEPLOYED_DATABASE_URLS, ""]) {
			const message = refusalOf(() =>
				zaloSettings({ ...LOCAL_STACK, SUPABASE_DB_URL: url }),
			);
			expect(message).toBe(
				"ZALO_LOCAL_DEV=1 runs only on the local stack: SUPABASE_DB_URL must name a database on 127.0.0.1 or localhost",
			);
			expect(message).not.toContain("supabase.co");
		}
	});

	it("needs the tenant it serves and excludes the integration gate", () => {
		expect(
			refusalOf(() =>
				zaloSettings({ ...LOCAL_STACK, ZALO_TENANT_ID: undefined }),
			),
		).toBe(
			"ZALO_LOCAL_DEV=1 needs ZALO_TENANT_ID, the id of the local tenant it serves",
		);
		expect(
			refusalOf(() => zaloSettings({ ...LOCAL_STACK, ZALO_INTEGRATION: "1" })),
		).toBe("ZALO_INTEGRATION=1 and ZALO_LOCAL_DEV=1 exclude each other");
		expect(
			refusalOf(() => zaloSettings({ ...LOCAL_STACK, ZALO_LOCAL_DEV: "yes" })),
		).toBe("ZALO_LOCAL_DEV must be 1, 0 or unset");
	});

	it("keeps the override loopback-only and refused when the switch is 0", () => {
		expect(
			refusalOf(() =>
				zaloSettings({
					...LOCAL_STACK,
					ZALO_GRAPH_BASE_URL: "https://graph.zalo.me",
				}),
			),
		).toContain("must be a loopback address");
		expect(
			refusalOf(() => zaloSettings({ ...LOCAL_STACK, ZALO_LOCAL_DEV: "0" })),
		).toContain("ZALO_GRAPH_BASE_URL is accepted only with");
	});

	it("talks to the real graph when the switch has no override", () => {
		expect(
			zaloSettings({ ...LOCAL_STACK, ZALO_GRAPH_BASE_URL: undefined })
				.graphBaseUrl,
		).toBe("https://graph.zalo.me");
	});

	it("serves a tenant that is not a zalo-it- fixture", async () => {
		const backend = createFakeBackend();
		backend.addApp({
			brandKey: "brand-1",
			tenantId: LOCAL_TENANT,
			tenantSlug: "live-local",
			zaloAppId: "app-local",
			secretName: "ZALO_APP_SECRET_BRAND_1",
			status: "active",
		});
		await expect(
			requireBrandApp(backend, zaloSettings(LOCAL_STACK), "brand-1"),
		).resolves.toMatchObject({ tenantSlug: "live-local" });
	});
});

describe("isLoopbackDatabaseUrl", () => {
	it("accepts only a Postgres URL on 127.0.0.1 or localhost", () => {
		expect(
			isLoopbackDatabaseUrl(
				"postgresql://postgres:postgres@127.0.0.1:54322/postgres",
			),
		).toBe(true);
		for (const url of DEPLOYED_DATABASE_URLS) {
			expect(isLoopbackDatabaseUrl(url)).toBe(false);
		}
	});
});
