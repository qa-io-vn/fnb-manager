import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(join(appRoot, "dist", "index.html"), "utf8");
const env = loadEnv("production", appRoot, "VITE_");
const url = env.VITE_SUPABASE_URL?.trim() ?? "";
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const live = url !== "" && key !== "";
const expectedOrigins = live ? [new URL(url).origin] : [];

const failures = [];
const metas = [
	...html.matchAll(
		/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi,
	),
];
if (metas.length !== 1) {
	failures.push(`expected one policy meta tag, found ${metas.length}`);
}
const headStart = html.indexOf("<head>");
const metaAt = metas[0]?.index ?? -1;
const firstScript = html.search(/<script\b/i);
if (metaAt !== -1 && firstScript !== -1 && metaAt > firstScript) {
	failures.push("the policy meta tag comes after a script");
}
if (metaAt !== -1 && headStart !== -1 && metaAt < headStart) {
	failures.push("the policy meta tag is outside the head");
}
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
	if (!/\bsrc=/.test(match[1] ?? "") || (match[2] ?? "").trim() !== "") {
		failures.push("an inline script is in dist/index.html");
	}
}
if (/\sstyle="/i.test(html) || /<style\b/i.test(html)) {
	failures.push("an inline style is in dist/index.html");
}
const policy = (metas[0]?.[1] ?? "")
	.replace(/&#39;/g, "'")
	.replace(/&quot;/g, '"');
const directives = new Map(
	policy
		.split(";")
		.map((part) => part.trim().split(/\s+/))
		.filter((parts) => parts[0])
		.map(([name, ...sources]) => [name, sources]),
);
const connect = directives.get("connect-src") ?? [];
const remote = connect.filter((source) => source !== "'self'");
if (!connect.includes("'self'")) failures.push("connect-src misses 'self'");
if (JSON.stringify(remote) !== JSON.stringify(expectedOrigins)) {
	failures.push(
		`connect-src names ${remote.length} remote origin(s); the ${live ? "live" : "demo"} build allows ${expectedOrigins.length}`,
	);
}
for (const [name, sources] of directives) {
	if (
		sources.some((source) => /unsafe-(inline|eval)|^\*$|^https?:$/.test(source))
	) {
		failures.push(`${name} allows an unsafe or wildcard source`);
	}
}
for (const name of ["default-src", "script-src", "object-src", "base-uri"]) {
	if (!directives.has(name)) failures.push(`the policy has no ${name}`);
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`policy check: ${failure}`);
	process.exit(1);
}
console.log(
	`policy check passed: one Content-Security-Policy meta tag, no inline script or style, connect-src 'self'${live ? " and the project's API origin" : " only (demo)"}`,
);
