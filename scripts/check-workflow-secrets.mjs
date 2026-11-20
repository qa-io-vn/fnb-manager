#!/usr/bin/env node
// NFR-SEC-08: a cloud secret is exposed only to the steps that use it, never to a whole workflow or job.
//
//   node scripts/check-workflow-secrets.mjs              check every file in .github/workflows
//   node scripts/check-workflow-secrets.mjs --self-test  check the rule on planted workflows
//
// It reads the workflow files as indented text: an `env:` map at the top level or directly under a job that names
// `secrets.` is a finding, as is a job-level `secrets: inherit`. Step-level `env:` and `with:` maps are allowed.
// It prints `file:line` and the variable, never a value, and exits 1 on any finding.
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function indentOf(line) {
	return line.length - line.trimStart().length;
}

/** Findings for one workflow text: `{ line, scope, name }` per secret outside a step. */
export function findWideSecrets(text) {
	const lines = text.replace(/\r/g, "").split("\n");
	const findings = [];
	let inJobs = false;
	let jobIndent = -1;
	let envBlock = null;
	lines.forEach((raw, index) => {
		const line = raw.replace(/\s+#.*$/, "");
		if (line.trim() === "" || line.trimStart().startsWith("#")) return;
		const indent = indentOf(line);
		if (envBlock !== null && indent <= envBlock.indent) envBlock = null;
		if (indent === 0) {
			inJobs = /^jobs:\s*$/.test(line);
			jobIndent = -1;
			if (/^env:\s*$/.test(line)) envBlock = { indent: 0, scope: "workflow" };
			return;
		}
		if (inJobs && jobIndent === -1 && /^\s+[\w-]+:\s*$/.test(line)) {
			jobIndent = indent;
		}
		if (inJobs && indent === jobIndent + 2 && jobIndent !== -1) {
			if (/^\s+env:\s*$/.test(line)) {
				envBlock = { indent, scope: "job" };
				return;
			}
			if (/^\s+secrets:\s*inherit\s*$/.test(line)) {
				findings.push({
					line: index + 1,
					scope: "job",
					name: "secrets: inherit",
				});
			}
		}
		if (envBlock !== null && /\bsecrets\./.test(line)) {
			findings.push({
				line: index + 1,
				scope: envBlock.scope,
				name: line.trim().split(":")[0],
			});
		}
	});
	return findings;
}

export function checkDirectory(directory) {
	const findings = [];
	for (const name of readdirSync(directory).sort()) {
		if (!/\.ya?ml$/.test(name)) continue;
		const text = readFileSync(join(directory, name), "utf8");
		for (const finding of findWideSecrets(text)) {
			findings.push({ file: name, ...finding });
		}
	}
	return findings;
}

function report(findings, label) {
	for (const finding of findings) {
		console.error(
			`${label}/${finding.file}:${finding.line}: ${finding.scope}-level secret ${finding.name}; move it to the steps that use it`,
		);
	}
}

function secretRef(name) {
	return ["$", "{{ secrets.", name, " }}"].join("");
}

function selfTest() {
	const folder = mkdtempSync(join(tmpdir(), "workflow-secrets-"));
	const failures = [];
	try {
		const fixtures = {
			"job-level.yml": [
				"name: planted",
				"jobs:",
				"  build:",
				"    runs-on: ubuntu-latest",
				"    env:",
				`      TOKEN: ${secretRef("TOKEN")}`,
				"      PLAIN: value",
				"    steps:",
				"      - run: echo",
			],
			"workflow-level.yml": [
				"name: planted",
				"env:",
				`  PASSWORD: ${secretRef("PASSWORD")}`,
				"jobs:",
				"  build:",
				"    runs-on: ubuntu-latest",
				"    steps:",
				"      - run: echo",
			],
			"inherit.yml": [
				"name: planted",
				"jobs:",
				"  call:",
				"    uses: ./.github/workflows/other.yml",
				"    secrets: inherit",
			],
			"step-level.yml": [
				"name: allowed",
				"env:",
				"  PLAIN: value",
				"jobs:",
				"  build:",
				"    runs-on: ubuntu-latest",
				"    env:",
				"      CI: '1'",
				"    steps:",
				"      - name: Link",
				"        env:",
				`          TOKEN: ${secretRef("TOKEN")}`,
				"        run: echo",
				"      - uses: some/action@v1",
				"        with:",
				`          token: ${secretRef("TOKEN")}`,
				"  second:",
				"    runs-on: ubuntu-latest",
				"    steps:",
				"      - name: Check",
				"        env:",
				`          ID: ${secretRef("ID")}`,
				"        run: echo",
			],
		};
		for (const [name, lines] of Object.entries(fixtures)) {
			writeFileSync(join(folder, name), `${lines.join("\n")}\n`);
		}
		const findings = checkDirectory(folder);
		const summary = findings.map(
			(finding) =>
				`${finding.file}:${finding.line}:${finding.scope}:${finding.name}`,
		);
		const wanted = [
			"inherit.yml:5:job:secrets: inherit",
			"job-level.yml:6:job:TOKEN",
			"workflow-level.yml:3:workflow:PASSWORD",
		];
		if (JSON.stringify(summary) !== JSON.stringify(wanted)) {
			failures.push(
				`findings ${JSON.stringify(summary)}, wanted ${JSON.stringify(wanted)}`,
			);
		}
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
	if (failures.length > 0) {
		for (const failure of failures) console.error(`self-test: ${failure}`);
		process.exit(1);
	}
	console.log("check-workflow-secrets self-test: all checks passed");
}

function main(argv) {
	if (argv.includes("--self-test")) {
		selfTest();
		return;
	}
	const findings = checkDirectory(join(ROOT, ".github", "workflows"));
	if (findings.length > 0) {
		report(findings, ".github/workflows");
		process.exit(1);
	}
	console.log("check-workflow-secrets: no workflow- or job-level secret");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main(process.argv.slice(2));
}
