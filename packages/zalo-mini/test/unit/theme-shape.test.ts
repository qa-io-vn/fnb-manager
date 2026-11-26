import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type BrandTheme,
	type BrandThemeRow,
	brandThemeCss,
	brandThemeOf,
	buildAppConfig,
	buildThemeOf,
	parseMiniAppConfiguration,
	readAppConfig,
	validateBrandThemeRow,
	validateMiniAppRow,
} from "../../src/app-config/index";
import { deployedAppConfig } from "../../src/vite/index";

// Test design (ISTQB) for theme.shape and theme.type:
// - equivalence partitions per field: absent, a valid value, a wrong type, an unknown key, null (= absent);
// - boundary values: a radius of -0.5, 0, 0.5, 32 and 32.5 (control 24 and 24.5, sheet 40 and 40.5), the step of 0.5 (18.25
//   is refused, 18.5 is not), a border of 1, 1.5 and 2 and the values beside them, an outline of 1.5 and 2, a body of 15
//   and 16 and the sizes beside them;
// - the decision table of the style sheet: which custom properties each field writes (and that "pill" and shadow
//   true write what the defaults already are);
// - security: a hostile string or an out-of-range number in any field is refused, and a theme object built by hand
//   (a corrupted build config) writes nothing but bounded numbers;
// - regression: a theme without shape and type writes the style sheet it wrote before they existed.

const rows = parseMiniAppConfiguration(
	JSON.parse(
		readFileSync(
			join(import.meta.dirname, "..", "..", "config", "synthetic-brands.json"),
			"utf8",
		),
	),
);
const brand3 = rows.find(
	(row) => row.brand_key === "brand-3" && row.kind === "customer",
)?.theme as BrandThemeRow;
const brand2 = rows.find(
	(row) => row.brand_key === "brand-2" && row.kind === "customer",
)?.theme as BrandThemeRow;

function problemsOf(value: unknown): string[] {
	const problems: string[] = [];
	validateBrandThemeRow(value, problems);
	return problems;
}

function withShape(shape: unknown): unknown {
	return { ...brand2, shape };
}

function withType(type: unknown): unknown {
	return { ...brand2, type };
}

const FULL = {
	card: 18,
	panel: 22,
	control: "pill",
	field: 14,
	tile: 12,
	sheet: 24,
	border: 1.5,
	outline: 2,
	shadow: false,
} as const;

describe("theme.shape: what is accepted", () => {
	it("accepts every field at the values of a rounded, flat brand", () => {
		expect(problemsOf(withShape(FULL))).toEqual([]);
		const row = validateBrandThemeRow(withShape(FULL), []) as BrandThemeRow;
		expect(row.shape).toEqual(FULL);
	});

	it("accepts a theme without shape or type, an empty shape, a null and a part of the fields", () => {
		expect(problemsOf(brand2)).toEqual([]);
		expect(problemsOf(withShape({}))).toEqual([]);
		expect(problemsOf(withShape(null))).toEqual([]);
		expect(problemsOf(withShape({ card: 18 }))).toEqual([]);
		expect(problemsOf(withShape({ shadow: true }))).toEqual([]);
		expect(problemsOf(withShape({ card: null, control: null }))).toEqual([]);
		const row = validateBrandThemeRow(
			withShape({ card: null, field: 14 }),
			[],
		) as BrandThemeRow;
		expect(row.shape).toEqual({ field: 14 });
		const none = validateBrandThemeRow(withShape(null), []) as BrandThemeRow;
		expect(none.shape).toBeUndefined();
	});

	it("keeps brand-3's shape and type through a build config and never into the deployed file", () => {
		expect(brand3.shape).toBeDefined();
		const row = validateMiniAppRow({
			brand_key: "brand-9",
			kind: "customer",
			title: "Thành viên Quán Thử",
			header_title_vi: "Quán Thử",
			header_title_en: "Test Shop",
			header_color_light: "#F5F0F6",
			header_color_dark: "#1A1320",
			text_color_light: "black",
			text_color_dark: "white",
			theme: brand3,
		});
		const config = buildAppConfig(row);
		const reread = readAppConfig(JSON.parse(JSON.stringify(config)));
		expect(buildThemeOf(reread)?.shape).toEqual(brand3.shape);
		expect(buildThemeOf(reread)?.type).toEqual(brand3.type);
		expect(JSON.stringify(deployedAppConfig(config, {}))).not.toContain(
			"radius",
		);
		expect(Object.keys(deployedAppConfig(config, {})).sort()).toEqual([
			"app",
			"listAsyncJS",
			"listCSS",
			"listSyncJS",
		]);
	});
});

