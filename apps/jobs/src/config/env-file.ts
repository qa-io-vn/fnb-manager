import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Environment = Record<string, string | undefined>;

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

export function findRepositoryRoot(
	start = dirname(fileURLToPath(import.meta.url)),
): string {
	let current = resolve(start);
	for (;;) {
		if (existsSync(join(current, WORKSPACE_MARKER))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			throw new Error(`could not find ${WORKSPACE_MARKER} above ${start}`);
		}
		current = parent;
	}
}

function unquote(value: string): string {
	const first = value[0];
	const last = value[value.length - 1];
	if (value.length >= 2 && (first === '"' || first === "'") && first === last) {
		const inner = value.slice(1, -1);
		return first === '"'
			? inner.replaceAll("\\n", "\n").replaceAll('\\"', '"')
			: inner;
	}
	return value;
}

export function parseEnvFile(text: string): Record<string, string> {
	const entries: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) {
			continue;
		}
		const withoutExport = line.startsWith("export ")
			? line.slice(7).trimStart()
			: line;
		const separator = withoutExport.indexOf("=");
		if (separator <= 0) {
			continue;
		}
		const key = withoutExport.slice(0, separator).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			continue;
		}
		entries[key] = unquote(withoutExport.slice(separator + 1).trim());
	}
	return entries;
}

export function withEnvFile(
	environment: Environment,
	rootDir: string,
): Environment {
	const file = join(rootDir, ".env");
	if (!existsSync(file)) {
		return { ...environment };
	}
	const fromFile = parseEnvFile(readFileSync(file, "utf8"));
	const merged: Environment = { ...fromFile };
	for (const [key, value] of Object.entries(environment)) {
		if (value !== undefined) {
			merged[key] = value;
		}
	}
	return merged;
}
