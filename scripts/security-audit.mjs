#!/usr/bin/env node
// The dependency audit of the security workflow (.github/workflows/security.yml, docs/test-plan.md 2.11).
//
// Runs `pnpm audit --prod --json` (the packages that ship: the web bundle, the Mini Apps, the jobs and the Edge
// Functions' shared code) and fails on every advisory that the reviewed allow-list does not accept. An accepted
// advisory names its GitHub advisory id, the package, why it does not apply or cannot be fixed yet, who reviewed it
// and when the acceptance expires; an expired acceptance fails too, so every acceptance is looked at again.
//
//   node scripts/security-audit.mjs                       audit the lockfile now
//   node scripts/security-audit.mjs --report <file.json>  evaluate a saved `pnpm audit --json` report instead
//   node scripts/security-audit.mjs --allowlist <file>    another allow-list (default .github/audit-allowlist.json)
//
// Exit 0 when nothing unaccepted is reported, 1 when something is, 2 on a usage or audit error. It prints advisory
// ids, packages, severities and titles only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ALLOWLIST = ".github/audit-allowlist.json";
const ID_PATTERN = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reads and checks the allow-list: a JSON object whose `accepted` lists the reviewed advisories. */
export function parseAllowlist(text) {
	const document = JSON.parse(text);
	if (
		document === null ||
		typeof document !== "object" ||
		!Array.isArray(document.accepted)
	) {
		throw new Error("the allow-list is a JSON object with an `accepted` list");
	}
	return document.accepted.map((entry, index) => {
		const where = `accepted[${index}]`;
		for (const field of [
			"id",
			"package",
			"reason",
			"reviewed_by",
			"reviewed_on",
			"expires_on",
		]) {
			if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
				throw new Error(`${where} needs ${field}`);
			}
		}
		if (!ID_PATTERN.test(entry.id)) {
			throw new Error(`${where}.id is not a GitHub advisory id`);
		}
		for (const field of ["reviewed_on", "expires_on"]) {
			if (!DATE_PATTERN.test(entry[field])) {
				throw new Error(`${where}.${field} is not a YYYY-MM-DD date`);
			}
		}
		if (entry.expires_on <= entry.reviewed_on) {
			throw new Error(`${where} expires before it was reviewed`);
		}
		return entry;
	});
}

/** The advisories of a `pnpm audit --json` report, one per GitHub advisory id and package. */
export function advisoriesOf(report) {
	const advisories = report?.advisories;
	if (advisories === null || typeof advisories !== "object") {
		throw new Error("the audit report has no advisories object");
	}
	return Object.values(advisories).map((advisory) => ({
		id: String(advisory.github_advisory_id ?? advisory.id),
		package: String(advisory.module_name),
		severity: String(advisory.severity),
		title: String(advisory.title ?? "").slice(0, 120),
	}));
}

/** Splits the reported advisories into accepted and refused, and lists expired and unused acceptances. */
export function evaluate(advisories, accepted, today) {
	const live = accepted.filter((entry) => entry.expires_on >= today);
	const expired = accepted.filter((entry) => entry.expires_on < today);
	const isAccepted = (advisory) =>
		live.some(
			(entry) => entry.id === advisory.id && entry.package === advisory.package,
		);
	const unused = live.filter(
		(entry) =>
			!advisories.some(
				(advisory) =>
					advisory.id === entry.id && advisory.package === entry.package,
			),
	);
	return {
		accepted: advisories.filter(isAccepted),
		refused: advisories.filter((advisory) => !isAccepted(advisory)),
		expired,
		unused,
	};
}

function argument(name) {
	const index = process.argv.indexOf(name);
	return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function runAudit() {
	try {
		return execFileSync("pnpm", ["audit", "--prod", "--json"], {
			cwd: ROOT,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			shell: process.platform === "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		// pnpm audit exits 1 when it finds advisories; its JSON report is still on stdout.
		if (
			typeof error?.stdout === "string" &&
			error.stdout.trim().startsWith("{")
		) {
			return error.stdout;
		}
		throw new Error(
			`pnpm audit failed: ${String(error?.message ?? error).split("\n")[0]}`,
		);
	}
}

function main() {
	const known = new Set(["--report", "--allowlist"]);
	for (let index = 2; index < process.argv.length; index += 2) {
		if (
			!known.has(process.argv[index]) ||
			process.argv[index + 1] === undefined
		) {
			console.error(
				"usage: node scripts/security-audit.mjs [--report <file.json>] [--allowlist <file.json>]",
			);
			return 2;
		}
	}
	let accepted;
	let advisories;
	try {
		accepted = parseAllowlist(
			readFileSync(
				argument("--allowlist") ??
					new URL(`../${DEFAULT_ALLOWLIST}`, import.meta.url),
				"utf8",
			),
		);
		const reportPath = argument("--report");
		advisories = advisoriesOf(
			JSON.parse(
				reportPath === null ? runAudit() : readFileSync(reportPath, "utf8"),
			),
		);
	} catch (error) {
		console.error(`security audit: ${error.message}`);
		return 2;
	}
	const today = new Date().toISOString().slice(0, 10);
	const result = evaluate(advisories, accepted, today);
	for (const advisory of result.accepted) {
		console.log(
			`accepted ${advisory.id} ${advisory.package} (${advisory.severity}): ${advisory.title}`,
		);
	}
	for (const entry of result.unused) {
		console.log(
			`::warning::the accepted advisory ${entry.id} of ${entry.package} is no longer reported; remove it from ${DEFAULT_ALLOWLIST}`,
		);
	}
	for (const entry of result.expired) {
		console.log(
			`::error::the acceptance of ${entry.id} (${entry.package}) expired on ${entry.expires_on}; review it again`,
		);
	}
	for (const advisory of result.refused) {
		console.log(
			`::error::${advisory.id} ${advisory.package} (${advisory.severity}): ${advisory.title}`,
		);
	}
	console.log(
		`security audit: ${advisories.length} advisories, ${result.accepted.length} accepted, ${result.refused.length} refused, ${result.expired.length} expired acceptances`,
	);
	return result.refused.length > 0 || result.expired.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main();
}
