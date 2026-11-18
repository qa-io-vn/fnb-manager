import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findRepositoryRoot } from "../../src/config/env-file.js";
import {
	ALL_STORES_NAME,
	assertPrivateOutput,
	defaultPackPath,
	defaultStrategyPath,
	PathRefusedError,
	packScopeName,
	realPathOf,
	resolveUserPath,
	shownPath,
} from "../../src/datapack/files.js";

const DIRECTORY_LINK = process.platform === "win32" ? "junction" : "dir";
const PACK_ID = `8ad42bf9${"0".repeat(56)}`;

let scratch: string;
let repository: string;
let unignored: string;
let outside: string;

function gitRepository(path: string, ignore: string): void {
	mkdirSync(path, { recursive: true });
	const init = spawnSync("git", ["init", "-q"], { cwd: path });
	if (init.status !== 0) throw new Error("git init failed");
	writeFileSync(join(path, ".gitignore"), ignore);
	mkdirSync(join(path, "docs"), { recursive: true });
	writeFileSync(join(path, "docs", "tracked.md"), "tracked\n");
}

function refusal(path: string, root: string, git?: string): string {
	try {
		assertPrivateOutput(path, root, git === undefined ? {} : { git });
	} catch (error) {
		if (error instanceof PathRefusedError) return error.reason;
		throw error;
	}
	return "allowed";
}

beforeAll(() => {
	scratch = realpathSync(mkdtempSync(join(tmpdir(), "fnb-datapack-files-")));
	repository = join(scratch, "repository");
	unignored = join(scratch, "unignored");
	outside = join(scratch, "outside");
	gitRepository(repository, "node_modules/\ndocs/private/\n");
	gitRepository(unignored, "node_modules/\n");
	mkdirSync(outside, { recursive: true });
	mkdirSync(join(repository, "docs", "private"), { recursive: true });
	symlinkSync(
		join(repository, "docs"),
		join(repository, "docs", "private", "to-docs"),
		DIRECTORY_LINK,
	);
	symlinkSync(
		outside,
		join(repository, "docs", "private", "to-outside"),
		DIRECTORY_LINK,
	);
	symlinkSync(
		join(repository, "docs"),
		join(outside, "to-repository-docs"),
		DIRECTORY_LINK,
	);
	symlinkSync(
		join(scratch, "missing"),
		join(repository, "docs", "private", "dangling"),
		DIRECTORY_LINK,
	);
});

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe("resolveUserPath", () => {
	it("starts a relative path from INIT_CWD, the folder where pnpm was run", () => {
		expect(
			resolveUserPath("docs/private/strategy/pack.json", {
				INIT_CWD: repository,
			}),
		).toBe(join(repository, "docs", "private", "strategy", "pack.json"));
	});

	it("starts from the working directory without INIT_CWD", () => {
		expect(resolveUserPath("pack.json", {})).toBe(
			join(process.cwd(), "pack.json"),
		);
		expect(resolveUserPath("pack.json", { INIT_CWD: "  " })).toBe(
			join(process.cwd(), "pack.json"),
		);
	});

	it("keeps an absolute path", () => {
		const absolute = join(outside, "pack.json");
		expect(resolveUserPath(absolute, { INIT_CWD: repository })).toBe(absolute);
	});
});

describe("the default paths", () => {
	it("are absolute, below docs/private/strategy/ of the root", () => {
		const path = defaultStrategyPath(repository, "packs", "x.json");
		expect(isAbsolute(path)).toBe(true);
		expect(path).toBe(
			join(repository, "docs", "private", "strategy", "packs", "x.json"),
		);
		expect(defaultPackPath(repository, "2026-11-11", "tat-ca", PACK_ID)).toBe(
			join(
				repository,
				"docs",
				"private",
				"strategy",
				"packs",
				"2026-11-11_tat-ca_8ad42bf9.json",
			),
		);
	});

	it("name the stores tat-ca, or by their labels", () => {
		expect(packScopeName(null)).toBe(ALL_STORES_NAME);
		expect(packScopeName(["S1"])).toBe("s1");
		expect(packScopeName(["S1", "S3"])).toBe("s1-s3");
	});

	it("are allowed by the path rules of this repository", () => {
		const root = findRepositoryRoot();
		const path = defaultPackPath(root, "2026-11-11", "tat-ca", PACK_ID);
		const packs = join(root, "docs", "private", "strategy", "packs");
		const before = existsSync(packs);
		expect(assertPrivateOutput(path, root)).toBe(realPathOf(path));
		expect(existsSync(packs)).toBe(before);
	});
});

