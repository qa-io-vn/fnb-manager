import { defineConfig, devices } from "@playwright/test";
import { E2E_APP_PORT, E2E_FUNCTION_PORT } from "./e2e/support/ports";

// The counter's end-to-end suite runs the production build (its CSP included) against the local stack, the mock Zalo
// and the real counter-session function: `node scripts/with-local-stack.mjs npx playwright test` from apps/counter.
// Tablets at 1280×800 and 1024×768 in Chromium and WebKit, and phones for the manager pages. Light scheme.
const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey =
	process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_missing";
const tablet = /.*\.tablet\.spec\.ts/;
const phone = /.*\.phone\.spec\.ts/;

export default defineConfig({
	testDir: "e2e",
	outputDir: "node_modules/.cache/playwright-results",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [["list"]],
	globalSetup: "./e2e/support/global-setup.ts",
	use: {
		baseURL: `http://127.0.0.1:${E2E_APP_PORT}`,
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
		colorScheme: "light",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "tablet-1280-chromium",
			testMatch: tablet,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1280, height: 800 },
				hasTouch: true,
			},
		},
		{
			name: "tablet-1024-chromium",
			testMatch: tablet,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1024, height: 768 },
				hasTouch: true,
			},
		},
		{
			name: "tablet-1280-webkit",
			testMatch: tablet,
			use: {
				...devices["Desktop Safari"],
				viewport: { width: 1280, height: 800 },
				hasTouch: true,
			},
		},
		{
			name: "phone-chromium",
			testMatch: phone,
			use: { ...devices["Pixel 7"] },
		},
		{
			name: "phone-webkit",
			testMatch: phone,
			use: { ...devices["iPhone 14"] },
		},
	],
	webServer: {
		command: "npx vite build && npx vite preview",
		url: `http://127.0.0.1:${E2E_APP_PORT}`,
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			VITE_SUPABASE_URL: supabaseUrl,
			VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
			VITE_COUNTER_SESSION_URL: `http://127.0.0.1:${E2E_FUNCTION_PORT}`,
			VITE_BRAND_KEY: "brand-1",
		},
	},
});
