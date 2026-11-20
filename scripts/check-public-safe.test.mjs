import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
	new URL("./check-public-safe.mjs", import.meta.url),
);
const TERM = "Qzxwvu Ployk";

function repository(withList) {
	const root = mkdtempSync(join(tmpdir(), "public-safe-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), "docs/private/\n");
	mkdirSync(join(root, "docs", "private"), { recursive: true });
	if (withList) {
		writeFileSync(
			join(root, "docs", "private", "forbidden-terms.txt"),
			`${TERM}\nx\n`,
		);
	}
	writeFileSync(
		join(root, "notes.md"),
		"Line one.\nWe met QZXWVU   PLOYK today.\n".replace("   ", " "),
	);
	writeFileSync(join(root, "decomposed.md"), "qzxwvu ployk".normalize("NFD"));
	writeFileSync(join(root, "qzxwvu ployk.md"), "nothing here\n");
	writeFileSync(
		join(root, "longer.md"),
		"qzxwvu ploykish and aqzxwvu ployk are other words\n",
	);
	return root;
}

function scan(root) {
	return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
}

test("a listed term is refused as a whole word in contents and paths, ignoring case, and never printed", () => {
	const root = repository(true);
	try {
		const run = scan(root);
		assert.equal(run.status, 1);
		assert.match(run.stdout, /notes\.md:2 forbidden term$/m);
		assert.match(run.stdout, /decomposed\.md:1 forbidden term$/m);
		assert.match(
			run.stdout,
			/^\(git ls-files entry \d+, path withheld\):0 forbidden term in path$/m,
		);
		assert.doesNotMatch(run.stdout, /longer\.md/);
		assert.doesNotMatch(run.stdout.toLowerCase(), /qzx|ployk/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("without the private list the rule is skipped", () => {
	const root = repository(false);
	try {
		const run = scan(root);
		assert.equal(run.status, 0);
		assert.match(run.stdout, /no findings/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
