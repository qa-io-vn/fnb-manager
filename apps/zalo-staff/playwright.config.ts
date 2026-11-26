import { join } from "node:path";
import { MINI_APP_VIEWPORT } from "@fnb/zalo-mini/testing/design-checks";
import { defineConfig, devices } from "@playwright/test";

// The look of the unthemed screens, recorded before the shape and type tokens and compared at every screen check
// (design-checks.ts: checkStyleBaseline). MINI_APP_STYLE_MODE=write records it again after a deliberate change.
process.env.MINI_APP_STYLE_BASELINE ??= join(
	import.meta.dirname,
	"e2e",
	"style-baseline.json",
);

const portOffset = Number(process.env.E2E_PORT_OFFSET ?? "0");
const port = 5742 + portOffset;
const outDir = `node_modules/.cache/e2e-dist-${portOffset}`;
// The brand-3 checks run on a second build: the synthetic brand-3, which sets every optional colour role, a shape and a
// body size, as a Development build.
const brand3Port = 5747 + portOffset;
const brand3OutDir = `node_modules/.cache/e2e-brand3-dist-${portOffset}`;
const brand3 = { baseURL: `http://127.0.0.1:${brand3Port}/` } as const;
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
	// On CI the github reporter turns each failure into an annotation, readable without a login.
	reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
	use: {
		baseURL: `http://127.0.0.1:${port}/`,
		trace: "retain-on-failure",
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
	},
	projects: [
		{
			name: "b3-320-light",
			testMatch: /design-brand3\.spec\.ts/,
			use: {
				...phone,
				...brand3,
				viewport: { width: 320, height: 640 },
				colorScheme: "light",
			},
		},
		{
			name: "b3-360-light",
			testMatch: /design-brand3\.spec\.ts/,
			use: { ...phone, ...brand3, colorScheme: "light" },
		},
		{
			name: "b3-360-dark",
			testMatch: /design-brand3\.spec\.ts/,
			use: { ...phone, ...brand3, colorScheme: "dark" },
		},
		{
			name: "b3-412-dark",
			testMatch: /design-brand3\.spec\.ts/,
			use: {
				...phone,
				...brand3,
				viewport: { width: 412, height: 915 },
				colorScheme: "dark",
			},
		},
		{
			name: "b3-webkit",
			testMatch: /design-brand3\.spec\.ts/,
			use: { ...devices["iPhone 14"], ...brand3, colorScheme: "light" },
		},
		{
			name: "phone-light",
			testMatch:
				/(session|home|onboarding|checklists|shift-close|incidents|check-in|redemption|loyalty-queue|staff-bills|announcements|requests|notification-settings|network|lazy-screens)\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
		{
			name: "phone-dark",
			testMatch:
				/(session|home|onboarding|checklists|shift-close|incidents|check-in|redemption|loyalty-queue|staff-bills|announcements|requests|notification-settings|network|lazy-screens)\.spec\.ts/,
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
		{
			// A phone that sleeps, wakes without a signal or is tapped twice on a slow CPU (test-gaps G-36)
			name: "phone-sleep",
			testMatch: /sleep\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
	],
	webServer: [
		{
			command: `vite build --outDir ${outDir} --emptyOutDir && vite preview --outDir ${outDir} --host 127.0.0.1 --port ${port} --strictPort`,
			url: `http://127.0.0.1:${port}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: { VITE_ZALO_RUNTIME: "browser", VITE_MINI_APP_STAGE: "testing" },
		},
		{
			command: `vite build --outDir ${brand3OutDir} --emptyOutDir && vite preview --outDir ${brand3OutDir} --host 127.0.0.1 --port ${brand3Port} --strictPort`,
			url: `http://127.0.0.1:${brand3Port}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				VITE_ZALO_RUNTIME: "browser",
				VITE_MINI_APP_STAGE: "development",
				VITE_BRAND_KEY: "brand-3",
			},
		},
	],
});
