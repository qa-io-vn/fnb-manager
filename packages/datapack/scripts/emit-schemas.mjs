import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchemaDocument, SCHEMA_DOCUMENTS } from "./schema-documents.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const biome = createRequire(join(repositoryRoot, "package.json")).resolve(
	"@biomejs/biome/bin/biome",
);

function formatWithBiome(source, path) {
	const inRepository = relative(repositoryRoot, path).split(sep).join("/");
	return execFileSync(
		process.execPath,
		[biome, "format", `--stdin-file-path=${inRepository}`],
		{ input: source, encoding: "utf8", cwd: repositoryRoot },
	);
}

for (const document of SCHEMA_DOCUMENTS) {
	const path = join(packageRoot, "schema", document.file);
	const text = JSON.stringify(jsonSchemaDocument(document));
	writeFileSync(path, formatWithBiome(text, path));
	console.info(`wrote schema/${document.file}`);
}
