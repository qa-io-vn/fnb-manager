#!/usr/bin/env node
// The one-command test packs of docs/test-plan.md section 2.13:
//   node scripts/regression.mjs --smoke   (pnpm test:smoke, under 5 minutes locally)
//   node scripts/regression.mjs           (pnpm test:regression, the full pack)
// Every step runs in order and the pack keeps going after a failure; the summary
// names each step's result, duration and why it skipped, and the exit code is 1
// when any step failed. It never resets the database, never reads .env, never
// touches the real tenant and never calls the POS or Zalo: switches that would
// (LIVE, E2E_TUNNEL, LOYALTY_FAST_LANE) are removed from every step's environment
// and IPOS_REAL_API is forced to off.

import { spawn, spawnSync } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WINDOWS = process.platform === "win32";
const MINUTE = 60_000;
const OUTPUT_TAIL_BYTES = 4 * 1024 * 1024;

const SMOKE_UNIT_PACKAGES = [
	"@fnb/core",
	"@fnb/connector-ipos",
	"@fnb/zalo-mini",
	"@fnb/zalo",
	"@fnb/notify",
	"@fnb/reports",
];

const SMOKE_PGTAP = (number) =>
	number === 3 ||
	number === 47 ||
	(number >= 60 && number <= 72) ||
	number === 80 ||
	(number >= 90 && number <= 98) ||
	(number >= 130 && number <= 139);

const SMOKE_WEB_DEMO_SPECS = [
	"e2e/demo/loyalty.spec.ts",
	"e2e/demo/settings-loyalty.spec.ts",
	"e2e/demo/settings-rewards.spec.ts",
	"e2e/demo/operations.spec.ts",
	"e2e/demo/announcements.spec.ts",
];

// Failures that only this Windows build machine shows; CI on Linux is green.
// They stay red: the summary names them so nobody mistakes them for a regression.
const KNOWN_WINDOWS_ISSUES = [
	{
		label: "design-tokens: the biome .cmd shim (spawnSync ENOENT)",
		failure: /generated\.test\.ts > generated token files/,
	},
	{
		label: "reports: the reference-sheet path test (a drive-letter path)",
		failure:
			/reference-sheet\.test\.ts > .*hourly file only in the sheet's own folder/,
	},
	{
		label: "web: CRLF wording sheets (core.autocrlf)",
		failure: /wording-sheets\.test\.ts/,
	},
];

// Removed from every step: each would reach a real system or a real tenant.
const FORBIDDEN_VARIABLES = [
	"LIVE",
	"LIVE_TENANT",
	"LIVE_ACCEPTANCE",
	"LIVE_REFERENCE_SHEET",
	"E2E_TUNNEL",
	"LOYALTY_FAST_LANE",
	"POS_ACCOUNTS_JSON",
	"IPOS_APP_KEY",
];

// The switches of the gated suites (test-plan section 5.3). Unit steps run
// without them, so a unit step never turns into an integration run.
const GATE_VARIABLES = [
	"DATABASE_URL",
	"NOTIFY_INTEGRATION",
	"ZALO_INTEGRATION",
	"LOYALTY_INTEGRATION",
	"ZALO_LOCAL_DEV",
	"PARITY_DATABASE",
	"SUPABASE_URL",
	"SUPABASE_SECRET_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_PUBLISHABLE_KEY",
];

