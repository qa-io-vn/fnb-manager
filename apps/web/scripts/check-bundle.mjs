import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(appRoot, "dist");
const textExtensions = new Set([
	".js",
	".mjs",
	".css",
	".html",
	".json",
	".map",
	".txt",
	".svg",
	".webmanifest",
]);

const syntheticUuid = /^([0-9a-f])\1{7}-/i;
const nilUuid = /^0{8}-0{4}-0{4}-0{4}-0{12}$/i;
const syntheticHex = [/^([0-9a-f])\1{31}$/i, /^(0123456789abcdef){2}$/i];

const rules = [
	{
		name: "e-mail address",
		pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
		isAllowed: () => false,
	},
	{
		name: "uuid",
		pattern:
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		isAllowed: (match) => syntheticUuid.test(match) || nilUuid.test(match),
	},
	{
		name: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		isAllowed: () => false,
	},
	{
		name: "secret key",
		pattern:
			/\b(sb_secret_[A-Za-z0-9_-]{6,}|service_role[A-Za-z0-9_.-]*\.[A-Za-z0-9_-]{20,})/g,
		isAllowed: () => false,
	},
	{
		name: "32-hex key",
		pattern: /\b[0-9a-f]{32}\b/gi,
		isAllowed: (match) => syntheticHex.some((pattern) => pattern.test(match)),
	},
];

function filesUnder(directory) {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

function allowedExactValues() {
	const env = loadEnv("production", appRoot, "VITE_");
	return [env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_SUPABASE_URL]
		.map((value) => value?.trim() ?? "")
		.filter((value) => value.length > 0)
		.sort((left, right) => right.length - left.length);
}

function withoutAllowedValues(content, allowed) {
	return allowed.reduce((text, value) => text.split(value).join(" "), content);
}

function scan() {
	const allowed = allowedExactValues();
	const findings = [];
	for (const file of filesUnder(distRoot)) {
		if (!textExtensions.has(extname(file))) continue;
		const content = withoutAllowedValues(readFileSync(file, "utf8"), allowed);
		for (const rule of rules) {
			for (const match of content.matchAll(rule.pattern)) {
				if (!rule.isAllowed(match[0])) {
					findings.push({
						file: relative(appRoot, file),
						rule: rule.name,
						length: match[0].length,
					});
				}
			}
		}
	}
	return { findings, allowedCount: allowed.length };
}

const { findings, allowedCount } = scan();
if (findings.length > 0) {
	for (const finding of findings) {
		console.error(
			`bundle check: ${finding.rule} (${finding.length} characters) in ${finding.file}`,
		);
	}
	console.error(
		`bundle check failed: ${findings.length} finding(s); values are not printed`,
	);
	process.exit(1);
}
console.log(
	`bundle check passed: no e-mail, non-synthetic UUID or secret-shaped string in dist (${allowedCount} configured value(s) allowed by exact match)`,
);
