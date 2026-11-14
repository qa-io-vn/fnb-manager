import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(import.meta.dirname, "..");
const CHECKED_EXTENSIONS = [".ts", ".tsx", ".css"];
const RAW_COLOUR =
	/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/g;

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		const checked = CHECKED_EXTENSIONS.some((extension) =>
			entry.name.endsWith(extension),
		);
		const isTest = /\.test\.tsx?$/.test(entry.name);
		return checked && !isTest ? [path] : [];
	});
}

describe("colours", () => {
	it("come only from @fnb/design-tokens, never as raw values in the app's source", () => {
		const offenders = sourceFiles(SOURCE_ROOT).flatMap((path) =>
			[...readFileSync(path, "utf8").matchAll(RAW_COLOUR)].map(
				(match) => `${relative(SOURCE_ROOT, path)}: ${match[0]}`,
			),
		);
		expect(offenders).toEqual([]);
	});
});