describe("theme.shape: radii at their boundaries", () => {
	// field, the largest allowed, then the first value above it
	const limits: ReadonlyArray<readonly [string, number]> = [
		["card", 32],
		["panel", 32],
		["field", 32],
		["tile", 32],
		["control", 24],
		["sheet", 40],
	];
	for (const [field, max] of limits) {
		it(`${field}: -0.5, 0, 0.5 and ${max} are judged right, ${max + 0.5} is refused`, () => {
			const refusal = `theme.shape.${field} must be ${field === "control" ? '"pill" or ' : ""}a number from 0 to ${max} in steps of 0.5`;
			expect(problemsOf(withShape({ [field]: -0.5 })), "-0.5").toEqual([
				refusal,
			]);
			expect(problemsOf(withShape({ [field]: 0 })), "0").toEqual([]);
			expect(problemsOf(withShape({ [field]: 0.5 })), "0.5").toEqual([]);
			expect(problemsOf(withShape({ [field]: max })), String(max)).toEqual([]);
			expect(
				problemsOf(withShape({ [field]: max + 0.5 })),
				String(max + 0.5),
			).toEqual([refusal]);
		});
	}

	it("accepts a radius in steps of 0.5 and refuses a finer one", () => {
		expect(problemsOf(withShape({ card: 18.5 }))).toEqual([]);
		expect(problemsOf(withShape({ card: 18.25 }))).toHaveLength(1);
		expect(problemsOf(withShape({ card: 18.01 }))).toHaveLength(1);
		expect(problemsOf(withShape({ card: 0.1 + 0.2 }))).toHaveLength(1);
	});

	it("takes the control as the word pill or a number, and nothing else", () => {
		expect(problemsOf(withShape({ control: "pill" }))).toEqual([]);
		expect(problemsOf(withShape({ control: 24 }))).toEqual([]);
		expect(problemsOf(withShape({ control: 24.5 }))).toHaveLength(1);
		for (const bad of ["round", "Pill", "PILL", "pill ", "9999", "full", ""]) {
			expect(problemsOf(withShape({ control: bad })), bad).toHaveLength(1);
		}
	});
});

describe("theme.shape: border, outline and shadow", () => {
	it("takes a border of 1, 1.5 or 2 only", () => {
		for (const ok of [1, 1.5, 2]) {
			expect(problemsOf(withShape({ border: ok })), String(ok)).toEqual([]);
		}
		for (const bad of [0, 0.5, 0.99, 1.25, 1.51, 2.5, 3, -1, "1.5", true]) {
			expect(problemsOf(withShape({ border: bad })), String(bad)).toEqual([
				"theme.shape.border must be 1, 1.5 or 2",
			]);
		}
	});

	it("takes an outline of 1.5 or 2 only", () => {
		for (const ok of [1.5, 2]) {
			expect(problemsOf(withShape({ outline: ok })), String(ok)).toEqual([]);
		}
		for (const bad of [0, 1, 1.49, 2.5, 3, "2", false]) {
			expect(problemsOf(withShape({ outline: bad })), String(bad)).toEqual([
				"theme.shape.outline must be 1.5 or 2",
			]);
		}
	});

	it("takes a shadow of true or false only", () => {
		expect(problemsOf(withShape({ shadow: true }))).toEqual([]);
		expect(problemsOf(withShape({ shadow: false }))).toEqual([]);
		for (const bad of ["false", "true", 0, 1, [], {}]) {
			expect(
				problemsOf(withShape({ shadow: bad })),
				JSON.stringify(bad),
			).toEqual(["theme.shape.shadow must be true or false"]);
		}
	});
});

