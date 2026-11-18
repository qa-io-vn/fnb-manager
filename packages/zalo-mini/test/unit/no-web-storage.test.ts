import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
const shippedSources = [
	"packages/zalo-mini/src",
	"apps/zalo-staff/src",
	"apps/zalo-customer/src",
	"apps/zalo-staff/index.html",
	"apps/zalo-customer/index.html",
];
const playwrightOnly = new Set([
	"packages/zalo-mini/src/testing/design-checks.ts",
]);
const webStorage =
	/\b(localStorage|sessionStorage|indexedDB)\b|document\s*\.\s*cookie|\bCookieStore\b|\bcookieStore\b/;

function sourceFiles(path: string): string[] {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => sourceFiles(join(path, name)));
}

describe("the Mini Apps", () => {
	it("never use LocalStorage, SessionStorage, IndexedDB or cookies", () => {
		const files = shippedSources
			.flatMap((path) => sourceFiles(join(repoRoot, path)))
			.map((file) => relative(repoRoot, file).replaceAll("\\", "/"))
			.filter((file) => /\.(ts|tsx|html|css|json)$/.test(file))
			.filter((file) => !/\.test\.tsx?$/.test(file))
			.filter((file) => !playwrightOnly.has(file));
		expect(files.length).toBeGreaterThan(20);
		const offenders = files.filter((file) =>
			webStorage.test(readFileSync(join(repoRoot, file), "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("catch a throwaway use", () => {
		expect(webStorage.test("window.localStorage.setItem('a', 'b')")).toBe(true);
		expect(webStorage.test("document.cookie = 'a=b'")).toBe(true);
		expect(webStorage.test("sessionStorage.clear()")).toBe(true);
		expect(webStorage.test("nativeStorage.setItem('a', 'b')")).toBe(false);
	});
});
