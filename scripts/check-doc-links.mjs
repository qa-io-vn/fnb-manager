#!/usr/bin/env node
// The link check of the documentation set (docs/README.md, NFR-MNT-04, NFR-HYG-03).
//
//   node scripts/check-doc-links.mjs              check every tracked Markdown file of the repository
//   node scripts/check-doc-links.mjs --self-test  plant each kind of fault in a temporary repository and check it is found
//
// For every tracked *.md file: every relative link resolves to a tracked file or folder; every #anchor resolves to a
// heading of the target, with the slug computed as GitHub computes it (lower case, spaces to hyphens, punctuation
// dropped, Vietnamese letters kept); no link points into docs/private/ or at an ignored path; and every document
// under docs/ outside docs/private/ is linked from docs/README.md. External links are never fetched. It prints
// `file:line` with the bad target and exits 1 on any finding.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX = "docs/README.md";
const PRIVATE = "docs/private/";
const EXCLUDED_PREFIXES = [
	"packages/datapack/test/fixtures/",
	"packages/reports/test/",
];

function git(root, args, input) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 64 * 1024 * 1024,
	});
}

function trackedFiles(root) {
	return git(root, ["ls-files", "-z"])
		.split("\0")
		.filter(Boolean)
		.map((file) => file.replace(/\\/g, "/"));
}

function ignoredPaths(root, paths) {
	if (paths.length === 0) return new Set();
	try {
		const output = git(
			root,
			["check-ignore", "--no-index", "--stdin", "-z"],
			`${paths.join("\0")}\0`,
		);
		return new Set(output.split("\0").filter(Boolean));
	} catch (error) {
		if (error.status === 1) return new Set();
		throw error;
	}
}