function parseArguments(argv) {
	const options = {
		smoke: false,
		list: false,
		only: null,
		skip: new Set(),
		reportDir: null,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = () => {
			const next = argv[index + 1];
			if (next === undefined) {
				throw new Error(`${argument} needs a value`);
			}
			index += 1;
			return next;
		};
		if (argument === "--") continue;
		if (argument === "--smoke") options.smoke = true;
		else if (argument === "--list") options.list = true;
		else if (argument === "--only") options.only = new Set(value().split(","));
		else if (argument === "--skip")
			for (const id of value().split(",")) options.skip.add(id);
		else if (argument === "--report-dir") options.reportDir = value();
		else if (argument === "--help" || argument === "-h") {
			process.stdout.write(
				[
					"usage: node scripts/regression.mjs [--smoke] [--list] [--only <id,...>] [--skip <id,...>] [--report-dir <dir>]",
					"",
					"  --smoke       the smoke pack (pnpm test:smoke); without it the full regression pack",
					"  --list        print the steps and their gates without running anything",
					"  --only, --skip  step ids from --list",
					"  --report-dir  where the JSON report and step logs go (default: <os temp>/fnb-regression)",
					"",
					"Switches read from the shell (never from .env): DATABASE_URL (local stack only), NOTIFY_INTEGRATION=1,",
					"ZALO_INTEGRATION=1, LOYALTY_INTEGRATION=1, ZALO_LOCAL_DEV=1, PARITY_POSTGRES=1, E2E_PORT_OFFSET,",
					"REGRESSION_MAX_WORKERS (default 2), DENO (path to deno).",
					"",
				].join("\n"),
			);
			process.exit(0);
		} else {
			throw new Error(`unknown argument ${argument}`);
		}
	}
	return options;
}

function isLocalDatabaseUrl(url) {
	try {
		const host = new URL(url).hostname;
		return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
	} catch {
		return false;
	}
}

function quote(value) {
	return /[\s"&|<>^()%!]/.test(value)
		? `"${value.replace(/"/g, '""')}"`
		: value;
}

function baseEnvironment() {
	const environment = { ...process.env };
	for (const name of FORBIDDEN_VARIABLES) {
		delete environment[name];
	}
	environment.IPOS_REAL_API = "off";
	environment.E2E_PORT_OFFSET = process.env.E2E_PORT_OFFSET ?? "40";
	environment.FORCE_COLOR = "0";
	environment.NO_COLOR = "1";
	return environment;
}

function withoutGates(environment) {
	const copy = { ...environment };
	for (const name of GATE_VARIABLES) {
		delete copy[name];
	}
	return copy;
}

function commandExists(command) {
	const probe = WINDOWS
		? spawnSync("where", [command], { stdio: "ignore", shell: true })
		: spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
	return probe.status === 0;
}

function denoCommand() {
	if (process.env.DENO) {
		return existsSync(process.env.DENO) ? process.env.DENO : null;
	}
	return commandExists("deno") ? "deno" : null;
}

let stackProbe = null;
function localStackRunning() {
	if (stackProbe === null) {
		const probe = spawnSync(
			WINDOWS ? "pnpm.cmd" : "pnpm",
			["exec", "supabase", "status", "-o", "env"],
			{
				cwd: ROOT,
				encoding: "utf8",
				shell: WINDOWS,
				timeout: 2 * MINUTE,
				env: baseEnvironment(),
			},
		);
		stackProbe = /^API_URL=/m.test(probe.stdout ?? "");
	}
	return stackProbe;
}

function workspacePackages() {
	const found = [];
	for (const folder of ["packages", "apps"]) {
		for (const name of readdirSync(join(ROOT, folder)).sort()) {
			const file = join(ROOT, folder, name, "package.json");
			if (!existsSync(file)) continue;
			const manifest = JSON.parse(readFileSync(file, "utf8"));
			found.push({
				name: manifest.name,
				dir: join(folder, name),
				scripts: manifest.scripts ?? {},
			});
		}
	}
	return found;
}

function pgtapFiles(filter) {
	const directory = join(ROOT, "supabase", "tests");
	return readdirSync(directory)
		.filter((name) => /^\d+_.*\.sql$/.test(name))
		.filter((name) => filter(Number(name.split("_")[0])))
		.sort(
			(left, right) => Number(left.split("_")[0]) - Number(right.split("_")[0]),
		)
		.map((name) => `supabase/tests/${name}`);
}

function functionFolders() {
	const directory = join(ROOT, "supabase", "functions");
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "_shared")
		.map((entry) => entry.name)
		.sort();
}

