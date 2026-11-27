// Fails the build when the counter's bundle carries a secret (ADR-066, security): a secret or service-role key, a JWT
// that is not the public anon key, an App secret variable, a private key, an e-mail address or a UUID that is not
// synthetic. The publishable key is public by design and allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const TEXT = new Set([
	".js",
	".css",
	".html",
	".json",
	".webmanifest",
	".svg",
	".txt",
	".map",
]);

function jwtRole(token) {
	try {
		const payload = JSON.parse(
			Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
		);
		return typeof payload.role === "string" ? payload.role : null;
	} catch {
		return null;
	}
}

const rules = [
	{
		name: "secret key",
		pattern: /\bsb_secret_[A-Za-z0-9_-]{6,}/g,
		allowed: () => false,
	},
	{
		name: "service role",
		pattern: /service_role[A-Za-z0-9_.-]*\.[A-Za-z0-9_-]{20,}/g,
		allowed: () => false,
	},
	{
		name: "jwt",
		pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		allowed: (match) => jwtRole(match) === "anon",
	},
	{
		name: "app secret variable",
		pattern: /ZALO_APP_SECRET_[A-Z0-9_]+\s*[:=]\s*["'][^"']+["']/g,
		allowed: () => false,
	},
	{
		name: "private key",
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
		allowed: () => false,
	},
	{
		name: "e-mail address",
		pattern:
			/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(com|vn|net|org|io)\b/g,
		allowed: () => false,
	},
	{
		name: "uuid",
		pattern:
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
		allowed: (match) =>
			/^([0-9a-f])\1{7}-/i.test(match) ||
			/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(match),
	},
];

function files(directory) {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

let findings = 0;
for (const path of files(root)) {
	if (!TEXT.has(extname(path))) continue;
	const text = readFileSync(path, "utf8");
	for (const rule of rules) {
		for (const match of text.matchAll(rule.pattern)) {
			if (rule.allowed(match[0])) continue;
			findings += 1;
			console.error(
				`${relative(root, path)}: ${rule.name}: ${match[0].slice(0, 12)}…`,
			);
		}
	}
}
if (findings > 0) {
	console.error(`check-bundle: ${findings} finding(s)`);
	process.exit(1);
}
console.log("check-bundle: no secrets in the counter's bundle");
