import { MINI_APP_VIEWPORT } from "@fnb/zalo-mini/testing/design-checks";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	outputDir: "node_modules/.cache/playwright-results-local",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 600_000,
	expect: { timeout: 30_000 },
	reporter: [["list"]],
	use: {
		locale: "vi-VN",
		timezoneId: "Asia/Ho_Chi_Minh",
		trace: "off",
		screenshot: "off",
		video: "off",
	},
	projects: [
		{
			name: "local",
			testMatch: /(?:loyalty|bills|counter|approval|ordering)-local\.spec\.ts/,
			use: {
				viewport: MINI_APP_VIEWPORT,
				deviceScaleFactor: 2,
				isMobile: true,
				hasTouch: true,
				colorScheme: "light",
			},
		},
	],
});
