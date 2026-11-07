import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const ignoredPrefixes = [
	"node_modules/",
	"dist/",
	"docs/private/",
	".playwright-mcp/",
	"supabase/.temp/",
	"supabase/.branches/",
	"pnpm-lock.yaml",
	"scripts/check-public-safe.mjs",
];
const binaryExtensions = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".pdf",
	".woff",
	".woff2",
	".ttf",
	".zip",
	".gz",
]);
const maxFileBytes = 2_000_000;

const allowedEmailDomains = [
	"example.com",
	"example.org",
	"users.noreply.github.com",
	"email.com",
];
const syntheticUuidPattern = /^([0-9a-f])\1{7}-/i;
const syntheticHexKeyPatterns = [
	/^([0-9a-f])\1{31}$/i,
	/^(0123456789abcdef){2}$/i,
];

const rules = [
	{
		name: "email address",
		pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
		isAllowed: (match) =>
			allowedEmailDomains.some((domain) =>
				match.toLowerCase().endsWith(`@${domain}`),
			),
	},
	{
		name: "uuid",
		pattern:
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		isAllowed: (match) =>
			syntheticUuidPattern.test(match) || /^0{8}-/.test(match),
	},
	{
		name: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
		isAllowed: () => false,
	},
	{
		name: "secret key prefix",
		pattern:
			/\b(sb_secret_[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g,
		isAllowed: () => false,
	},
	{
		name: "32-hex app key",
		pattern: /\b[0-9a-f]{32}\b/gi,
		isAllowed: (match) =>
			syntheticHexKeyPatterns.some((pattern) => pattern.test(match)),
	},
	{
		name: "vietnamese phone number",
		pattern: /\+84\d{9,10}\b/g,
		isAllowed: () => false,
	},
];

const privateIdentifierFile = join(repoRoot, "docs/private/identifiers.txt");
const privateIdentifiers = existsSync(privateIdentifierFile)
	? readFileSync(privateIdentifierFile, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length >= 4)
	: [];

function trackedFiles() {
	try {
		const output = execFileSync(
			"git",
			["ls-files", "--cached", "--others", "--exclude-standard"],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		return output.split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

function isIgnored(file) {
	return ignoredPrefixes.some(
		(prefix) => file === prefix || file.startsWith(prefix),
	);
}

function isScannable(file) {
	const absolute = join(repoRoot, file);
	if (!existsSync(absolute)) return false;
	const stats = statSync(absolute);
	if (!stats.isFile() || stats.size > maxFileBytes) return false;
	const dot = file.lastIndexOf(".");
	const extension = dot >= 0 ? file.slice(dot).toLowerCase() : "";
	return !binaryExtensions.has(extension);
}

const findings = [];
for (const file of trackedFiles()) {
	if (isIgnored(file) || !isScannable(file)) continue;
	const content = readFileSync(join(repoRoot, file), "utf8");
	const lines = content.split("\n");
	lines.forEach((line, index) => {
		for (const rule of rules) {
			for (const match of line.matchAll(rule.pattern)) {
				if (!rule.isAllowed(match[0], file)) {
					findings.push({
						file,
						line: index + 1,
						rule: rule.name,
						sample: match[0].slice(0, 12),
					});
				}
			}
		}
		for (const identifier of privateIdentifiers) {
			if (line.toLowerCase().includes(identifier.toLowerCase())) {
				findings.push({
					file,
					line: index + 1,
					rule: "private identifier",
					sample: identifier.slice(0, 4),
				});
			}
		}
	});
}

if (findings.length === 0) {
	console.log("public-safe scan: no findings");
	process.exit(0);
}

for (const finding of findings) {
	console.log(
		`${relative(repoRoot, join(repoRoot, finding.file))}:${finding.line} ${finding.rule} (${finding.sample}…)`,
	);
}
console.log(`public-safe scan: ${findings.length} finding(s)`);
process.exit(1);
