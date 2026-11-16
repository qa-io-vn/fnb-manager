import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { dataPackSchema, planFrontMatterSchema } from "../src/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");

const outputs = [
	{
		file: "fnb-datapack-1.schema.json",
		id: "urn:fnb:datapack:1",
		schema: dataPackSchema,
	},
	{
		file: "fnb-plan-1.schema.json",
		id: "urn:fnb:plan:1",
		schema: planFrontMatterSchema,
	},
];

function formatWithBiome(source, path) {
	return execFileSync(
		join(repositoryRoot, "node_modules", ".bin", "biome"),
		["format", `--stdin-file-path=${relative(repositoryRoot, path)}`],
		{ input: source, encoding: "utf8", cwd: repositoryRoot },
	);
}

function jsonSchemaText(output) {
	const generated = z.toJSONSchema(output.schema, {
		target: "draft-2020-12",
		io: "input",
	});
	const { $schema, ...rest } = generated;
	return JSON.stringify({ $schema, $id: output.id, ...rest });
}

for (const output of outputs) {
	const path = join(packageRoot, "schema", output.file);
	writeFileSync(path, formatWithBiome(jsonSchemaText(output), path));
	console.info(`wrote schema/${output.file}`);
}
