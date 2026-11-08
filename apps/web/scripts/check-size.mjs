import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(appRoot, "dist");
const budgetBytes = 400 * 1000;
const lazySources = [
	/src\/components\/report-card\/echarts-view\.tsx$/,
	/src\/demo\/demo-row-source\.ts$/,
];

const manifest = JSON.parse(
	readFileSync(join(distRoot, ".vite", "manifest.json"), "utf8"),
);

function staticClosure(keys) {
	const seen = new Set();
	const visit = (key) => {
		if (seen.has(key)) return;
		seen.add(key);
		for (const imported of manifest[key]?.imports ?? []) visit(imported);
	};
	for (const key of keys) visit(key);
	return seen;
}

const entryKeys = Object.keys(manifest).filter((key) => manifest[key].isEntry);
const lazyKeys = Object.keys(manifest).filter((key) =>
	lazySources.some((pattern) => pattern.test(key)),
);
if (entryKeys.length === 0) {
	console.error("size check: no entry chunk in the manifest");
	process.exit(1);
}
if (lazyKeys.length !== lazySources.length) {
	console.error(
		"size check: the ECharts or demo chunk is missing; it may have been bundled into the initial JS",
	);
	process.exit(1);
}

const initialKeys = staticClosure(entryKeys);
const lazyOnlyFiles = new Set(
	[...staticClosure(lazyKeys)]
		.filter((key) => !initialKeys.has(key))
		.map((key) => manifest[key].file),
);

const jsFiles = readdirSync(join(distRoot, "assets"))
	.filter((name) => name.endsWith(".js"))
	.map((name) => `assets/${name}`);

const gzipSize = (file) => gzipSync(readFileSync(join(distRoot, file))).length;
const initialFiles = jsFiles.filter((file) => !lazyOnlyFiles.has(file));
const initialBytes = initialFiles.reduce(
	(total, file) => total + gzipSize(file),
	0,
);
const lazyBytes = [...lazyOnlyFiles].reduce(
	(total, file) => total + gzipSize(file),
	0,
);
const kilobytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

console.log(
	`size check: initial JS ${kilobytes(initialBytes)} gzipped in ${initialFiles.length} file(s), budget ${kilobytes(budgetBytes)}; lazily loaded ECharts and demo ${kilobytes(lazyBytes)} in ${lazyOnlyFiles.size} file(s)`,
);
if (initialBytes > budgetBytes) {
	console.error("size check failed: the initial JS exceeds the budget");
	process.exit(1);
}