const workers = () =>
	`--maxWorkers=${process.env.REGRESSION_MAX_WORKERS ?? "2"}`;

// A gate answers null to run, or the reason the step is skipped.
const gates = {
	stack: () =>
		localStackRunning()
			? null
			: "the local Supabase stack is not running (pnpm db:start; never db reset)",
	database: () => {
		const url = process.env.DATABASE_URL;
		if (!url) return "DATABASE_URL is not set in the shell";
		return isLocalDatabaseUrl(url)
			? null
			: "DATABASE_URL does not name a loopback host; the packs run on the local stack only";
	},
	switch: (name) => () => {
		const refused = gates.database();
		if (refused !== null) return refused;
		return process.env[name] === "1" ? null : `${name}=1 is not set`;
	},
	deno: () =>
		denoCommand()
			? null
			: "deno is not on PATH (install Deno 2.7.3 or set DENO)",
};

function all(...checks) {
	return () => {
		for (const check of checks) {
			const reason = check();
			if (reason !== null) return reason;
		}
		return null;
	};
}

function pnpm(...args) {
	return { command: "pnpm", args };
}

// The same loop as ci.yml's "Type-check and test every Edge Function with Deno":
// one row per kind of check, one command per function folder.
function denoSteps(kind) {
	const folder = (name) => join("supabase", "functions", name);
	const steps = [];
	if (kind === "full") {
		steps.push({
			id: "deno-check",
			title: "Deno type-check of every Edge Function",
			level: "static",
			gate: gates.deno,
			commands: () =>
				functionFolders().map((name) => ({
					command: denoCommand(),
					args: ["check", "index.ts"],
					cwd: folder(name),
				})),
		});
	}
	steps.push({
		id: "deno-test",
		title: "Deno tests of every Edge Function and _shared",
		level: "unit",
		gate: gates.deno,
		unitEnvironment: true,
		commands: () => [
			...functionFolders().map((name) => ({
				command: denoCommand(),
				args: ["test", "--permit-no-files"],
				cwd: folder(name),
			})),
			{ command: denoCommand(), args: ["test"], cwd: folder("_shared") },
		],
	});
	return steps;
}

function stepCommands(step) {
	if (step.commands) return step.commands();
	if (step.run) return [{ ...step.run(), cwd: step.cwd }];
	return [{ command: step.command, args: step.args, cwd: step.cwd }];
}

function smokeSteps() {
	return [
		{
			id: "typecheck",
			title: "Type-check every package",
			level: "static",
			...pnpm("typecheck"),
		},
		...SMOKE_UNIT_PACKAGES.map((name) => ({
			id: `unit-${name.replace("@fnb/", "")}`,
			title: `Unit tests: ${name}`,
			level: "unit",
			unitEnvironment: true,
			...pnpm("--filter", name, "run", "test", workers()),
		})),
		{
			id: "pgtap-loyalty",
			title: "pgTAP: RLS, operations and loyalty subset",
			level: "database",
			gate: gates.stack,
			...pnpm("exec", "supabase", "test", "db", ...pgtapFiles(SMOKE_PGTAP)),
		},
		...denoSteps("smoke"),
		{
			id: "e2e-zalo-staff-light",
			title: "Staff Mini App demo Playwright (phone-light)",
			level: "e2e",
			timeout: 15 * MINUTE,
			unitEnvironment: true,
			...pnpm(
				"--filter",
				"@fnb/zalo-staff",
				"exec",
				"playwright",
				"test",
				"--project=phone-light",
			),
		},
		{
			id: "e2e-zalo-customer-light",
			title: "Customer Mini App demo Playwright (phone-light)",
			level: "e2e",
			timeout: 15 * MINUTE,
			unitEnvironment: true,
			...pnpm(
				"--filter",
				"@fnb/zalo-customer",
				"exec",
				"playwright",
				"test",
				"--project=phone-light",
			),
		},
		{
			id: "e2e-web-demo-loyalty",
			title: "Web demo Playwright: loyalty, rewards, operations, announcements",
			level: "e2e",
			timeout: 15 * MINUTE,
			unitEnvironment: true,
			...pnpm(
				"--filter",
				"@fnb/web",
				"exec",
				"playwright",
				"test",
				"--project=demo",
				...SMOKE_WEB_DEMO_SPECS,
			),
		},
	];
}

