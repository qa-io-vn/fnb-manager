import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { colors } from "@fnb/design-tokens";
import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..", "..");

function readText(path: string): string {
	return readFileSync(join(appRoot, path), "utf8");
}

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose: string;
}

const manifest = JSON.parse(readText("public/manifest.webmanifest")) as {
	name: string;
	short_name: string;
	start_url: string;
	scope: string;
	display: string;
	theme_color: string;
	background_color: string;
	icons: ManifestIcon[];
};
const indexHtml = readText("index.html");

function pngSize(path: string): string {
	const png = readFileSync(join(appRoot, "public", path));
	expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
	return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

describe("install assets", () => {
	it("names the app and keeps start_url and scope relative to the base path", () => {
		expect(manifest.name).toBe("FNB Manager");
		expect(manifest.short_name.length).toBeGreaterThan(0);
		expect(manifest.short_name.length).toBeLessThanOrEqual(12);
		expect(manifest.display).toBe("standalone");
		for (const base of [
			"https://pages.example/fnb-manager/",
			"https://app.example/",
		]) {
			const manifestUrl = new URL("manifest.webmanifest", base);
			expect(new URL(manifest.start_url, manifestUrl).href).toBe(base);
			expect(new URL(manifest.scope, manifestUrl).href).toBe(base);
		}
	});

	it("takes its colours from the app's colour tokens", () => {
		const surface = colors.light.surface;
		expect(manifest.theme_color).toBe(surface);
		expect(manifest.background_color).toBe(surface);
		expect(indexHtml).toContain(
			`<meta name="theme-color" content="${surface}" media="(prefers-color-scheme: light)" />`,
		);
		expect(indexHtml).toContain(
			`<meta name="theme-color" content="${colors.dark.surface}" media="(prefers-color-scheme: dark)" />`,
		);
		expect(readText("public/favicon.svg")).toMatch(
			new RegExp(`id="background"[^>]*fill="${colors.light.accent}"`),
		);
	});

	it("ships 192 and 512 px PNG icons and a maskable variant at their stated sizes", () => {
		const declared = manifest.icons.map((icon) => {
			expect(icon.type).toBe("image/png");
			expect(pngSize(icon.src)).toBe(icon.sizes);
			return `${icon.sizes} ${icon.purpose}`;
		});
		expect(declared).toEqual(
			expect.arrayContaining([
				"192x192 any",
				"512x512 any",
				"512x512 maskable",
			]),
		);
		expect(pngSize("apple-touch-icon.png")).toBe("180x180");
	});

	it("links the favicon, touch icon and manifest from index.html as public files", () => {
		for (const path of [
			"/favicon.ico",
			"/favicon.svg",
			"/apple-touch-icon.png",
			"/manifest.webmanifest",
		]) {
			expect(indexHtml).toContain(`href="${path}"`);
			expect(existsSync(join(appRoot, "public", path))).toBe(true);
		}
	});
});
