// node --test scripts/security-audit.test.mjs: the allow-list rules of the dependency audit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { advisoriesOf, evaluate, parseAllowlist } from "./security-audit.mjs";

const SCRIPT = fileURLToPath(new URL("./security-audit.mjs", import.meta.url));
const ID = "GHSA-2222-3333-4444";
const OTHER = "GHSA-5555-6666-7777";

function report(...entries) {
	return {
		advisories: Object.fromEntries(
			entries.map(([id, module_name, severity], index) => [
				String(index + 1),
				{
					id: index + 1,
					github_advisory_id: id,
					module_name,
					severity,
					title: `synthetic ${index + 1}`,
				},
			]),
		),
	};
}

function entry(overrides = {}) {
	return {
		id: ID,
		package: "synthetic-package",
		reason: "not reachable from shipped code",
		reviewed_by: "synthetic reviewer",
		reviewed_on: "2026-11-19",
		expires_on: "2027-05-19",
		...overrides,
	};
}

test("an advisory on the allow-list for its package is accepted, any other is refused", () => {
	const advisories = advisoriesOf(
		report(
			[ID, "synthetic-package", "high"],
			[ID, "other-package", "high"],
			[OTHER, "synthetic-package", "low"],
		),
	);
	const result = evaluate(advisories, [entry()], "2026-11-20");
	assert.deepEqual(
		result.accepted.map((a) => `${a.id}/${a.package}`),
		[`${ID}/synthetic-package`],
	);
	assert.deepEqual(
		result.refused.map((a) => `${a.id}/${a.package}`),
		[`${ID}/other-package`, `${OTHER}/synthetic-package`],
	);
});

test("an expired acceptance accepts nothing and is reported", () => {
	const result = evaluate(
		advisoriesOf(report([ID, "synthetic-package", "high"])),
		[entry({ expires_on: "2026-11-19", reviewed_on: "2026-05-19" })],
		"2026-11-20",
	);
	assert.equal(result.accepted.length, 0);
	assert.equal(result.refused.length, 1);
	assert.equal(result.expired.length, 1);
});

test("an acceptance no longer reported is listed as unused", () => {
	const result = evaluate([], [entry()], "2026-11-20");
	assert.equal(result.unused.length, 1);
});

test("the allow-list refuses incomplete or malformed entries", () => {
	for (const bad of [
		{ accepted: [entry({ reason: "" })] },
		{ accepted: [entry({ id: "CVE-2026-0001" })] },
		{ accepted: [entry({ expires_on: "2026-11-01" })] },
		{ accepted: [entry({ reviewed_on: "19/11/2026" })] },
		{ entries: [] },
	]) {
		assert.throws(() => parseAllowlist(JSON.stringify(bad)));
	}
	assert.equal(
		parseAllowlist(JSON.stringify({ accepted: [entry()] })).length,
		1,
	);
});

test("the command exits 1 on a refused advisory and 0 on a clean report", () => {
	const folder = mkdtempSync(join(tmpdir(), "security-audit-"));
	try {
		const allowlist = join(folder, "allow.json");
		writeFileSync(allowlist, JSON.stringify({ accepted: [] }));
		const dirty = join(folder, "dirty.json");
		writeFileSync(
			dirty,
			JSON.stringify(report([OTHER, "synthetic-package", "critical"])),
		);
		const clean = join(folder, "clean.json");
		writeFileSync(clean, JSON.stringify(report()));
		assert.throws(
			() =>
				execFileSync(
					process.execPath,
					[SCRIPT, "--report", dirty, "--allowlist", allowlist],
					{ stdio: "pipe" },
				),
			(error) => error.status === 1,
		);
		const output = execFileSync(
			process.execPath,
			[SCRIPT, "--report", clean, "--allowlist", allowlist],
			{ encoding: "utf8" },
		);
		assert.match(output, /0 advisories, 0 accepted, 0 refused/);
		assert.throws(
			() =>
				execFileSync(process.execPath, [SCRIPT, "--bogus"], { stdio: "pipe" }),
			(error) => error.status === 2,
		);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
