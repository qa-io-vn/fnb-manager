import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const MAX_VERSION_BYTES = 10_000_000;
export const MAX_FILE_BYTES = 3_000_000;
export const FORBIDDEN_PACKAGES = ["echarts", "zrender"];

export function listFiles(directory) {
	const files = [];
	const walk = (current) => {
		for (const name of readdirSync(current)) {
			const path = join(current, name);
			const stats = statSync(path);
			if (stats.isDirectory()) walk(path);
			else
				files.push({
					path: relative(directory, path).split(sep).join("/"),
					bytes: stats.size,
				});
		}
	};
	walk(directory);
	return files.sort(
		(a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path),
	);
}

export function checkSizes(files, limits = {}) {
	const maxVersionBytes = limits.maxVersionBytes ?? MAX_VERSION_BYTES;
	const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES;
	const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
	const problems = [];
	if (files.length === 0) problems.push("the build folder is empty");
	if (totalBytes > maxVersionBytes) {
		problems.push(
			`the version is ${megabytes(totalBytes)}, over the ${megabytes(maxVersionBytes)} budget`,
		);
	}
	for (const file of files) {
		if (file.bytes > maxFileBytes) {
			problems.push(
				`${file.path} is ${megabytes(file.bytes)}, over the ${megabytes(maxFileBytes)} per-file budget`,
			);
		}
	}
	return { totalBytes, largest: files[0] ?? null, problems };
}

function megabytes(bytes) {
	return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function readManifest(directory) {
	return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function packageDirectory(fromDirectory, name) {
	let current = fromDirectory;
	while (true) {
		const candidate = join(current, "node_modules", name);
		if (existsSync(join(candidate, "package.json")))
			return realpathSync(candidate);
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function runtimeDependencies(manifest, includePeers) {
	return [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...(includePeers ? Object.keys(manifest.peerDependencies ?? {}) : []),
	];
}

export function findForbiddenPackages(
	appDirectory,
	forbidden = FORBIDDEN_PACKAGES,
) {
	const root = realpathSync(appDirectory);
	const found = [];
	const seen = new Set([root]);
	const queue = [
		{ directory: root, chain: [readManifest(root).name ?? "."], root: true },
	];
	while (queue.length > 0) {
		const { directory, chain, root: isRoot } = queue.shift();
		const manifest = readManifest(directory);
		for (const name of new Set(runtimeDependencies(manifest, !isRoot))) {
			if (forbidden.includes(name)) {
				found.push([...chain, name].join(" > "));
				continue;
			}
			const dependency = packageDirectory(directory, name);
			if (!dependency || seen.has(dependency)) continue;
			seen.add(dependency);
			queue.push({
				directory: dependency,
				chain: [...chain, name],
				root: false,
			});
		}
	}
	return found;
}

function run(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			app: { type: "string", default: "." },
			dist: { type: "string", multiple: true },
		},
	});
	const appDirectory = resolve(values.app);
	const problems = [];
	for (const chain of findForbiddenPackages(appDirectory)) {
		problems.push(`a forbidden package is in the dependency graph: ${chain}`);
	}
	for (const dist of values.dist ?? ["dist"]) {
		const directory = resolve(appDirectory, dist);
		if (!existsSync(directory)) {
			problems.push(`${dist} does not exist; build first`);
			continue;
		}
		const files = listFiles(directory);
		const result = checkSizes(files);
		console.log(
			`budget: ${dist}: ${files.length} files, ${megabytes(result.totalBytes)} of ${megabytes(MAX_VERSION_BYTES)}; largest ${result.largest?.path ?? "none"} ${megabytes(result.largest?.bytes ?? 0)} of ${megabytes(MAX_FILE_BYTES)}`,
		);
		problems.push(...result.problems.map((problem) => `${dist}: ${problem}`));
	}
	for (const problem of problems) console.error(`budget: ${problem}`);
	return problems.length === 0 ? 0 : 1;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = run(process.argv.slice(2));
}