describe("assertPrivateOutput", () => {
	it("allows a path below docs/private/ that git ignores, creating nothing", () => {
		const path = join(
			repository,
			"docs",
			"private",
			"strategy",
			"packs",
			"p.json",
		);
		expect(assertPrivateOutput(path, repository)).toBe(path);
		expect(existsSync(join(repository, "docs", "private", "strategy"))).toBe(
			false,
		);
	});

	it("allows any path outside the repository", () => {
		expect(assertPrivateOutput(join(outside, "a", "p.json"), repository)).toBe(
			join(outside, "a", "p.json"),
		);
		expect(
			assertPrivateOutput(join(outside, "p.json"), repository, {
				git: join(scratch, "no-git"),
			}),
		).toBe(join(outside, "p.json"));
	});

	it("refuses the other folders of the repository, tracked or not", () => {
		for (const path of [
			join(repository, "docs", "p.json"),
			join(repository, "docs", "tracked.md"),
			join(repository, "p.json"),
			join(repository, "node_modules", "p.json"),
			join(repository, "apps", "jobs", "docs", "private", "p.json"),
			join(repository, "docs", "private"),
			repository,
		]) {
			expect(refusal(path, repository), path).toContain(
				"not below docs/private/",
			);
		}
	});

	it("refuses docs/private/ where git does not ignore it", () => {
		const path = join(unignored, "docs", "private", "p.json");
		expect(refusal(path, unignored)).toBe(
			"is below docs/private/ but git does not ignore it",
		);
	});

	it("follows symbolic links to the real path", () => {
		expect(
			refusal(
				join(repository, "docs", "private", "to-docs", "p.json"),
				repository,
			),
		).toContain("not below docs/private/");
		expect(
			refusal(join(outside, "to-repository-docs", "p.json"), repository),
		).toContain("not below docs/private/");
		expect(
			assertPrivateOutput(
				join(repository, "docs", "private", "to-outside", "p.json"),
				repository,
			),
		).toBe(join(outside, "p.json"));
		expect(
			refusal(
				join(repository, "docs", "private", "dangling", "p.json"),
				repository,
			),
		).toContain("symbolic link whose target does not exist");
	});

	it("refuses every path inside the repository on a machine without git", () => {
		const path = join(repository, "docs", "private", "strategy", "p.json");
		expect(refusal(path, repository, join(scratch, "no-git"))).toContain(
			"git could not confirm",
		);
	});

	it("applies the rules of this repository when run through pnpm from the root", () => {
		const root = findRepositoryRoot();
		const jobs = join(root, "apps", "jobs");
		const fromRoot = resolveUserPath("docs/private/strategy/pack.json", {
			INIT_CWD: root,
		});
		expect(fromRoot).toBe(
			join(root, "docs", "private", "strategy", "pack.json"),
		);
		expect(refusal(fromRoot, root)).toBe("allowed");
		const fromJobs = resolveUserPath("docs/private/strategy/pack.json", {
			INIT_CWD: jobs,
		});
		expect(refusal(fromJobs, root)).toContain("not below docs/private/");
		expect(refusal(join(root, "docs", "strategy.md"), root)).toContain(
			"not below docs/private/",
		);
		expect(existsSync(join(jobs, "docs"))).toBe(false);
	});
});

describe("shownPath", () => {
	it("gives the base name in CI, a path from the root inside it and the absolute path outside", () => {
		const inside = join(repository, "docs", "private", "strategy", "p.json");
		expect(shownPath(inside, repository, true)).toBe("p.json");
		expect(shownPath(inside, repository, false)).toBe(
			"docs/private/strategy/p.json",
		);
		const elsewhere = join(outside, "p.json");
		expect(shownPath(elsewhere, repository, false)).toBe(resolve(elsewhere));
		expect(shownPath(elsewhere, repository, true)).toBe(basename(elsewhere));
	});
});
