import { defineConfig, devices } from "@playwright/test";

const livePort = 5191;
const demoPort = 5192;
const pagesPort = 5193;
const pagesBasePath = "/fnb-manager/";
const pagesOutDir = "node_modules/.cache/pages-demo";
const demoEnv = { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" };

export default defineConfig({
	testDir: "e2e",
	outputDir: "node_modules/.cache/playwright-results",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [["list"]],
	use: {
		...devices["Desktop Chrome"],
		trace: "retain-on-failure",
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	},
	projects: [
		{
			name: "live",
			testMatch: /live\/.*\.spec\.ts/,
			use: { baseURL: `http://127.0.0.1:${livePort}` },
		},
		{
			name: "demo",
			testMatch: /demo\/.*\.spec\.ts/,
			use: { baseURL: `http://127.0.0.1:${demoPort}` },
		},
		{
			name: "pages",
			testMatch: /pages\/.*\.spec\.ts/,
			use: { baseURL: `http://127.0.0.1:${pagesPort}${pagesBasePath}` },
		},
	],
	webServer: [
		{
			command: `vite --host 127.0.0.1 --port ${livePort} --strictPort`,
			url: `http://127.0.0.1:${livePort}`,
			reuseExistingServer: false,
			timeout: 60_000,
		},
		{
			command: `vite --host 127.0.0.1 --port ${demoPort} --strictPort`,
			url: `http://127.0.0.1:${demoPort}`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: demoEnv,
		},
		{
			command: `vite build --outDir ${pagesOutDir} --emptyOutDir && vite preview --outDir ${pagesOutDir} --host 127.0.0.1 --port ${pagesPort} --strictPort`,
			url: `http://127.0.0.1:${pagesPort}${pagesBasePath}`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: { ...demoEnv, VITE_BASE_PATH: pagesBasePath },
		},
	],
});
