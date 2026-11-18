import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { Environment } from "../config/env-file.js";

export const PRIVATE_FOLDER = ["docs", "private"] as const;
export const STRATEGY_FOLDER = [...PRIVATE_FOLDER, "strategy"] as const;
export const PACKS_FOLDER = "packs";
export const ALL_STORES_NAME = "tat-ca";
export const PACK_ID_PREFIX_LENGTH = 8;

export interface PrivateOutputOptions {
	readonly git?: string;
}

export class PathRefusedError extends Error {
	readonly path: string;
	readonly reason: string;

	constructor(path: string, reason: string) {
		super(reason);
		this.name = "PathRefusedError";
		this.path = path;
		this.reason = reason;
	}
}

export function resolveUserPath(path: string, env: Environment): string {
	const base = env.INIT_CWD?.trim() ? env.INIT_CWD : process.cwd();
	return resolve(base, path);
}

export function defaultStrategyPath(
	rootDir: string,
	...segments: readonly string[]
): string {
	return resolve(rootDir, ...STRATEGY_FOLDER, ...segments);
}

export function packScopeName(labels: readonly string[] | null): string {
	return labels === null
		? ALL_STORES_NAME
		: labels.map((label) => label.toLowerCase()).join("-");
}

export function defaultPackPath(
	rootDir: string,
	asOf: string,
	scope: string,
	packId: string,
): string {
	return defaultStrategyPath(
		rootDir,
		PACKS_FOLDER,
		`${asOf}_${scope}_${packId.slice(0, PACK_ID_PREFIX_LENGTH)}.json`,
	);
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

export function realPathOf(path: string): string {
	const missing: string[] = [];
	let current = resolve(path);
	for (;;) {
		if (exists(current)) {
			let real: string;
			try {
				real = realpathSync(current);
			} catch {
				throw new PathRefusedError(
					path,
					"leads through a symbolic link whose target does not exist",
				);
			}
			return missing.length === 0 ? real : join(real, ...missing.reverse());
		}
		const parent = dirname(current);
		if (parent === current) return resolve(path);
		missing.push(basename(current));
		current = parent;
	}
}

function samePart(left: string | undefined, right: string): boolean {
	return process.platform === "win32"
		? left?.toLowerCase() === right
		: left === right;
}

function ignoredByGit(
	root: string,
	inside: string,
	git: string,
): boolean | null {
	const result = spawnSync(
		git,
		["check-ignore", "-q", "--no-index", "--", inside],
		{ cwd: root, stdio: "ignore", windowsHide: true },
	);
	if (result.error !== undefined) return null;
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	return null;
}

export function insideRepository(target: string, root: string): string | null {
	const inside = relative(root, target);
	if (inside === "") return "";
	if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
		return null;
	}
	return inside;
}

export function assertPrivateOutput(
	path: string,
	rootDir: string,
	options: PrivateOutputOptions = {},
): string {
	const target = realPathOf(path);
	const root = realPathOf(rootDir);
	const inside = insideRepository(target, root);
	if (inside === null) return target;
	const parts = inside === "" ? [] : inside.split(sep);
	const [first, second] = parts;
	if (
		parts.length <= PRIVATE_FOLDER.length ||
		!samePart(first, PRIVATE_FOLDER[0]) ||
		!samePart(second, PRIVATE_FOLDER[1])
	) {
		throw new PathRefusedError(
			path,
			"is inside the repository but not below docs/private/; write below docs/private/ or outside the repository",
		);
	}
	const ignored = ignoredByGit(root, parts.join("/"), options.git ?? "git");
	if (ignored === null) {
		throw new PathRefusedError(
			path,
			"is inside the repository, and git could not confirm that it ignores the path; write outside the repository",
		);
	}
	if (!ignored) {
		throw new PathRefusedError(
			path,
			"is below docs/private/ but git does not ignore it",
		);
	}
	return target;
}

export function shownPath(path: string, rootDir: string, ci: boolean): string {
	if (ci) return basename(path);
	const inside = insideRepository(resolve(path), resolve(rootDir));
	return inside === null || inside === ""
		? resolve(path)
		: inside.split(sep).join("/");
}
