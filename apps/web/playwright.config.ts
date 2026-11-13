import { defineConfig, devices } from "@playwright/test";

const portOffset = Number(process.env.E2E_PORT_OFFSET ?? "0");
const livePort = 5191 + portOffset;
const demoPort = 5192 + portOffset;
const pagesPort = 5193 + portOffset;
const pagesBasePath = "/fnb-manager/";
const pagesOutDir = `node_modules/.cache/pages-demo-${portOffset}`;
const resultsDir = `node_modules/.cache/playwright-results-${portOffset}`;
const demoEnv = { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" };

function requestedProjects(
	argv: readonly string[],
): ReadonlySet<string> | null {
	const names = argv.flatMap((argument, index) => {
		if (argument.startsWith("--project=")) {
			return [argument.slice("--project=".length)];
		}
		const next = argv[index + 1];
		return argument === "--project" && next !== undefined ? [next] : [];
	});
	return names.length === 0 ? null : new Set(names);
}

const projects = requestedProjects(process.argv);
const serves = (project: string) => projects === null || projects.has(project);

export default defineConfig({
	testDir: "e2e",
	outputDir: resultsDir,
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
		...(serves("live")
			? [
					{
						command: `vite --host 127.0.0.1 --port ${livePort} --strictPort`,
						url: `http://127.0.0.1:${livePort}`,
						reuseExistingServer: false,
						timeout: 60_000,
					},
				]
			: []),
		...(serves("demo")
			? [
					{
						command: `vite --host 127.0.0.1 --port ${demoPort} --strictPort`,
						url: `http://127.0.0.1:${demoPort}`,
						reuseExistingServer: false,
						timeout: 60_000,
						env: demoEnv,
					},
				]
			: []),
		...(serves("pages")
			? [
					{
						command: `vite build --outDir ${pagesOutDir} --emptyOutDir && vite preview --outDir ${pagesOutDir} --host 127.0.0.1 --port ${pagesPort} --strictPort`,
						url: `http://127.0.0.1:${pagesPort}${pagesBasePath}`,
						reuseExistingServer: false,
						timeout: 120_000,
						env: { ...demoEnv, VITE_BASE_PATH: pagesBasePath },
					},
				]
			: []),
	],
});
