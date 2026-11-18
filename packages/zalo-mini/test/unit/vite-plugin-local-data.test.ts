import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigEnv, UserConfig } from "vite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { miniApp, miniAppSettings } from "../../src/vite/index";

const workspace = mkdtempSync(join(tmpdir(), "fnb-mini-data-"));
const appRoot = join(workspace, "apps", "staff");
mkdirSync(appRoot, { recursive: true });
writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages: []\n");
writeFileSync(
	join(workspace, ".env"),
	"SUPABASE_URL=http://127.0.0.1:54321/\nSUPABASE_SECRET_KEY=not-for-the-app\n",
);
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
afterEach(() => {
	vi.unstubAllEnvs();
});

const local = {
	VITE_ZALO_SESSION: "local",
	ZALO_LOCAL_SESSION_URL: "http://127.0.0.1:5745",
	ZALO_LOCAL_ACCESS_TOKEN: "mock-zalo-access-local",
};

function resolvedConfig(command: ConfigEnv["command"]): UserConfig {
	for (const [name, value] of Object.entries(local)) vi.stubEnv(name, value);
	const main = miniApp({ kind: "staff", appRoot }).find(
		(plugin) => plugin.name === "fnb-mini-app",
	);
	const config = main?.config as (
		config: UserConfig,
		env: ConfigEnv,
	) => UserConfig;
	return config({}, { command, mode: "development" });
}

describe("the local session's data path", () => {
	it("falls back to the workspace's loopback SUPABASE_URL, never to a remote one, and keeps an explicit address first", () => {
		expect(
			miniAppSettings(
				{ ...local, SUPABASE_URL: "http://127.0.0.1:54321/" },
				"serve",
				appRoot,
			).local?.supabaseUrl,
		).toBe("http://127.0.0.1:54321");
		expect(
			miniAppSettings(
				{ ...local, SUPABASE_URL: "https://project.example.com" },
				"serve",
				appRoot,
			).local?.supabaseUrl,
		).toBeNull();
		expect(
			miniAppSettings(
				{
					...local,
					SUPABASE_URL: "http://127.0.0.1:54321",
					ZALO_LOCAL_SUPABASE_URL: "http://localhost:54331",
				},
				"serve",
				appRoot,
			).local?.supabaseUrl,
		).toBe("http://localhost:54331");
	});

	it("proxies /supabase REST and Auth in plain local mode from the repository's .env, and exposes nothing else of it", () => {
		const resolved = resolvedConfig("serve");
		const proxy = resolved.server?.proxy as Record<
			string,
			{ readonly target: string }
		>;
		expect(Object.keys(proxy).sort()).toEqual([
			"/functions/v1/zalo-session",
			"/supabase/auth/v1/",
			"/supabase/rest/v1/",
		]);
		expect(proxy["/supabase/rest/v1/"]?.target).toBe("http://127.0.0.1:54321");
		expect(JSON.stringify(resolved.define)).not.toContain("not-for-the-app");
		expect(JSON.stringify(resolved.define)).not.toContain("54321");
	});
});