describe("theme.shape and theme.type: what is refused", () => {
	it("refuses a shape that is not an object and an unknown key", () => {
		for (const bad of ["round", 18, true, [], [18]]) {
			expect(problemsOf(withShape(bad)), JSON.stringify(bad)).toEqual([
				"theme.shape must be an object",
			]);
		}
		expect(problemsOf(withShape({ glow: 4 }))).toEqual([
			"theme.shape has unknown fields: glow",
		]);
		expect(problemsOf(withShape({ card: 18, glow: 4, blur: 2 }))).toEqual([
			"theme.shape has unknown fields: glow, blur",
		]);
	});

	it("refuses a number of the wrong kind in every radius", () => {
		for (const field of [
			"card",
			"panel",
			"control",
			"field",
			"tile",
			"sheet",
		]) {
			for (const bad of [
				Number.NaN,
				Number.POSITIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				1e21,
				"18",
				"18px",
				true,
				[],
				{},
			]) {
				expect(
					problemsOf(withShape({ [field]: bad })),
					`${field} = ${String(bad)}`,
				).toHaveLength(1);
			}
		}
	});

	it("refuses a hostile string in every shape and type field, so nothing reaches the style sheet", () => {
		const hostile = [
			"18px;}body{display:none",
			"url(javascript:alert(1))",
			"</style><script>alert(1)</script>",
			"18px !important",
			"calc(100vw)",
			"var(--ink)",
			"expression(alert(1))",
			"\\31 8px",
			"1e3",
			"18\u0000",
		];
		for (const field of [
			"card",
			"panel",
			"control",
			"field",
			"tile",
			"sheet",
			"border",
			"outline",
			"shadow",
		]) {
			for (const value of hostile) {
				expect(
					problemsOf(withShape({ [field]: value })),
					`shape.${field} = ${value}`,
				).toHaveLength(1);
			}
		}
		for (const value of hostile) {
			expect(
				problemsOf(withType({ body: value })),
				`type.body = ${value}`,
			).toEqual(["theme.type.body must be 15 or 16"]);
		}
	});

	it("takes a body size of 15 or 16 and nothing beside them", () => {
		expect(problemsOf(withType({ body: 15 }))).toEqual([]);
		expect(problemsOf(withType({ body: 16 }))).toEqual([]);
		expect(problemsOf(withType({}))).toEqual([]);
		expect(problemsOf(withType(null))).toEqual([]);
		expect(problemsOf(withType({ body: null }))).toEqual([]);
		for (const bad of [
			14,
			14.99,
			15.5,
			16.01,
			17,
			0,
			-15,
			"15",
			"16px",
			true,
		]) {
			expect(problemsOf(withType({ body: bad })), String(bad)).toEqual([
				"theme.type.body must be 15 or 16",
			]);
		}
	});

	it("refuses a type that is not an object and an unknown key", () => {
		for (const bad of ["15", 15, true, []]) {
			expect(problemsOf(withType(bad)), JSON.stringify(bad)).toEqual([
				"theme.type must be an object",
			]);
		}
		expect(problemsOf(withType({ heading: 22 }))).toEqual([
			"theme.type has unknown fields: heading",
		]);
	});

	it("names each problem when several fields are wrong at once", () => {
		expect(
			problemsOf({
				...brand2,
				shape: { card: 40, border: 3, shadow: "no", glow: 1 },
				type: { body: 14 },
			}),
		).toEqual([
			"theme.shape has unknown fields: glow",
			"theme.shape.card must be a number from 0 to 32 in steps of 0.5",
			"theme.shape.border must be 1, 1.5 or 2",
			"theme.shape.shadow must be true or false",
			"theme.type.body must be 15 or 16",
		]);
	});
});

