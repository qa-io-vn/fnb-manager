import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_IN_REPOSITORY = "docs/api/openapi.json";
const OUTPUT = join(REPOSITORY_ROOT, OUTPUT_IN_REPOSITORY);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const TOKEN_LIFETIME_SECONDS = 300;
const DOCUMENTED_HOST = "127.0.0.1:54321";
const DOCUMENTED_TITLE = "FNB Manager database API";
const DOCUMENTED_DESCRIPTION =
	"The REST API that PostgREST serves for the public schema, as the role authenticated sees it: the report and analytics functions under /rpc and the tables and views. Every call needs the publishable key and a signed-in session; row-level security limits each member to its tenant and stores. docs/api.md is the full reference, with the roles, the security model and examples.";

function localStackStatus() {
	const output = execFileSync(
		"pnpm",
		["exec", "supabase", "status", "-o", "env"],
		{
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	const values = new Map();
	for (const line of output.split("\n")) {
		const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
		if (match) values.set(match[1], match[2]);
	}
	const apiUrl = values.get("API_URL");
	const jwtSecret = values.get("JWT_SECRET");
	const apiKey = values.get("PUBLISHABLE_KEY") ?? values.get("ANON_KEY");
	if (!apiUrl || !jwtSecret || !apiKey) {
		throw new Error(
			"The local Supabase stack is not running: start it with 'pnpm db:start'.",
		);
	}
	if (!LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
		throw new Error(
			`Refusing to export from ${new URL(apiUrl).host}: only the local stack is allowed.`,
		);
	}
	return { apiUrl, jwtSecret, apiKey };
}

function base64Url(value) {
	return Buffer.from(value).toString("base64url");
}

function authenticatedRoleToken(secret) {
	const issuedAt = Math.floor(Date.now() / 1000);
	const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64Url(
		JSON.stringify({
			role: "authenticated",
			aud: "authenticated",
			iat: issuedAt,
			exp: issuedAt + TOKEN_LIFETIME_SECONDS,
		}),
	);
	const signature = createHmac("sha256", secret)
		.update(`${header}.${payload}`)
		.digest("base64url");
	return `${header}.${payload}.${signature}`;
}

function sortedDeep(value) {
	if (Array.isArray(value)) return value.map(sortedDeep);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortedDeep(value[key])]),
		);
	}
	return value;
}

function assertMigrationsMatchTheRepository() {
	const output = execFileSync(
		"pnpm",
		["exec", "supabase", "migration", "list", "--output-format", "json"],
		{
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	const { migrations } = JSON.parse(output.slice(output.indexOf("{")));
	const unmatched = migrations.filter(
		(migration) => !migration.local || migration.local !== migration.remote,
	);
	if (unmatched.length > 0) {
		const names = unmatched
			.map((migration) => migration.local || migration.remote)
			.join(", ");
		throw new Error(
			`The local database and supabase/migrations differ (${names}): apply or commit them first, so the description matches the repository.`,
		);
	}
}

function formatWithBiome(source) {
	return execFileSync(
		join(REPOSITORY_ROOT, "node_modules", ".bin", "biome"),
		["format", `--stdin-file-path=${OUTPUT_IN_REPOSITORY}`],
		{ input: source, encoding: "utf8", cwd: REPOSITORY_ROOT },
	);
}

export async function renderOpenApi() {
	const { apiUrl, jwtSecret, apiKey } = localStackStatus();
	assertMigrationsMatchTheRepository();
	const response = await fetch(`${apiUrl}/rest/v1/`, {
		headers: {
			apikey: apiKey,
			Authorization: `Bearer ${authenticatedRoleToken(jwtSecret)}`,
			Accept: "application/openapi+json",
		},
	});
	if (!response.ok) throw new Error(`PostgREST answered ${response.status}`);
	const description = await response.json();
	description.host = DOCUMENTED_HOST;
	description.info = {
		...description.info,
		title: DOCUMENTED_TITLE,
		description: DOCUMENTED_DESCRIPTION,
	};
	return formatWithBiome(
		`${JSON.stringify(sortedDeep(description), null, "\t")}\n`,
	);
}

async function main() {
	const check = process.argv.includes("--check");
	const rendered = await renderOpenApi();
	if (check) {
		const current = await readFile(OUTPUT, "utf8").catch(() => "");
		if (current !== rendered) {
			console.error(
				"docs/api/openapi.json is out of date: run pnpm docs:openapi",
			);
			process.exitCode = 1;
			return;
		}
		console.log("openapi: docs/api/openapi.json is current");
		return;
	}
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, rendered);
	console.log(`openapi: wrote ${OUTPUT}`);
}

await main();
