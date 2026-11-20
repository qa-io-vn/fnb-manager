import { MINI_APP_VIEWPORT } from "@fnb/zalo-mini/testing/design-checks";
import { defineConfig, devices } from "@playwright/test";

const portOffset = Number(process.env.E2E_PORT_OFFSET ?? "0");
const port = 5742 + portOffset;
const outDir = `node_modules/.cache/e2e-dist-${portOffset}`;
const phone = {
	viewport: MINI_APP_VIEWPORT,
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
} as const;

export default defineConfig({
	testDir: "e2e",
	outputDir: `node_modules/.cache/playwright-results-${portOffset}`,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${port}/`,
		trace: "retain-on-failure",
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	},
	projects: [
		{
			name: "phone-light",
			testMatch:
				/(session|home|onboarding|checklists|shift-close|incidents|check-in|redemption|loyalty-queue|announcements|requests|notification-settings|network|lazy-screens)\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
		{
			name: "phone-dark",
			testMatch:
				/(session|home|onboarding|checklists|shift-close|incidents|check-in|redemption|loyalty-queue|announcements|requests|notification-settings|network|lazy-screens)\.spec\.ts/,
			use: { ...phone, colorScheme: "dark" },
		},
		{
			// WebKit as an iPhone, light mode only to keep CI time down (test-gaps G-35)
			name: "phone-webkit",
			testMatch: /(home|check-in|redemption|network).spec.ts/,
			use: { ...devices["iPhone 14"], colorScheme: "light" },
		},
		{
			name: "budget",
			testMatch: /budget\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
	],
	webServer: {
		command: `vite build --outDir ${outDir} --emptyOutDir && vite preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: { VITE_ZALO_RUNTIME: "browser", VITE_MINI_APP_STAGE: "testing" },
	},
});
