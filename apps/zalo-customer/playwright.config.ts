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
const port = 5752 + portOffset;
const outDir = `node_modules/.cache/e2e-dist-${portOffset}`;
// The design checks run on a second build: the synthetic brand-2, which has a brand theme (ADR-056), as a Development
// build, so the banner, the overlapping card and the failure code under an error are all on screen.
const designPort = 5758 + portOffset;
const designOutDir = `node_modules/.cache/e2e-design-dist-${portOffset}`;
// The brand-3 checks run on a third build: the synthetic brand-3, which sets every optional colour role, a shape and a
// body size, as a Development build (it also carries the design kit screen, /kit).
const brand3Port = 5762 + portOffset;
const brand3OutDir = `node_modules/.cache/e2e-brand3-dist-${portOffset}`;
const brand3 = { baseURL: `http://127.0.0.1:${brand3Port}/` } as const;
// The ordering checks run on a fourth build: VITE_ORDERING=on (the tester builds of ADR-058), as a Development build so
// that a screen a customer reaches only by a link (another customer's order) can be opened with ?route=.
const orderingPort = 5766 + portOffset;
const orderingOutDir = `node_modules/.cache/e2e-ordering-dist-${portOffset}`;
const ordering = { baseURL: `http://127.0.0.1:${orderingPort}/` } as const;
// Paying online runs on a fifth build: the ordering build with VITE_ONLINE_PAYMENT=on, so the fourth stays the
// regression of a tester build without it (the online ways to pay disabled even where the store offers them).
const paymentPort = 5770 + portOffset;
const paymentOutDir = `node_modules/.cache/e2e-payment-dist-${portOffset}`;
const payment = { baseURL: `http://127.0.0.1:${paymentPort}/` } as const;
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
			// the checks of the design checks themselves, on pages of their own
			name: "check-pages",
			testMatch: /design-checks\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
		{
			name: "b3-320-light",
			testMatch: /(design-brand3|chrome)\.spec\.ts/,
			use: {
				...phone,
				...brand3,
				viewport: { width: 320, height: 640 },
				colorScheme: "light",
			},
		},
		{
			name: "b3-360-light",
			testMatch: /(design-brand3|chrome)\.spec\.ts/,
			use: { ...phone, ...brand3, colorScheme: "light" },
		},
		{
			name: "b3-360-dark",
			testMatch: /(design-brand3|chrome)\.spec\.ts/,
			use: { ...phone, ...brand3, colorScheme: "dark" },
		},
		{
			name: "b3-412-dark",
			testMatch: /(design-brand3|chrome)\.spec\.ts/,
			use: {
				...phone,
				...brand3,
				viewport: { width: 412, height: 915 },
				colorScheme: "dark",
			},
		},
		{
			// the owner's phone is an iPhone: brand-3 on WebKit as well
			name: "b3-webkit",
			testMatch: /(design-brand3|chrome)\.spec\.ts/,
			use: { ...devices["iPhone 14"], ...brand3, colorScheme: "light" },
		},
		{
			name: "phone-light",
			testMatch:
				/(account|bills|browse|join|wallet|network|lazy-screens|ordering-off)\.spec\.ts/,
			use: { ...phone, colorScheme: "light" },
		},
		{
			name: "phone-dark",
			testMatch:
				/(account|bills|browse|join|wallet|network|lazy-screens|ordering-off)\.spec\.ts/,
			use: { ...phone, colorScheme: "dark" },
		},
		{
			// WebKit as an iPhone, light mode only to keep CI time down (test-gaps G-35)
			name: "phone-webkit",
			testMatch:
				/(account|bills|browse|join|wallet|network|lazy-screens|ordering-off).spec.ts/,
			use: { ...devices["iPhone 14"], colorScheme: "light" },
		},
		{
			name: "ordering-light",
			testMatch: /(ordering|company-invoice)\.spec\.ts/,
			use: { ...phone, ...ordering, colorScheme: "light" },
		},
		{
			name: "ordering-dark",
			testMatch: /(ordering|company-invoice)\.spec\.ts/,
			use: { ...phone, ...ordering, colorScheme: "dark" },
		},
		{
			// the owner's phone is an iPhone: the ordering screens on WebKit as well
			name: "ordering-webkit",
			testMatch: /(ordering|company-invoice)\.spec\.ts/,
			use: { ...devices["iPhone 14"], ...ordering, colorScheme: "light" },
		},
		{
			name: "payment-light",
			testMatch: /ordering-payment\.spec\.ts/,
			use: { ...phone, ...payment, colorScheme: "light" },
		},
		{
			name: "payment-dark",
			testMatch: /ordering-payment\.spec\.ts/,
			use: { ...phone, ...payment, colorScheme: "dark" },
		},
		{
			// the owner's phone is an iPhone: paying online on WebKit as well
			name: "payment-webkit",
			testMatch: /ordering-payment\.spec\.ts/,
			use: { ...devices["iPhone 14"], ...payment, colorScheme: "light" },
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
		{
			name: "design-light",
			testMatch: /design\.spec\.ts/,
			use: {
				...phone,
				colorScheme: "light",
				baseURL: `http://127.0.0.1:${designPort}/`,
			},
		},
		{
			name: "design-dark",
			testMatch: /design\.spec\.ts/,
			use: {
				...phone,
				colorScheme: "dark",
				baseURL: `http://127.0.0.1:${designPort}/`,
			},
		},
		{
			// the owner's phone is an iPhone: the redesigned home on WebKit as well
			name: "design-webkit",
			testMatch: /design\.spec\.ts/,
			use: {
				...devices["iPhone 14"],
				colorScheme: "light",
				baseURL: `http://127.0.0.1:${designPort}/`,
			},
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
			command: `vite build --outDir ${designOutDir} --emptyOutDir && vite preview --outDir ${designOutDir} --host 127.0.0.1 --port ${designPort} --strictPort`,
			url: `http://127.0.0.1:${designPort}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				VITE_ZALO_RUNTIME: "browser",
				VITE_MINI_APP_STAGE: "development",
				VITE_BRAND_KEY: "brand-2",
			},
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
		{
			command: `vite build --outDir ${orderingOutDir} --emptyOutDir && vite preview --outDir ${orderingOutDir} --host 127.0.0.1 --port ${orderingPort} --strictPort`,
			url: `http://127.0.0.1:${orderingPort}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				VITE_ZALO_RUNTIME: "browser",
				VITE_MINI_APP_STAGE: "development",
				VITE_ORDERING: "on",
			},
		},
		{
			command: `vite build --outDir ${paymentOutDir} --emptyOutDir && vite preview --outDir ${paymentOutDir} --host 127.0.0.1 --port ${paymentPort} --strictPort`,
			url: `http://127.0.0.1:${paymentPort}/`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				VITE_ZALO_RUNTIME: "browser",
				VITE_MINI_APP_STAGE: "development",
				VITE_ORDERING: "on",
				VITE_ONLINE_PAYMENT: "on",
			},
		},
	],
});
