/// <reference types="node" />
import { join } from "node:path";
import { compileAppCss } from "@fnb/zalo-mini/testing/tailwind-css";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// Integration: the shell's style sheet (packages/zalo-mini) as this app's Tailwind build reads it. A class of an
// optional theme role must resolve to its custom property, and an unthemed build must have a default for it that is
// made of roles every brand sets.
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
