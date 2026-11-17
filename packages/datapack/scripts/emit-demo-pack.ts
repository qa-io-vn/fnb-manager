import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenPack, demoSource } from "../test/pack/support/demo.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const target = join(packageRoot, "test", "fixtures", "demo-pack.json");
const biome = createRequire(join(repositoryRoot, "package.json")).resolve(
	"@biomejs/biome/bin/biome",
);

const built = await buildGoldenPack(demoSource());
const formatted = execFileSync(
	process.execPath,
	[
		biome,
		"format",
		`--stdin-file-path=${relative(repositoryRoot, target).split(sep).join("/")}`,
	],
	{ input: built.text, encoding: "utf8", cwd: repositoryRoot },
);
writeFileSync(target, formatted);
process.stdout.write(
	`demo-pack.json: ${built.estimatedTokens} estimated tokens, pack ${built.packId.slice(0, 8)}\n`,
);
