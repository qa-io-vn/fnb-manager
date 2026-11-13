import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const repoRoot = process.cwd();
const functionsRoot = join(repoRoot, "supabase", "functions");
const packagesRoot = join(repoRoot, "packages");
const workspaceScope = "@fnb/";
const walkerPattern =
	/(?:import|export)\s+(?:type\s+)?(?:{[^{}]+}|.*?)\s*(?:from)?\s*['"](.*?)['"]|import\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')\s*[,)]/gi;
const declarationPattern =
	/(?:^|[;\s])(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']|(?:^|[;\s])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function toPosix(path) {
	return path.split(sep).join("/");
}

function relativeSpecifier(fromDirectory, target) {
	const path = toPosix(relative(fromDirectory, target));
	return path.startsWith(".") ? path : `./${path}`;
}

function matches(pattern, source) {
	pattern.lastIndex = 0;
	return [...source.matchAll(pattern)]
		.map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim())
		.filter((specifier) => specifier !== "");
}

function specifiersOf(source) {
	const relativeOnes = matches(walkerPattern, source).filter(isRelative);
	const declared = matches(declarationPattern, source);
	return [...new Set([...relativeOnes, ...declared])];
}

function isRelative(specifier) {
	return specifier.startsWith("./") || specifier.startsWith("../");
}

function isRuntimeSpecifier(specifier) {
	return /^(node|npm|jsr|https?):/.test(specifier);
}

function packageNameOf(specifier) {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function workspaceEntry(specifier) {
	const name = packageNameOf(specifier);
	const directory = join(packagesRoot, name.slice(workspaceScope.length));
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	);
	const subpath = `.${specifier.slice(name.length)}`;
	const exported = manifest.exports?.[subpath];
	const target =
		typeof exported === "string" ? exported : (exported?.import ?? null);
	if (manifest.name !== name || target === null) {
		throw new Error(`${specifier} is not exported by packages/${name}`);
	}
	return join(directory, target);
}

function installedVersion(importer, name) {
	let directory = dirname(importer);
	while (directory.startsWith(repoRoot)) {
		const manifest = join(directory, "node_modules", name, "package.json");
		if (existsSync(manifest)) {
			return JSON.parse(readFileSync(manifest, "utf8")).version;
		}
		directory = dirname(directory);
	}
	throw new Error(
		`${name}, imported by ${toPosix(relative(repoRoot, importer))}, is not installed; run pnpm install`,
	);
}

function functionSources(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return functionSources(path);
		}
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

function buildImportMap(functionDirectory) {
	const workspace = new Map();
	const npm = new Map();
	const rewrites = new Map();
	const scopes = new Map();
	const queue = [];
	const seen = new Set();

	const addBare = (specifier, importer) => {
		if (specifier.startsWith(workspaceScope)) {
			const entry = workspaceEntry(specifier);
			workspace.set(specifier, entry);
			queue.push(entry);
			return;
		}
		const name = packageNameOf(specifier);
		if (specifier !== name) {
			throw new Error(
				`${specifier} is a subpath import of an npm package; add it to scripts/function-imports.mjs first`,
			);
		}
		const version = installedVersion(importer, name);
		const known = npm.get(name);
		if (known !== undefined && known !== version) {
			throw new Error(
				`${name} resolves to ${known} and ${version} in different packages`,
			);
		}
		npm.set(name, version);
	};

	for (const source of functionSources(functionDirectory)) {
		for (const specifier of specifiersOf(readFileSync(source, "utf8"))) {
			if (!isRelative(specifier) && !isRuntimeSpecifier(specifier)) {
				addBare(specifier, source);
			}
		}
	}

	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) {
			continue;
		}
		seen.add(file);
		for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
			if (isRuntimeSpecifier(specifier)) {
				continue;
			}
			if (!isRelative(specifier)) {
				addBare(specifier, file);
				continue;
			}
			const target = resolve(dirname(file), specifier);
			if (existsSync(target)) {
				queue.push(target);
				continue;
			}
			const typescript = target.replace(/\.js$/, ".ts");
			if (!target.endsWith(".js") || !existsSync(typescript)) {
				throw new Error(
					`${toPosix(relative(repoRoot, file))} imports ${specifier}, which does not exist`,
				);
			}
			rewrites.set(target, typescript);
			const directory = `${dirname(file)}${sep}`;
			const scope = scopes.get(directory) ?? new Map();
			scope.set(specifier, typescript);
			scopes.set(directory, scope);
			queue.push(typescript);
		}
	}

	const sorted = (entries) =>
		Object.fromEntries(
			[...entries].sort(([left], [right]) =>
				left < right ? -1 : left > right ? 1 : 0,
			),
		);
	const local = (path) => relativeSpecifier(functionDirectory, path);
	const imports = sorted([
		...[...workspace].map(([specifier, path]) => [specifier, local(path)]),
		...[...npm].map(([name, version]) => [name, `npm:${name}@${version}`]),
		...[...rewrites].map(([from, to]) => [local(from), local(to)]),
	]);
	const scopeEntries = sorted(
		[...scopes].map(([directory, mapping]) => [
			`${local(directory)}/`,
			sorted([...mapping].map(([specifier, to]) => [specifier, local(to)])),
		]),
	);
	return { imports, scopes: scopeEntries };
}

function functionDirectories(names) {
	const all = readdirSync(functionsRoot, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(join(functionsRoot, entry.name, "deno.json")),
		)
		.map((entry) => entry.name)
		.sort();
	const chosen = names.length > 0 ? names : all;
	for (const name of chosen) {
		if (!all.includes(name)) {
			throw new Error(`supabase/functions/${name}/deno.json does not exist`);
		}
	}
	return chosen.map((name) => join(functionsRoot, name));
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const names = args.filter((arg) => arg !== "--check");
let stale = 0;
for (const directory of functionDirectories(names)) {
	const configPath = join(directory, "deno.json");
	const current = readFileSync(configPath, "utf8");
	const config = JSON.parse(current);
	const { imports, scopes } = buildImportMap(directory);
	const next = `${JSON.stringify({ ...config, imports, scopes }, null, "\t")}\n`;
	const label = toPosix(relative(repoRoot, configPath));
	if (next === current) {
		console.log(`${label}: up to date`);
	} else if (check) {
		stale += 1;
		console.error(
			`${label}: out of date; run node scripts/function-imports.mjs`,
		);
	} else {
		writeFileSync(configPath, next);
		console.log(`${label}: written`);
	}
}
process.exit(stale === 0 ? 0 : 1);