function regressionSteps() {
	const packages = workspacePackages();
	return [
		{
			id: "lint",
			title: "Lint (biome)",
			level: "static",
			...pnpm("lint", "--max-diagnostics=none"),
		},
		{
			id: "typecheck",
			title: "Type-check every package",
			level: "static",
			...pnpm("typecheck"),
		},
		...packages
			.filter((entry) => entry.scripts.test)
			.map((entry) => ({
				id: `unit-${entry.dir.split(/[\\/]/).pop()}`,
				title: `Unit tests: ${entry.name}`,
				level: "unit",
				unitEnvironment: true,
				timeout: 20 * MINUTE,
				...pnpm("--filter", entry.name, "run", "test", workers()),
			})),
		{
			id: "pgtap-all",
			title: "pgTAP: every file",
			level: "database",
			gate: gates.stack,
			timeout: 20 * MINUTE,
			...pnpm("exec", "supabase", "test", "db"),
		},
		{
			id: "parity-postgres",
			title:
				"Parity on Postgres (the PGlite parity runs in unit-demo-analytics)",
			level: "parity",
			gate: all(gates.database, () =>
				process.env.PARITY_POSTGRES === "1"
					? null
					: "PARITY_POSTGRES=1 is not set: Postgres parity refuses a stack holding non-demo tenants, so it runs on a fresh stack (CI)",
			),
			environment: { PARITY_DATABASE: "postgres" },
			...pnpm(
				"--filter",
				"@fnb/demo-analytics",
				"exec",
				"vitest",
				"run",
				"test/parity",
			),
		},
		...denoSteps("full"),
		{
			id: "function-imports",
			title: "Edge Function import map is current",
			level: "static",
			command: "node",
			args: ["scripts/function-imports.mjs", "--check"],
		},
		{
			id: "check-api-docs",
			title: "API documentation matches the database functions",
			level: "static",
			...pnpm("docs:check-api"),
		},
		{
			id: "check-openapi",
			title: "OpenAPI description matches the local database",
			level: "static",
			gate: gates.stack,
			...pnpm("docs:check-openapi"),
		},
		{
			id: "public-safety",
			title: "Public-safety scan",
			level: "static",
			command: "node",
			args: ["scripts/check-public-safe.mjs"],
		},
		{
			id: "e2e-zalo-staff",
			title: "Staff Mini App Playwright (both themes, budget)",
			level: "e2e",
			timeout: 30 * MINUTE,
			unitEnvironment: true,
			...pnpm("--filter", "@fnb/zalo-staff", "test:e2e"),
		},
		{
			id: "e2e-zalo-customer",
			title: "Customer Mini App Playwright (both themes, budget)",
			level: "e2e",
			timeout: 30 * MINUTE,
			unitEnvironment: true,
			...pnpm("--filter", "@fnb/zalo-customer", "test:e2e"),
		},
		{
			id: "e2e-zalo-customer-local",
			title: "Customer Mini App against the local stack",
			level: "e2e",
			gate: all(gates.stack, () =>
				process.env.ZALO_LOCAL_DEV === "1"
					? null
					: "ZALO_LOCAL_DEV=1 is not set",
			),
			timeout: 20 * MINUTE,
			...pnpm("--filter", "@fnb/zalo-customer", "test:e2e:local"),
		},
		{
			id: "e2e-web-demo",
			title: "Web Playwright: demo and pages projects",
			level: "e2e",
			timeout: 45 * MINUTE,
			unitEnvironment: true,
			...pnpm(
				"--filter",
				"@fnb/web",
				"exec",
				"playwright",
				"test",
				"--project=demo",
				"--project=pages",
			),
		},
		{
			id: "e2e-web-live",
			title: "Web Playwright: live project on the local stack",
			level: "e2e",
			gate: all(gates.database, gates.stack, () =>
				existsSync(join(ROOT, "apps", "web", ".env.local"))
					? null
					: "apps/web/.env.local is missing (written from pnpm db:status)",
			),
			timeout: 45 * MINUTE,
			...pnpm(
				"--filter",
				"@fnb/web",
				"exec",
				"playwright",
				"test",
				"--project=live",
			),
		},
		{
			id: "it-sync",
			title: "Integration: sync repository on Postgres",
			level: "integration",
			gate: gates.database,
			...pnpm(
				"--filter",
				"@fnb/sync",
				"exec",
				"vitest",
				"run",
				"test/integration",
			),
		},
		{
			id: "it-jobs",
			title:
				"Integration: fnb CLI on the local stack (fixture tenants; the read-only real-tenant fidelity check excluded)",
			level: "integration",
			gate: gates.database,
			timeout: 20 * MINUTE,
			...pnpm(
				"--filter",
				"@fnb/jobs",
				"exec",
				"vitest",
				"run",
				"test/integration",
				"--exclude",
				"test/integration/ipos-snapshot-fidelity.test.ts",
				"--exclude",
				"test/integration/loyalty-pipeline.test.ts",
			),
		},
		{
			id: "it-loyalty-pipeline",
			title:
				"Integration: loyalty pipeline, sync to wallet (LOYALTY_INTEGRATION)",
			level: "integration",
			gate: gates.switch("LOYALTY_INTEGRATION"),
			timeout: 15 * MINUTE,
			...pnpm(
				"--filter",
				"@fnb/jobs",
				"exec",
				"vitest",
				"run",
				"test/integration/loyalty-pipeline.test.ts",
			),
		},
		{
			id: "it-notify",
			title: "Integration: notification dispatcher (NOTIFY_INTEGRATION)",
			level: "integration",
			gate: gates.switch("NOTIFY_INTEGRATION"),
			timeout: 20 * MINUTE,
			...pnpm("--filter", "@fnb/notify", "test:integration"),
		},
		{
			id: "it-zalo",
			title: "Integration: Zalo session and phone (ZALO_INTEGRATION)",
			level: "integration",
			gate: all(gates.switch("ZALO_INTEGRATION"), () =>
				process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
					? null
					: "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY of the local stack are not set",
			),
			timeout: 20 * MINUTE,
			...pnpm("--filter", "@fnb/zalo", "test:integration"),
		},
		{
			id: "it-deno-webhooks",
			title:
				"Integration (Deno): oa-webhook and bot-webhook (ZALO_INTEGRATION)",
			level: "integration",
			gate: all(gates.switch("ZALO_INTEGRATION"), gates.deno),
			commands: () =>
				["oa-webhook", "bot-webhook"].map((folder) => ({
					command: denoCommand(),
					args: ["test", "-A", "integration.test.ts"],
					cwd: join("supabase", "functions", folder),
				})),
		},
	];
}

