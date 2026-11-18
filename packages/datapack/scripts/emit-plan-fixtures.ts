import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type CanonicalValue, canonicalJson } from "../src/pack/canonical.js";
import { validatePack } from "../src/pack/invariants.js";
import type { DataPack } from "../src/pack/schema.js";
import { sealPack } from "../src/pack/seal.js";
import {
	derivedPlanFixtures,
	goldenPack,
	MINI_PACK_PATH,
	PLANS_DIRECTORY,
	PROMPT_EXAMPLE,
	planFixture,
	withPackId,
} from "../test/plan/fixture-plans.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const biome = createRequire(join(repositoryRoot, "package.json")).resolve(
	"@biomejs/biome/bin/biome",
);

function formatted(path: string, text: string): string {
	return execFileSync(
		process.execPath,
		[
			biome,
			"format",
			`--stdin-file-path=${relative(repositoryRoot, path).split(sep).join("/")}`,
		],
		{ input: text, encoding: "utf8", cwd: repositoryRoot },
	);
}

const draft = JSON.parse(readFileSync(MINI_PACK_PATH, "utf8")) as DataPack;
const sealed = await sealPack({ ...draft, pack_id: "" });
const validation = await validatePack(sealed.pack);
if (!validation.valid) {
	throw new Error(
		`mini-pack.json is not valid: ${validation.issues.map((issue) => `${issue.code} at ${issue.path}`).join(", ")}`,
	);
}
writeFileSync(
	MINI_PACK_PATH,
	formatted(
		MINI_PACK_PATH,
		canonicalJson(sealed.pack as unknown as CanonicalValue),
	),
);
writeFileSync(
	join(PLANS_DIRECTORY, PROMPT_EXAMPLE),
	withPackId(planFixture(PROMPT_EXAMPLE), sealed.packId),
);
for (const [name, text] of Object.entries(derivedPlanFixtures(goldenPack()))) {
	writeFileSync(join(PLANS_DIRECTORY, name), text);
}
process.stdout.write(
	`mini-pack.json: ${sealed.estimatedTokens} estimated tokens, pack ${sealed.packId.slice(0, 8)}; ${PROMPT_EXAMPLE} and the sample plan fixtures written\n`,
);
