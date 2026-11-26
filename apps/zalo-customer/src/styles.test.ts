/// <reference types="node" />
import { join } from "node:path";
import {
	compileAppCss,
	customProperties,
	declarationsOf,
} from "@fnb/zalo-mini/testing/tailwind-css";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// Integration: the shell's style sheet (packages/zalo-mini) as this app's Tailwind build reads it. A class of an
// optional theme role must resolve to its custom property, an unthemed build must have a default for it that is made of
// roles every brand sets, and every shape and size utility must fall back to exactly what the literal class it replaces
// gave (so a build without a brand shape looks as before).
const appRoot = join(import.meta.dirname, "..");

const ROLE_CLASSES = [
	["bg-line-strong", "--color-line-strong"],
	["bg-badge", "--color-badge"],
	["text-badge-ink", "--color-badge-ink"],
	["bg-inverse", "--color-inverse"],
	["text-inverse-ink", "--color-inverse-ink"],
	["bg-tone-1", "--color-tone-1"],
	["text-tone-1-ink", "--color-tone-1-ink"],
	["bg-tone-1-soft", "--color-tone-1-soft"],
	["bg-tone-4", "--color-tone-4"],
	["bg-art-plate", "--color-art-plate"],
] as const;

describe("the optional theme roles in the app's style sheet", () => {
	it("gives every role a utility that reads its custom property", async () => {
		const css = await compileAppCss(
			compile,
			appRoot,
			ROLE_CLASSES.map(([name]) => name),
		);
		for (const [name, variable] of ROLE_CLASSES) {
			const property = name.startsWith("text-") ? "color" : "background-color";
			const role = variable.replace("--color-", "--");
			expect(css, name).toContain(`.${name} {`);
			expect(css, name).toContain(`${property}: var(${role});`);
		}
		// utilities of the roles the tokens already had keep reading the tokens
		const known = await compileAppCss(compile, appRoot, ["bg-positive-soft"]);
		expect(known).toContain("background-color: var(--positive-soft);");
	});

	it("defaults each role, without a brand, to roles that every brand sets or that the tokens define", async () => {
		const css = await compileAppCss(compile, appRoot, ["bg-badge"]);
		for (const declaration of [
			"--line-strong: var(--line);",
			"--badge: var(--neutral-soft);",
			"--badge-ink: var(--ink);",
			"--inverse: var(--ink);",
			"--inverse-ink: var(--surface);",
			"--tone-1: var(--accent);",
			"--tone-2: var(--positive);",
			"--tone-3: var(--warning);",
			"--tone-4: var(--neutral);",
			"--tone-3-soft: var(--warning-soft);",
			"--art-plate: var(--surface-sunken);",
		]) {
			expect(css, declaration).toContain(declaration);
		}
	});

	it("leaves a custom property out when no class uses it and writes no colour value of a role it does not know", async () => {
		const css = await compileAppCss(compile, appRoot, ["flex"]);
		expect(css).not.toContain("--color-badge:");
		expect(css).not.toMatch(/--(?:line-strong|badge|tone-\d)[a-z-]*:\s*#/);
	});
});

// the custom properties of the theme, the tokens and the shell (Tailwind's own --tw- helpers are left out: their
// initial values are placeholders, not values)
function themeVariables(css: string): Record<string, string> {
	return Object.fromEntries(
		Object.entries(customProperties(css)).filter(
			([name]) => !name.startsWith("--tw-"),
		),
	);
}

// the value of a declaration with the custom properties it names resolved, and a calc of two numbers worked out
function resolved(value: string, variables: Record<string, string>): string {
	let text = value;
	for (let round = 0; round < 4; round += 1) {
		text = text.replace(
			/var\((--[\w-]+)(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
			(whole, name: string, fallback: string | undefined) =>
				variables[name] ?? fallback ?? whole,
		);
	}
	text = text.replace(
		/var\(--tw-shadow-color,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
		"$1",
	);
	text = text.replace(
		/calc\(([\d.]+) \/ ([\d.]+)\)/g,
		(_all, a: string, b: string) => String(Number(a) / Number(b)),
	);
	return text.replace(/\s+/g, " ").trim();
}

// the utility of the shell and the literal class of Tailwind it stands for, with the properties to compare
const STAND_INS = [
	["rounded-card", "rounded-3xl", ["border-radius"]],
	["rounded-card-2xl", "rounded-2xl", ["border-radius"]],
	["rounded-card-xl", "rounded-xl", ["border-radius"]],
	["rounded-field", "rounded-xl", ["border-radius"]],
	["rounded-control", "rounded-full", ["border-radius"]],
	["rounded-control-xl", "rounded-xl", ["border-radius"]],
	["rounded-tile", "rounded-xl", ["border-radius"]],
	["rounded-panel", "rounded-2xl", ["border-radius"]],
	[
		"rounded-b-panel",
		"rounded-b-[28px]",
		["border-bottom-right-radius", "border-bottom-left-radius"],
	],
	[
		"rounded-t-sheet",
		"rounded-t-2xl",
		["border-top-left-radius", "border-top-right-radius"],
	],
	["border-card", "border", ["border-width"]],
	["border-field", "border", ["border-width"]],
	["border-outline", "border", ["border-width"]],
	["text-body", "text-base", ["font-size", "line-height"]],
] as const;

describe("the shape and size utilities fall back to what today's classes give", () => {
	it.each(STAND_INS)(
		"%s is %s when no brand sets its custom property",
		async (token, literal, properties) => {
			const css = await compileAppCss(compile, appRoot, [token, literal]);
			const variables = themeVariables(css);
			const tokenRule = declarationsOf(css, token);
			const literalRule = declarationsOf(css, literal);
			expect(tokenRule, token).not.toBeNull();
			expect(literalRule, literal).not.toBeNull();
			for (const property of properties) {
				// a token reads a custom property of the brand with today's value as the fallback: the brand's value is
				// not set here, so the fallback is what answers
				const fallback = (tokenRule?.[property] ?? "").replace(
					/^var\(--[\w-]+, ([\s\S]*)\)$/,
					"$1",
				);
				expect(resolved(fallback, variables), `${token} ${property}`).toBe(
					resolved(literalRule?.[property] ?? "", variables),
				);
			}
		},
	);

	it("writes a solid border for the three border widths, and none of them as a Tailwind border-style variable", async () => {
		const css = await compileAppCss(compile, appRoot, [
			"border-card",
			"border-field",
			"border-outline",
		]);
		for (const name of ["border-card", "border-field", "border-outline"]) {
			expect(declarationsOf(css, name)?.["border-style"], name).toBe("solid");
		}
	});

	it("takes the brand's custom property when it is set, for every token", async () => {
		const css = await compileAppCss(
			compile,
			appRoot,
			STAND_INS.map(([token]) => token),
		);
		for (const [token, variable] of [
			["rounded-card", "--radius-card"],
			["rounded-card-2xl", "--radius-card"],
			["rounded-card-xl", "--radius-card"],
			["rounded-field", "--radius-field"],
			["rounded-control", "--radius-control"],
			["rounded-control-xl", "--radius-control"],
			["rounded-tile", "--radius-tile"],
			["rounded-panel", "--radius-panel"],
			["rounded-b-panel", "--radius-panel"],
			["rounded-t-sheet", "--radius-sheet"],
			["border-card", "--card-border"],
			["border-field", "--field-border"],
			["border-outline", "--outline-width"],
		] as const) {
			const rule = declarationsOf(css, token) ?? {};
			expect(
				Object.values(rule).some((value) => value.includes(`var(${variable},`)),
				`${token} reads ${variable}`,
			).toBe(true);
		}
	});

	it("keeps today's card shadow as the fallback of shadow-card, and lets a brand replace it", async () => {
		const css = await compileAppCss(compile, appRoot, [
			"shadow-card",
			"shadow-sm",
		]);
		const variables = themeVariables(css);
		const token = declarationsOf(css, "shadow-card")?.["box-shadow"] ?? "";
		expect(token).toContain("var( --card-shadow,");
		const fallback = token
			.replace(/^var\( --card-shadow, ([\s\S]*) \)$/, "$1")
			.replace(/\s+/g, " ");
		const sm = declarationsOf(css, "shadow-sm")?.["--tw-shadow"] ?? "";
		expect(resolved(fallback, variables)).toBe(resolved(sm, variables));
	});

	it("draws the outline in the line colour until a brand sets its own, and a danger action likewise", async () => {
		const css = await compileAppCss(compile, appRoot, [
			"border-edge",
			"border-edge-danger",
			"border-line",
		]);
		const variables = themeVariables(css);
		expect(declarationsOf(css, "border-edge")?.["border-color"]).toBe(
			"var(--outline-color, var(--line))",
		);
		expect(declarationsOf(css, "border-edge-danger")?.["border-color"]).toBe(
			"var(--outline-danger-color, var(--line))",
		);
		// without --outline-color the colour is --line, which is what border-line gives
		expect(
			resolved("var(--line)", variables),
			"the outline falls back to the line colour",
		).toBe(
			resolved(
				declarationsOf(css, "border-line")?.["border-color"] ?? "",
				variables,
			),
		);
	});

	it("has a body size, a display and a hand font that are the system font, and a kicker", async () => {
		const css = await compileAppCss(compile, appRoot, [
			"text-body",
			"font-display",
			"font-hand",
			"kicker",
		]);
		const variables = customProperties(css);
		expect(variables["--text-body"]).toBe("1rem");
		expect(variables["--text-body--line-height"]).toBe("1.5");
		expect(variables["--font-display"]).toBe("var(--font-sans)");
		expect(variables["--font-hand"]).toBe("var(--font-sans)");
		expect(declarationsOf(css, "kicker")).toMatchObject({
			"font-size": "12px",
			"font-weight": "700",
			"letter-spacing": "0.14em",
			"text-transform": "uppercase",
		});
	});
});