function stripAnsi(text) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes
	return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

// Biome's diagnostics name a file, then its category; on a CRLF working copy
// (core.autocrlf) every file it formats is reported, so a format diagnostic on
// a file whose bytes hold CRLF is the known issue and any other one is not.
function biomeDiagnostics(text) {
	return [
		...text.matchAll(/^(\S[^\n]*?) (format|lint\/\S+|assist\/\S+|parse) ━/gm),
	].map((match) => ({ file: match[1], category: match[2] }));
}

function hasCrlf(file) {
	try {
		return readFileSync(join(ROOT, file)).includes("\r\n");
	} catch {
		return false;
	}
}

function knownIssues(step, output) {
	if (!WINDOWS) return { known: [], others: 0 };
	const text = stripAnsi(output);
	if (step.id === "lint") {
		const diagnostics = biomeDiagnostics(text);
		const crlf = diagnostics.filter(
			(entry) => entry.category === "format" && hasCrlf(entry.file),
		);
		return {
			known:
				crlf.length > 0
					? [
							`biome on a CRLF working copy (core.autocrlf), ${crlf.length} file(s)`,
						]
					: [],
			others: diagnostics.length - crlf.length,
		};
	}
	if (
		step.id === "check-openapi" &&
		/spawnSync pnpm ENOENT|syscall: 'spawnSync pnpm'/.test(text)
	) {
		return {
			known: ["export-openapi.mjs spawns pnpm without its .cmd shim"],
			others: 0,
		};
	}
	const failures = text
		.split(/\r?\n/)
		.filter((line) => /^\s*FAIL\s+\S/.test(line) && line.includes(">"))
		.map((line) => line.trim());
	const unique = [...new Set(failures)];
	const known = KNOWN_WINDOWS_ISSUES.filter((issue) =>
		unique.some((line) => issue.failure.test(line)),
	).map((issue) => issue.label);
	const others = unique.filter(
		(line) => !KNOWN_WINDOWS_ISSUES.some((issue) => issue.failure.test(line)),
	).length;
	return { known, others };
}

