import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOKEN_DIRECTORY = join(import.meta.dirname, "..", "tokens");
const THEMES = ["light", "dark", "print"] as const;
const TEXT_CONTRAST = 4.5;
const NON_TEXT_CONTRAST = 3;

type Theme = (typeof THEMES)[number];

interface ColorToken {
	readonly $value: {
		readonly colorSpace: string;
		readonly components: readonly number[];
		readonly hex: string;
	};
}

function colorsOf(theme: Theme): Record<string, ColorToken> {
	const file = JSON.parse(
		readFileSync(join(TOKEN_DIRECTORY, `color.${theme}.tokens.json`), "utf8"),
	) as { color: Record<string, unknown> };
	return Object.fromEntries(
		Object.entries(file.color).filter(([name]) => !name.startsWith("$")),
	) as Record<string, ColorToken>;
}

function hexOf(theme: Theme, name: string): string {
	const token = colorsOf(theme)[name];
	if (token === undefined) throw new Error(`no ${name} in the ${theme} theme`);
	return token.$value.hex;
}

function channel(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const number = Number.parseInt(hex.slice(1), 16);
	const [red, green, blue] = [16, 8, 0].map((shift) =>
		channel(((number >> shift) & 255) / 255),
	) as [number, number, number];
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
	const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
		(left, right) => right - left,
	) as [number, number];
	return (lighter + 0.05) / (darker + 0.05);
}

const textPairs: readonly (readonly [string, string])[] = [
	["ink", "surface"],
	["ink", "surface-raised"],
	["ink", "surface-sunken"],
	["ink-muted", "surface"],
	["ink-muted", "surface-raised"],
	["accent", "surface-raised"],
	["accent-ink", "accent"],
	["positive", "positive-soft"],
	["negative", "negative-soft"],
	["neutral", "neutral-soft"],
	["warning", "warning-soft"],
	["ink", "warning-soft"],
];

const nonTextPairs: readonly (readonly [string, string])[] = [
	["focus", "surface"],
	["focus", "surface-raised"],
];

describe("design tokens", () => {
	it("defines the same colour tokens in every theme", () => {
		const names = (theme: Theme) => Object.keys(colorsOf(theme)).sort();
		expect(names("dark")).toEqual(names("light"));
		expect(names("print")).toEqual(names("light"));
	});

	it("keeps every colour's components equal to its hex value", () => {
		for (const theme of THEMES) {
			for (const [name, token] of Object.entries(colorsOf(theme))) {
				expect(token.$value.colorSpace, `${theme} ${name}`).toBe("srgb");
				const fromComponents = `#${token.$value.components
					.map((component) =>
						Math.round(component * 255)
							.toString(16)
							.padStart(2, "0"),
					)
					.join("")}`;
				expect(fromComponents, `${theme} ${name}`).toBe(token.$value.hex);
			}
		}
	});

	for (const theme of THEMES) {
		it(`meets WCAG 2.2 AA text contrast in the ${theme} theme`, () => {
			for (const [foreground, background] of textPairs) {
				const ratio = contrast(
					hexOf(theme, foreground),
					hexOf(theme, background),
				);
				expect(
					ratio,
					`${foreground} on ${background}: ${ratio.toFixed(2)}`,
				).toBeGreaterThanOrEqual(TEXT_CONTRAST);
			}
		});

		it(`meets WCAG 2.2 AA non-text contrast for focus in the ${theme} theme`, () => {
			for (const [foreground, background] of nonTextPairs) {
				const ratio = contrast(
					hexOf(theme, foreground),
					hexOf(theme, background),
				);
				expect(
					ratio,
					`${foreground} on ${background}: ${ratio.toFixed(2)}`,
				).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
			}
		});
	}
});