/** The heading text as GitHub renders it, before slugging: inline markup removed. */
function headingText(raw) {
	return raw
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/`/g, "")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|[^\w])[*_](\S(?:.*?\S)?)[*_](?=[^\w]|$)/g, "$1$2")
		.trim();
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens; letters of every script kept. */
export function githubSlug(text) {
	return headingText(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
		.replace(/ /g, "-");
}

function stripCode(lines, { keepInline = false } = {}) {
	let fence = null;
	return lines.map((line) => {
		const marker = line.match(/^\s*(```+|~~~+)/);
		if (marker) {
			if (fence === null) fence = marker[1][0];
			else if (marker[1][0] === fence) fence = null;
			return "";
		}
		if (fence !== null) return "";
		if (keepInline) return line;
		return line.replace(/(`+)(?:(?!\1).)+\1/g, (span) =>
			" ".repeat(span.length),
		);
	});
}

/** Every anchor a Markdown file offers: heading slugs (with GitHub's -1, -2 suffixes) and explicit ids. */
export function anchorsOf(text) {
	const anchors = new Set();
	const seen = new Map();
	for (const line of stripCode(text.replace(/\r/g, "").split("\n"), {
		keepInline: true,
	})) {
		const heading = line.match(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
		if (heading) {
			const base = githubSlug(heading[1]);
			const count = seen.get(base) ?? 0;
			anchors.add(count === 0 ? base : `${base}-${count}`);
			seen.set(base, count + 1);
		}
		for (const match of line.matchAll(
			/<a\s+(?:[^>]*\s)?(?:id|name)=["']([^"']+)["']/gi,
		)) {
			anchors.add(match[1]);
		}
	}
	return anchors;
}

/** Every link of a Markdown file with its line: inline links, images, reference definitions and HTML hrefs. */
export function linksOf(text) {
	const links = [];
	stripCode(text.replace(/\r/g, "").split("\n")).forEach((line, index) => {
		const push = (target) => {
			const cleaned = target.trim().replace(/^<(.*)>$/, "$1");
			if (cleaned !== "") links.push({ line: index + 1, target: cleaned });
		};
		for (const match of line.matchAll(
			/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'(][^)]*)?\)/g,
		))
			push(match[1]);
		const definition = line.match(/^ {0,3}\[[^\]]+\]:\s*(\S+)/);
		if (definition) push(definition[1]);
		for (const match of line.matchAll(
			/<(?:a|img)\s[^>]*(?:href|src)=["']([^"']+)["']/gi,
		))
			push(match[1]);
	});
	return links;
}

function isExternal(target) {
	return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function safeDecode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function checkRepository(root) {
	const tracked = trackedFiles(root);
	const trackedSet = new Set(tracked);
	const folders = new Set();
	for (const file of tracked) {
		let folder = posix.dirname(file);
		while (folder !== "." && !folders.has(folder)) {
			folders.add(folder);
			folder = posix.dirname(folder);
		}
	}
	const markdown = tracked.filter(
		(file) =>
			file.endsWith(".md") &&
			!EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)),
	);
	const anchorCache = new Map();
	const anchorsFor = (file) => {
		if (!anchorCache.has(file)) {
			anchorCache.set(file, anchorsOf(readFileSync(join(root, file), "utf8")));
		}
		return anchorCache.get(file);
	};
	const findings = [];
	const resolved = [];
	for (const file of markdown) {
		const text = readFileSync(join(root, file), "utf8");
		for (const link of linksOf(text)) {
			if (isExternal(link.target)) continue;
			const hashAt = link.target.indexOf("#");
			const pathPart = safeDecode(
				hashAt === -1 ? link.target : link.target.slice(0, hashAt),
			).split("?")[0];
			const anchor =
				hashAt === -1 ? null : safeDecode(link.target.slice(hashAt + 1));
			const target =
				pathPart === ""
					? file
					: pathPart.startsWith("/")
						? posix.normalize(pathPart.slice(1))
						: posix.normalize(posix.join(posix.dirname(file), pathPart));
			const where = `${file}:${link.line}`;
			if (target.startsWith("../") || target === "..") {
				findings.push({
					where,
					target: link.target,
					reason: "points outside the repository",
				});
				continue;
			}
			const folderTarget = target.replace(/\/$/, "");
			if (
				`${folderTarget}/`.startsWith(PRIVATE) ||
				folderTarget === PRIVATE.slice(0, -1)
			) {
				findings.push({
					where,
					target: link.target,
					reason: "points into docs/private/",
				});
				continue;
			}
			resolved.push({ where, link, target: folderTarget, anchor });
		}
	}
	const ignored = ignoredPaths(root, [
		...new Set(
			resolved.map((entry) => entry.target).filter((target) => target !== "."),
		),
	]);
	for (const { where, link, target, anchor } of resolved) {
		if (ignored.has(target)) {
			findings.push({
				where,
				target: link.target,
				reason: "points at an ignored path",
			});
			continue;
		}
		if (!trackedSet.has(target) && !folders.has(target) && target !== ".") {
			findings.push({
				where,
				target: link.target,
				reason: "no tracked file or folder",
			});
			continue;
		}
		if (
			anchor !== null &&
			anchor !== "" &&
			target.endsWith(".md") &&
			trackedSet.has(target)
		) {
			const anchors = anchorsFor(target);
			if (!anchors.has(anchor) && !anchors.has(anchor.toLowerCase())) {
				findings.push({
					where,
					target: link.target,
					reason: "no heading with this anchor",
				});
			}
		}
	}
	if (trackedSet.has(INDEX)) {
		const listed = new Set(
			linksOf(readFileSync(join(root, INDEX), "utf8"))
				.filter((link) => !isExternal(link.target))
				.map((link) =>
					posix
						.normalize(
							posix.join("docs", safeDecode(link.target.split("#")[0])),
						)
						.replace(/\/$/, ""),
				),
		);
		for (const file of markdown) {
			if (
				!file.startsWith("docs/") ||
				file.startsWith(PRIVATE) ||
				file === INDEX
			)
				continue;
			if (!listed.has(file)) {
				findings.push({
					where: `${INDEX}:1`,
					target: file,
					reason: "document not listed in the index",
				});
			}
		}
	} else {
		findings.push({
			where: `${INDEX}:1`,
			target: INDEX,
			reason: "the documentation index is missing",
		});
	}
	const order = (finding) => {
		const [file, line] = finding.where.split(/:(?=\d+$)/);
		return { file, line: Number(line) };
	};
	findings.sort((left, right) => {
		const a = order(left);
		const b = order(right);
		if (a.file !== b.file) return a.file < b.file ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		return left.target < right.target ? -1 : left.target > right.target ? 1 : 0;
	});
	return { files: markdown.length, findings };
}

function selfTest() {
	const root = mkdtempSync(join(tmpdir(), "doc-links-"));
	const failures = [];
	try {
		const write = (file, text) => {
			mkdirSync(dirname(join(root, file)), { recursive: true });
			writeFileSync(join(root, file), text);
		};
		write(".gitignore", "docs/private/\nbuild/\n");
		write(
			"README.md",
			[
				"# Root",
				"",
				"See [the index](docs/README.md) and [today](docs/guide.md#hôm-nay-today).",
				"A [second heading](docs/guide.md#hôm-nay-today-1) and [code](docs/guide.md#the-fnb-status-command).",
				"An [explicit anchor](docs/guide.md#kept) and a [folder](docs/).",
				"`[not a link](missing.md)`",
				"```",
				"[also not a link](missing.md)",
				"```",
			].join("\n"),
		);
		write(
			"docs/README.md",
			["# Index", "", "- [Guide](guide.md)", "- [Broken](broken.md)", ""].join(
				"\n",
			),
		);
		write(
			"docs/guide.md",
			[
				"# Guide",
				"",
				"## Hôm nay (Today)",
				"",
				"## Hôm nay (Today)",
				"",
				"## The `fnb status` command",
				"",
				'<a id="kept"></a>',
				"",
				"A [broken link](nothing.md), a [broken anchor](#tomorrow), a [private note](private/notes.md)",
				"and an [ignored build](../build/out.md).",
				"",
			].join("\n"),
		);
		write("docs/broken.md", "# Broken\n\n[Back](README.md#no-such-heading)\n");
		write("docs/unlisted.md", "# Unlisted\n");
		git(root, ["init", "-q"]);
		git(root, ["add", "."]);
		const { findings } = checkRepository(root);
		const summary = findings.map(
			(finding) => `${finding.where} ${finding.target} (${finding.reason})`,
		);
		const wanted = [
			"docs/README.md:1 docs/unlisted.md (document not listed in the index)",
			"docs/broken.md:3 README.md#no-such-heading (no heading with this anchor)",
			"docs/guide.md:11 #tomorrow (no heading with this anchor)",
			"docs/guide.md:11 nothing.md (no tracked file or folder)",
			"docs/guide.md:11 private/notes.md (points into docs/private/)",
			"docs/guide.md:12 ../build/out.md (points at an ignored path)",
		];
		if (JSON.stringify(summary) !== JSON.stringify(wanted)) {
			failures.push(
				`findings\n  ${summary.join("\n  ")}\nwanted\n  ${wanted.join("\n  ")}`,
			);
		}
		write("build/out.md", "# Out\n");
		git(root, ["add", "-f", "build/out.md"]);
		const ignoredRun = checkRepository(root).findings.filter(
			(finding) => finding.target === "../build/out.md",
		);
		if (
			ignoredRun.length !== 1 ||
			ignoredRun[0].reason !== "points at an ignored path"
		) {
			failures.push(
				"a force-added file under an ignored path must still be reported",
			);
		}
		git(root, ["rm", "-q", "--cached", "build/out.md"]);
		if (githubSlug("Hôm nay (Today)") !== "hôm-nay-today")
			failures.push("the Vietnamese slug");
		if (
			githubSlug("8.1 Open correction requests") !==
			"81-open-correction-requests"
		)
			failures.push("the numbered slug");
		if (
			githubSlug("R-F14: `docs` and **bold** [link](x.md)") !==
			"r-f14-docs-and-bold-link"
		)
			failures.push("the markup slug");
		rmSync(join(root, "docs", "unlisted.md"));
		write(
			"docs/README.md",
			"# Index\n\n- [Guide](guide.md)\n- [Broken](broken.md)\n",
		);
		write(
			"docs/guide.md",
			'# Guide\n\n## Hôm nay (Today)\n\n## Hôm nay (Today)\n\n## The `fnb status` command\n\n<a id="kept"></a>\n',
		);
		write("docs/broken.md", "# Broken\n\n[Back](README.md#index)\n");
		git(root, ["add", "-A"]);
		const clean = checkRepository(root).findings;
		if (clean.length !== 0) {
			failures.push(
				`a clean repository reports ${clean.map((finding) => `${finding.where} ${finding.target}`).join(", ")}`,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	if (failures.length > 0) {
		for (const failure of failures) console.error(`self-test: ${failure}`);
		process.exit(1);
	}
	console.log("check-doc-links self-test: all checks passed");
}

function main(argv) {
	if (argv.includes("--self-test")) {
		selfTest();
		return;
	}
	if (!existsSync(join(ROOT, ".git"))) {
		console.error("check-doc-links: run it inside the git checkout");
		process.exit(2);
	}
	const { files, findings } = checkRepository(ROOT);
	for (const finding of findings) {
		console.error(`${finding.where}: ${finding.target}: ${finding.reason}`);
	}
	if (findings.length > 0) {
		console.error(
			`check-doc-links: ${findings.length} finding(s) in ${files} Markdown file(s)`,
		);
		process.exit(1);
	}
	console.log(
		`check-doc-links: ${files} Markdown file(s), every link and anchor resolves`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main(process.argv.slice(2));
}