async function runStep(step, logFile) {
	const environment = {
		...(step.unitEnvironment
			? withoutGates(baseEnvironment())
			: baseEnvironment()),
		...(step.environment ?? {}),
	};
	const log = createWriteStream(logFile);
	let code = 0;
	let output = "";
	for (const command of stepCommands(step)) {
		const result = await runCommand(step, command, environment, log);
		output = (output + result.output).slice(-OUTPUT_TAIL_BYTES);
		if (result.code !== 0 && code === 0) {
			code = result.code;
		}
	}
	await new Promise((resolve) => log.end(resolve));
	return { code, output };
}

function runCommand(step, { command, args, cwd: folder }, environment, log) {
	const cwd = join(ROOT, folder ?? ".");
	const banner = `$ (${relative(ROOT, cwd) || "."}) ${command} ${args.join(" ")}\n`;
	process.stdout.write(banner);
	log.write(`${banner}\n`);
	return new Promise((resolve) => {
		const child = WINDOWS
			? spawn(
					quote(command),
					args.map((value) => quote(String(value))),
					{
						cwd,
						env: environment,
						shell: true,
						windowsHide: true,
					},
				)
			: spawn(command, args, { cwd, env: environment });
		let tail = "";
		const collect = (chunk) => {
			const text = chunk.toString();
			process.stdout.write(text);
			log.write(text);
			tail = (tail + text).slice(-OUTPUT_TAIL_BYTES);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		const timer = setTimeout(
			() => {
				collect(
					`\nregression: step timed out after ${Math.round((step.timeout ?? 20 * MINUTE) / MINUTE)} min\n`,
				);
				if (WINDOWS) {
					spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
						stdio: "ignore",
					});
				} else {
					child.kill("SIGTERM");
				}
			},
			step.timeout ?? 20 * MINUTE,
		);
		child.on("error", (error) => {
			collect(`\nregression: could not start ${command}: ${error.message}\n`);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, output: tail });
		});
	});
}