describe("the style sheet of a theme with shape and type", () => {
	function css(shape: unknown, type?: unknown): string {
		const row = validateBrandThemeRow(
			{ ...brand2, shape, ...(type === undefined ? {} : { type }) },
			[],
		) as BrandThemeRow;
		return brandThemeCss(brandThemeOf(row));
	}
	it("writes the full shape of a rounded, flat brand", () => {
		const sheet = css(FULL, { body: 15 });
		const base = sheet.slice(0, sheet.indexOf("@media"));
		for (const declaration of [
			"--radius-card:18px",
			"--radius-panel:22px",
			"--radius-control:9999px",
			"--radius-field:14px",
			"--radius-tile:12px",
			"--radius-sheet:24px",
			"--card-border:1.5px",
			"--field-border:1.5px",
			"--outline-width:2px",
			"--card-shadow:none",
			"--text-body:15px",
			"--text-body--line-height:1.45",
		]) {
			expect(base, declaration).toContain(declaration);
		}
	});

	it("writes the shape once, in the first block, so dark mode keeps it", () => {
		const sheet = css(FULL, { body: 15 });
		expect(sheet.match(/--radius-card:/g)).toHaveLength(1);
		expect(sheet.indexOf("--radius-card:")).toBeLessThan(
			sheet.indexOf("@media"),
		);
		expect(sheet.match(/html:root\{/g)).toHaveLength(2);
	});

	// decision table: field -> what it writes
	it.each([
		[{ card: 18 }, "--radius-card:18px"],
		[{ card: 0 }, "--radius-card:0px"],
		[{ card: 22.5 }, "--radius-card:22.5px"],
		[{ panel: 22 }, "--radius-panel:22px"],
		[{ control: "pill" }, "--radius-control:9999px"],
		[{ control: 12 }, "--radius-control:12px"],
		[{ control: 0 }, "--radius-control:0px"],
		[{ field: 14 }, "--radius-field:14px"],
		[{ tile: 12 }, "--radius-tile:12px"],
		[{ sheet: 24 }, "--radius-sheet:24px"],
		[{ border: 1 }, "--card-border:1px;--field-border:1px"],
		[{ border: 1.5 }, "--card-border:1.5px;--field-border:1.5px"],
		[
			{ outline: 1.5 },
			"--outline-width:1.5px;--outline-color:var(--ink);--outline-danger-color:var(--negative)",
		],
		[{ shadow: false }, "--card-shadow:none"],
	])("writes %j as %s", (shape, written) => {
		expect(css(shape)).toContain(written);
	});

	it("writes nothing for a shadow that stays, so today's shadow answers", () => {
		expect(css({ shadow: true })).not.toContain("--card-shadow");
		expect(css({ shadow: true })).toBe(css({}));
	});

	it("writes the body size only for 15, which also takes the tighter line height", () => {
		expect(css({}, { body: 15 })).toContain(
			"--text-body:15px;--text-body--line-height:1.45",
		);
		expect(css({}, { body: 16 })).not.toContain("--text-body");
		expect(css({}, {})).toBe(css({}));
	});

	it("writes the same style sheet as before for a theme without shape and type (the synthetic brand-2)", () => {
		expect(brandThemeCss(brandThemeOf(brand2))).toBe(css(undefined));
		expect(brandThemeCss(brandThemeOf(brand2))).not.toMatch(
			/--radius|--card-|--field-border|--outline-width|--text-body/,
		);
	});

	it("never writes anything but bounded numbers, even for a theme object built by hand", () => {
		const theme = brandThemeOf(brand2);
		const poisoned = {
			...theme,
			shape: {
				card: "18px;}body{display:none",
				panel: 1e21,
				control: "url(javascript:alert(1))",
				field: Number.NaN,
				tile: -4,
				sheet: 41,
				border: 7,
				outline: "2",
				shadow: "none",
			},
			type: { body: "15px}" },
		} as unknown as BrandTheme;
		const sheet = brandThemeCss(poisoned);
		expect(sheet).toBe(brandThemeCss(theme));
		for (const bad of [
			"body{",
			"url(",
			"javascript:",
			"1e21",
			"NaN",
			"--card-shadow",
		]) {
			expect(sheet, bad).not.toContain(bad);
		}
	});

	it("writes only what is a number in the bounds, field by field, when the rest is poisoned", () => {
		const theme = brandThemeOf(brand2);
		const sheet = brandThemeCss({
			...theme,
			shape: { card: 18, panel: Number.NaN, control: "pill", tile: 33 },
		} as unknown as BrandTheme);
		expect(sheet).toContain("--radius-card:18px");
		expect(sheet).toContain("--radius-control:9999px");
		expect(sheet).not.toContain("--radius-panel");
		expect(sheet).not.toContain("--radius-tile");
	});
});
