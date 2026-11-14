import { defineConfig, devices } from "@playwright/test";

const portOffset = Number(process.env.E2E_PORT_OFFSET ?? "0");
const demoPort = 5196 + portOffset;
const signedOutPort = 5197 + portOffset;
const unreachableBackend = "http://127.0.0.1:9";

export default defineConfig({
	testDir: "user-guide",
	outputDir: `node_modules/.cache/user-guide-results-${portOffset}`,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 90_000,
	expect: { timeout: 30_000 },
	reporter: [["list"]],
	use: {
		...devices["Desktop Chrome"],
		deviceScaleFactor: 1,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	},
	projects: [
		{
			name: "demo",
			testMatch: /demo\.screens\.ts/,
			use: { baseURL: `http://127.0.0.1:${demoPort}` },
		},
		{
			name: "signed-out",
			testMatch: /signed-out\.screens\.ts/,
			use: { baseURL: `http://127.0.0.1:${signedOutPort}` },
		},
	],
	webServer: [
		{
			command: `vite --host 127.0.0.1 --port ${demoPort} --strictPort`,
			url: `http://127.0.0.1:${demoPort}`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
		},
		{
			command: `vite --host 127.0.0.1 --port ${signedOutPort} --strictPort`,
			url: `http://127.0.0.1:${signedOutPort}`,
			reuseExistingServer: false,
			timeout: 60_000,
			env: {
				VITE_SUPABASE_URL: unreachableBackend,
				VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_user_guide_placeholder",
			},
		},
	],
});