function formatDuration(milliseconds) {
	const seconds = Math.round(milliseconds / 1000);
	return seconds < 60
		? `${seconds} s`
		: `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

function table(rows) {
	const headers = ["#", "step", "result", "duration", "note"];
	const cells = rows.map((row, index) => [
		String(index + 1),
		row.id,
		row.result,
		row.result === "skip" ? "–" : formatDuration(row.durationMs),
		row.note ?? "",
	]);
	const widths = headers.map((header, column) =>
		Math.max(
			header.length,
			...cells.map((cell) =>
				Math.min(cell[column].length, column === 4 ? 200 : 60),
			),
		),
	);
	const line = (values) =>
		values
			.map((value, column) => value.padEnd(widths[column]))
			.join(" | ")
			.trimEnd();
	return [
		line(headers),
		widths.map((width) => "-".repeat(width)).join("-|-"),
		...cells.map(line),
	].join("\n");
}

function gitHead() {
	const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const pack = options.smoke ? "smoke" : "regression";
	let steps = options.smoke ? smokeSteps() : regressionSteps();
	if (options.only) steps = steps.filter((step) => options.only.has(step.id));
	steps = steps.filter((step) => !options.skip.has(step.id));

	if (options.list) {
		for (const step of steps) {
			const gate = step.gate ? step.gate() : null;
			process.stdout.write(
				`${step.id.padEnd(28)} [${step.level}] ${step.title}${gate === null ? "" : `\n    would skip: ${gate}`}\n`,
			);
			for (const { command, args, cwd } of stepCommands(step)) {
				process.stdout.write(
					`    ${cwd ? `(${cwd}) ` : ""}${command ?? "deno"} ${args.join(" ")}\n`,
				);
			}
		}
		return 0;
	}

	const startedAt = new Date();
	const reportDir =
		options.reportDir ??
		join(
			tmpdir(),
			"fnb-regression",
			`${startedAt.toISOString().replace(/[:.]/g, "-")}-${pack}`,
		);
	mkdirSync(reportDir, { recursive: true });

	const results = [];
	for (const [index, step] of steps.entries()) {
		const header = `[${index + 1}/${steps.length}] ${step.id}: ${step.title}`;
		const reason = step.gate ? step.gate() : null;
		if (reason !== null) {
			process.stdout.write(`\n==> ${header}\n    skipped: ${reason}\n`);
			results.push({
				id: step.id,
				title: step.title,
				level: step.level,
				result: "skip",
				durationMs: 0,
				note: reason,
			});
			continue;
		}
		process.stdout.write(`\n==> ${header}\n`);
		const began = Date.now();
		const logFile = join(
			reportDir,
			`${String(index + 1).padStart(2, "0")}-${step.id}.log`,
		);
		const { code, output } = await runStep(step, logFile);
		const durationMs = Date.now() - began;
		let note = "";
		if (code !== 0) {
			const issues = knownIssues(step, output);
			if (issues.known.length > 0) {
				note = `known environment issue: ${issues.known.join("; ")}${issues.others > 0 ? `; plus ${issues.others} other failure(s)` : ""}`;
			}
		}
		results.push({
			id: step.id,
			title: step.title,
			level: step.level,
			result: code === 0 ? "pass" : "fail",
			durationMs,
			exitCode: code,
			note,
			log: logFile,
		});
		process.stdout.write(
			`    ${code === 0 ? "pass" : `FAIL (exit ${code})`} in ${formatDuration(durationMs)}\n`,
		);
	}

	const finishedAt = new Date();
	const failed = results.filter((row) => row.result === "fail");
	const report = {
		pack,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		platform: process.platform,
		node: process.version,
		commit: gitHead(),
		counts: {
			pass: results.filter((row) => row.result === "pass").length,
			fail: failed.length,
			skip: results.filter((row) => row.result === "skip").length,
		},
		steps: results,
	};
	const reportFile = join(reportDir, "report.json");
	writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

	process.stdout.write(
		`\n${pack} pack summary (${formatDuration(report.durationMs)})\n\n${table(results)}\n\n`,
	);
	process.stdout.write(
		`${report.counts.pass} passed, ${report.counts.fail} failed, ${report.counts.skip} skipped. Report: ${reportFile}\n`,
	);
	const known = failed.filter((row) =>
		row.note.startsWith("known environment issue"),
	);
	if (known.length > 0) {
		process.stdout.write(
			`${known.length} failed step(s) carry known Windows environment issues; they stay red until fixed (see docs/test-plan.md section 2.13).\n`,
		);
	}
	return failed.length === 0 ? 0 : 1;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		process.stderr.write(
			`regression: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(2);
	},
);
