import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "../../../design-tokens/src/generated/palette";
import {
	type BrandPalette,
	type BrandThemeRow,
	brandThemeCss,
	brandThemeOf,
	DEFAULT_STATUS_COLOURS,
	OPTIONAL_THEME_GROUPS,
	OPTIONAL_THEME_TOKENS,
	optionalGroupsOf,
	parseMiniAppConfiguration,
	STATUS_TOKENS,
	THEME_CONTRAST_RULES,
	THEME_TOKENS,
	type ThemeRole,
	themeContrast,
	validateBrandThemeRow,
} from "../../src/app-config/index";

// Test design (ISTQB) for the optional colour roles of a brand theme:
// - equivalence partitions per group: absent, whole, partial, a wrong type, an unknown key;
// - boundary values: every contrast rule at its threshold (a grey that just passes and the next one that just fails);
// - decision tables: the status group (0, 1 to 6 or 7 roles) in light and in dark, the tone groups (numbered from 1);
// - the contrast proof: the table of the design spec over the synthetic brand-3, with ratios computed apart from the code;
// - security: a hostile string in any colour field is refused, and nothing but #RRGGBB reaches the style sheet;
// - regression: the synthetic brand-2 writes the same style sheet as before the optional roles existed.

const packageRoot = join(import.meta.dirname, "..", "..");
const rows = parseMiniAppConfiguration(
	JSON.parse(
		readFileSync(join(packageRoot, "config", "synthetic-brands.json"), "utf8"),
	),
);
const brand3 = rows.find(
	(row) => row.brand_key === "brand-3" && row.kind === "customer",
)?.theme as BrandThemeRow;
const brand2 = rows.find(
	(row) => row.brand_key === "brand-2" && row.kind === "customer",
)?.theme as BrandThemeRow;

type Mode = "light" | "dark";

function problemsOf(value: unknown): string[] {
	const problems: string[] = [];
	validateBrandThemeRow(value, problems);
	return problems;
}

function themeWith(
	changes: Partial<Record<Mode, Record<string, unknown>>>,
): unknown {
	return {
		...brand3,
		light: { ...brand3.light, ...changes.light },
		dark: { ...brand3.dark, ...changes.dark },
	};
}

// a palette without the given roles
function without(
	palette: BrandPalette,
	roles: readonly string[],
): Record<string, unknown> {
	const copy: Record<string, unknown> = { ...palette };
	for (const role of roles) delete copy[role];
	return copy;
}

describe("optional colour roles: what is accepted", () => {
	it("accepts brand-3, which sets every optional group, and keeps its colours as written", () => {
		expect(problemsOf(brand3)).toEqual([]);
		const row = validateBrandThemeRow(brand3, []) as BrandThemeRow;
		expect(row.light).toEqual(brand3.light);
		expect(optionalGroupsOf(row.light)).toEqual(
			Object.keys(OPTIONAL_THEME_GROUPS),
		);
		expect(optionalGroupsOf(row.dark)).toEqual(
			Object.keys(OPTIONAL_THEME_GROUPS),
		);
	});

	it("accepts a theme with the twelve colours only, as before", () => {
		const base = {
			light: without(brand3.light, OPTIONAL_THEME_TOKENS),
			dark: without(brand3.dark, OPTIONAL_THEME_TOKENS),
		};
		expect(problemsOf(base)).toEqual([]);
		const row = validateBrandThemeRow(base, []) as BrandThemeRow;
		expect(optionalGroupsOf(row.light)).toEqual([]);
	});

	it("upper-cases an optional colour and treats a null like an absent one", () => {
		const row = validateBrandThemeRow(
			themeWith({
				light: { line_strong: brand3.light.line_strong?.toLowerCase() },
				dark: { line_strong: brand3.dark.line_strong?.toLowerCase() },
			}),
			[],
		) as BrandThemeRow;
		expect(row.light.line_strong).toBe(brand3.light.line_strong);
		const nulls = Object.fromEntries(
			OPTIONAL_THEME_TOKENS.map((token) => [token, null]),
		);
		expect(
			problemsOf({
				light: { ...without(brand3.light, OPTIONAL_THEME_TOKENS), ...nulls },
				dark: { ...without(brand3.dark, OPTIONAL_THEME_TOKENS), ...nulls },
			}),
		).toEqual([]);
	});

	it("accepts each group on its own, in both palettes", () => {
		for (const [group, tokens] of Object.entries(OPTIONAL_THEME_GROUPS)) {
			if (group === "tone_2" || group === "tone_3" || group === "tone_4") {
				continue; // tones are numbered from 1: see the decision table below
			}
			const only = {
				light: {
					...without(brand3.light, OPTIONAL_THEME_TOKENS),
					...Object.fromEntries(tokens.map((t) => [t, brand3.light[t]])),
				},
				dark: {
					...without(brand3.dark, OPTIONAL_THEME_TOKENS),
					...Object.fromEntries(tokens.map((t) => [t, brand3.dark[t]])),
				},
			};
			expect(problemsOf(only), group).toEqual([]);
		}
	});
});

describe("optional colour roles: what is refused", () => {
	it("refuses a group that is set in part, naming what is missing, in either palette", () => {
		for (const [group, tokens] of Object.entries(OPTIONAL_THEME_GROUPS)) {
			if (tokens.length < 2) continue;
			const [first, ...rest] = tokens;
			const light = problemsOf({
				...brand3,
				light: without(brand3.light, rest),
			});
			// the group's first colour stays, the rest are gone: part of the group
			expect(light, group).toContain(
				`theme.light sets part of the ${group} colours; it needs all of them (missing: ${rest.join(", ")})`,
			);
			const dark = problemsOf({
				...brand3,
				dark: without(brand3.dark, [first]),
			});
			expect(dark.join("\n"), group).toContain(
				`theme.dark sets part of the ${group} colours; it needs all of them (missing: ${first})`,
			);
		}
	});

	it("refuses an unknown colour, a tone numbered 0 or 5, and a role of another group", () => {
		for (const unknown of ["tone_5", "tone_0", "positive_hard", "badge_soft"]) {
			expect(
				problemsOf(themeWith({ light: { [unknown]: "#112233" } })),
				unknown,
			).toContain(`theme.light has unknown colours: ${unknown}`);
		}
	});

	it("refuses a colour of the wrong type or shape, whatever the role", () => {
		const wrong = [
			"red",
			"#FFF",
			"#12345G",
			"123456",
			" #112233",
			"#1122334",
			7,
			true,
			[],
			{},
		];
		for (const token of OPTIONAL_THEME_TOKENS) {
			for (const value of wrong) {
				expect(
					problemsOf(themeWith({ light: { [token]: value } })),
					`${token} = ${JSON.stringify(value)}`,
				).toContain(`theme.light.${token} must be a colour such as #241C14`);
			}
		}
	});

	it("refuses a value that tries to reach the style sheet, in every colour field of both palettes", () => {
		const hostile = [
			"red;}body{display:none",
			"url(javascript:alert(1))",
			"#112233;--surface:#000000",
			"#112233}</style><script>alert(1)</script>",
			"#112233\\;",
			"\\23 112233",
			"var(--ink)",
			"expression(alert(1))",
			"#112233 !important",
			"#11223\u0000",
		];
		for (const mode of ["light", "dark"] as const) {
			for (const token of [...THEME_TOKENS, ...OPTIONAL_THEME_TOKENS]) {
				for (const value of hostile) {
					expect(
						problemsOf(themeWith({ [mode]: { [token]: value } })),
						`${mode}.${token} = ${value}`,
					).toContain(
						`theme.${mode}.${token} must be a colour such as #241C14`,
					);
				}
			}
		}
	});
});

describe("optional colour roles: decision tables", () => {
	// status group: how many of its seven roles each palette sets. Only none-and-none and seven-and-seven pass
	const counts = [0, 1, 3, 6, 7] as const;
	for (const inLight of counts) {
		for (const inDark of counts) {
			const passes =
				(inLight === 0 && inDark === 0) || (inLight === 7 && inDark === 7);
			it(`status roles set: ${inLight} in light, ${inDark} in dark -> ${passes ? "accepted" : "refused"}`, () => {
				const keep = (palette: BrandPalette, count: number) =>
					without(palette, STATUS_TOKENS.slice(count));
				const theme = {
					...brand3,
					light: keep(brand3.light, inLight),
					dark: keep(brand3.dark, inDark),
				};
				const problems = problemsOf(theme);
				// a palette without a status group answers to the design tokens' colours instead: brand-3 passes them
				expect(problems.length === 0, problems.join("; ")).toBe(passes);
				if (
					!passes &&
					inLight !== inDark &&
					inLight % 7 === 0 &&
					inDark % 7 === 0
				) {
					expect(problems).toContain(
						inLight === 7
							? "theme.dark must set the status colours too, as theme.light does"
							: "theme.light must set the status colours too, as theme.dark does",
					);
				}
			});
		}
	}

	// tone groups: which tone numbers are set. 1, 1+2, 1+2+3 and 1..4 pass; a gap or a start above 1 fails
	const tones: ReadonlyArray<readonly [readonly number[], boolean]> = [
		[[], true],
		[[1], true],
		[[1, 2], true],
		[[1, 2, 3], true],
		[[1, 2, 3, 4], true],
		[[2], false],
		[[1, 3], false],
		[[1, 2, 4], false],
		[[2, 3, 4], false],
		[[4], false],
	];
	for (const [numbers, passes] of tones) {
		it(`tone groups ${numbers.length === 0 ? "none" : numbers.join("+")} -> ${passes ? "accepted" : "refused"}`, () => {
			const drop = [1, 2, 3, 4]
				.filter((n) => !numbers.includes(n))
				.flatMap((n) => [`tone_${n}`, `tone_${n}_ink`, `tone_${n}_soft`]);
			const theme = {
				...brand3,
				light: without(brand3.light, drop),
				dark: without(brand3.dark, drop),
			};
			const problems = problemsOf(theme);
			expect(problems.length === 0, problems.join("; ")).toBe(passes);
			if (!passes) {
				expect(problems).toContain(
					"theme.light must number its tone colours from tone_1 without gaps",
				);
			}
		});
	}

	it("refuses a group that only one palette sets, for every group", () => {
		for (const group of Object.keys(OPTIONAL_THEME_GROUPS)) {
			// the status group has its own table above, and a tone below tone_4 would leave a gap, not a lone palette
			if (
				group === "status" ||
				["tone_1", "tone_2", "tone_3"].includes(group)
			) {
				continue;
			}
			const tokens =
				OPTIONAL_THEME_GROUPS[group as keyof typeof OPTIONAL_THEME_GROUPS];
			const onlyLight = problemsOf({
				...brand3,
				dark: without(brand3.dark, tokens),
			});
			expect(onlyLight.join("\n"), group).toContain(
				`theme.dark must set the ${group} colours too, as theme.light does`,
			);
			const onlyDark = problemsOf({
				...brand3,
				light: without(brand3.light, tokens),
			});
			expect(onlyDark.join("\n"), group).toContain(
				`theme.light must set the ${group} colours too, as theme.dark does`,
			);
		}
	});
});

// the largest grey that passes `minimum` against `background` and the next one, which fails (grey steps of 1 in 255)
function boundaryGreys(
	background: string,
	minimum: number,
): { readonly pass: string; readonly fail: string } {
	const grey = (value: number) => {
		const hex = value.toString(16).padStart(2, "0").toUpperCase();
		return `#${hex}${hex}${hex}`;
	};
	const lightBackground =
		themeContrast("#FFFFFF", background) < themeContrast("#000000", background);
	// move away from the background until the contrast stops being enough
	for (let step = 0; step < 255; step += 1) {
		const near = lightBackground ? step : 255 - step;
		const far = lightBackground ? step + 1 : 254 - step;
		if (
			themeContrast(grey(near), background) >= minimum &&
			themeContrast(grey(far), background) < minimum
		) {
			// `near` is the first grey on the passing side whose neighbour fails
			return { pass: grey(near), fail: grey(far) };
		}
	}
	throw new Error(`no boundary against ${background}`);
}

describe("optional colour roles: every rule at its threshold (boundary values)", () => {
	function failures(
		mode: Mode,
		role: ThemeRole,
		colour: string,
	): readonly string[] {
		return problemsOf(themeWith({ [mode]: { [role]: colour } }));
	}

	for (const mode of ["light", "dark"] as const) {
		for (const rule of THEME_CONTRAST_RULES) {
			const background = brand3[mode][rule.background] as string;
			it(`${mode}: ${rule.foreground} on ${rule.background} at ${rule.minimum}:1`, () => {
				const { pass, fail } = boundaryGreys(background, rule.minimum);
				expect(themeContrast(pass, background)).toBeGreaterThanOrEqual(
					rule.minimum,
				);
				expect(themeContrast(fail, background)).toBeLessThan(rule.minimum);
				const prefix = `theme.${mode}: ${rule.foreground} on ${rule.background} (${rule.use}) has a contrast of `;
				expect(
					failures(mode, rule.foreground, pass).filter((problem) =>
						problem.startsWith(prefix),
					),
				).toEqual([]);
				const failed = failures(mode, rule.foreground, fail).filter((problem) =>
					problem.startsWith(prefix),
				);
				expect(failed).toHaveLength(1);
				expect(failed[0]).toMatch(
					new RegExp(
						`${rule.minimum === 3 ? "2\\.9\\d|3\\.0\\d" : "4\\.4\\d|4\\.5\\d"}:1, below ${rule.minimum}:1$`,
					),
				);
			});
		}
	}
});

// The table of the design spec (1.4), computed apart from the code under test over brand-3's palette: a rule, its
// minimum, and the contrast in light and in dark to two decimals.
const BRAND_3_PROOF: ReadonlyArray<
	readonly [ThemeRole, ThemeRole, number, string, string]
> = [
	["ink", "surface", 4.5, "14.89", "16.13"],
	["ink", "surface_raised", 4.5, "16.74", "14.50"],
	["ink", "surface_sunken", 4.5, "12.58", "17.00"],
	["ink_muted", "surface", 4.5, "5.38", "10.30"],
	["ink_muted", "surface_raised", 4.5, "6.05", "9.26"],
	["accent_ink", "accent", 4.5, "9.18", "7.75"],
	["accent", "surface", 3, "8.17", "8.39"],
	["highlight", "surface_raised", 4.5, "9.18", "9.16"],
	["hero_ink", "hero", 4.5, "8.17", "11.15"],
	["tile", "hero", 4.5, "8.17", "11.15"],
	["hero", "tile", 3, "8.17", "11.15"],
	["hero", "hero_ink", 3, "8.17", "11.15"],
	["ink_muted", "surface_sunken", 4.5, "4.55", "10.86"],
	["accent", "surface_raised", 3, "9.18", "7.55"],
	["accent", "surface_sunken", 3, "6.90", "8.85"],
	["highlight", "surface", 4.5, "8.17", "10.19"],
	["highlight", "surface_sunken", 3, "6.90", "10.74"],
	["line_strong", "surface", 3, "3.05", "4.90"],
	["line_strong", "surface_raised", 3, "3.43", "4.41"],
	["badge_ink", "badge", 4.5, "9.30", "9.30"],
	["positive", "surface", 4.5, "4.53", "10.28"],
	["positive", "surface_raised", 4.5, "5.10", "9.24"],
	["surface_raised", "positive", 4.5, "5.10", "9.24"],
	["negative", "surface", 4.5, "6.34", "8.98"],
	["negative", "surface_raised", 4.5, "7.13", "8.08"],
	["warning", "surface", 4.5, "5.55", "10.75"],
	["warning", "warning_soft", 4.5, "5.49", "7.96"],
	["ink", "positive_soft", 4.5, "14.24", "11.98"],
	["ink", "negative_soft", 4.5, "13.67", "12.69"],
	["ink", "warning_soft", 4.5, "14.73", "11.94"],
	["ink", "neutral_soft", 4.5, "13.65", "13.17"],
	["ink_muted", "neutral_soft", 4.5, "4.93", "8.41"],
	["ink_muted", "warning_soft", 4.5, "5.32", "7.63"],
	["ink_muted", "positive_soft", 4.5, "5.15", "7.65"],
	["inverse_ink", "inverse", 4.5, "14.89", "14.89"],
	["tone_1", "surface", 4.5, "6.55", "8.39"],
	["tone_1", "surface_raised", 4.5, "7.37", "7.55"],
	["tone_1_ink", "tone_1", 4.5, "7.37", "7.75"],
	["tone_2", "surface", 4.5, "5.18", "10.29"],
	["tone_2", "surface_raised", 4.5, "5.83", "9.25"],
	["tone_2_ink", "tone_2", 4.5, "5.83", "9.50"],
	["tone_3", "surface", 4.5, "5.26", "9.74"],
	["tone_3", "surface_raised", 4.5, "5.91", "8.76"],
	["tone_3_ink", "tone_3", 4.5, "5.91", "8.99"],
	["tone_4", "surface", 4.5, "5.62", "8.60"],
	["tone_4", "surface_raised", 4.5, "6.32", "7.73"],
	["tone_4_ink", "tone_4", 4.5, "6.32", "7.94"],
];

describe("the contrast proof over the synthetic brand-3", () => {
	it("has a row for every rule the validator applies, in the same order", () => {
		expect(
			BRAND_3_PROOF.map(([foreground, background, minimum]) => [
				foreground,
				background,
				minimum,
			]),
		).toEqual(
			THEME_CONTRAST_RULES.map((rule) => [
				rule.foreground,
				rule.background,
				rule.minimum,
			]),
		);
	});

	it.each(BRAND_3_PROOF)(
		"%s on %s (minimum %s): %s in light, %s in dark",
		(foreground, background, minimum, light, dark) => {
			for (const [mode, expected] of [
				["light", light],
				["dark", dark],
			] as const) {
				const palette = brand3[mode];
				const ratio = themeContrast(
					palette[foreground] as string,
					palette[background] as string,
				);
				expect(ratio.toFixed(2), mode).toBe(expected);
				expect(ratio, mode).toBeGreaterThanOrEqual(minimum);
			}
		},
	);

	it("holds a few pairs within 0.1 of their minimum, as the real handbook palettes do", () => {
		const tight = BRAND_3_PROOF.filter(
			([, , minimum, light]) => Number(light) - minimum < 0.1,
		);
		expect(
			tight.map(([foreground, background]) => `${foreground}/${background}`),
		).toEqual([
			"ink_muted/surface_sunken",
			"line_strong/surface",
			"positive/surface",
		]);
	});

	// the pairs the design spec forbids, as synthetic equivalents in brand-3's palette: each must fail its rule
	const forbidden: ReadonlyArray<
		readonly [string, Mode, Record<string, string>, string]
	> = [
		[
			"the badge colour used as text on the page (a fill, never text on a light ground)",
			"light",
			{ highlight: "#F0B84B" },
			"highlight on surface",
		],
		[
			"the badge colour used as the highlight on a card",
			"light",
			{ highlight: "#F0B84B" },
			"highlight on surface_raised",
		],
		[
			"the badge colour as the hero's text on a coloured hero",
			"light",
			{ hero: "#F0B84B", hero_ink: "#F5F0F6" },
			"hero_ink on hero",
		],
		[
			"a mid-tone accent whose text is too faint on the page",
			"light",
			{ highlight: "#B070C0" },
			"highlight on surface",
		],
		[
			"the dark accent leaking into the light palette",
			"light",
			{ accent: "#D79BE6" },
			"accent on surface",
		],
		[
			"warning text on its own box, too light",
			"light",
			{ warning: "#B08A30" },
			"warning on warning_soft",
		],
		[
			"secondary text too light on a neutral box",
			"light",
			{ ink_muted: "#8A7C95" },
			"ink_muted on neutral_soft",
		],
		[
			"a tone label that cannot be read on its own fill",
			"dark",
			{ tone_2_ink: "#7FD0D8" },
			"tone_2_ink on tone_2",
		],
		[
			"an edge for fields that disappears on a card",
			"dark",
			{ line_strong: "#3A2D44" },
			"line_strong on surface_raised",
		],
	];
	it.each(forbidden)("refuses %s", (_name, mode, changes, rule) => {
		const problems = problemsOf(themeWith({ [mode]: changes }));
		expect(
			problems.some((problem) => problem.includes(`${mode}: ${rule} (`)),
			`${rule} in ${problems.join(" | ")}`,
		).toBe(true);
	});
});

describe("a brand without a status group meets the design tokens' status colours", () => {
	// a slightly darker page, on which the default green (#1B7A48) falls just under 4.5:1; everything else of
	// brand-3 still passes (its field edge is darkened to keep 3:1)
	const dimmer = { surface: "#E8E4EB", line_strong: "#7E6C8B" };
	const noStatus = (palette: BrandPalette, changes: Record<string, string>) =>
		({
			...without(palette, STATUS_TOKENS),
			...changes,
		}) as Record<string, unknown>;

	it("refuses a page on which a default status colour cannot be read, and names the default", () => {
		const problems = problemsOf({
			...brand3,
			light: noStatus(brand3.light, dimmer),
			dark: without(brand3.dark, STATUS_TOKENS),
		});
		expect(problems).toEqual([
			"theme.light: positive (default) on surface (positive text on the page) has a contrast of 4.26:1, below 4.5:1; the status colours are not set, so the default ones apply",
		]);
	});

	it("accepts the same page once the brand sets a status colour that suits it, in both palettes", () => {
		expect(
			problemsOf({
				...brand3,
				light: { ...brand3.light, ...dimmer, positive: "#1F6B40" },
			}),
		).toEqual([]);
	});

	it("takes the dark defaults for the dark palette, and says they are the defaults", () => {
		// white ink on a mid-grey dark page: the default dark soft boxes and green are too faint against it
		const problems = problemsOf({
			...brand3,
			light: without(brand3.light, STATUS_TOKENS),
			dark: noStatus(brand3.dark, {
				surface: "#6A6A6A",
				surface_raised: "#6A6A6A",
				surface_sunken: "#6A6A6A",
				ink: "#FFFFFF",
				ink_muted: "#FFFFFF",
			}),
		});
		expect(
			problems.some(
				(problem) =>
					problem.startsWith("theme.dark: positive (default) on surface") &&
					problem.endsWith("the default ones apply"),
			),
		).toBe(true);
		expect(problems.every((problem) => problem.startsWith("theme.dark:"))).toBe(
			true,
		);
	});

	it("keeps the defaults in step with the design tokens", () => {
		for (const mode of ["light", "dark"] as const) {
			const tokens = colors[mode];
			expect(DEFAULT_STATUS_COLOURS[mode]).toEqual({
				positive: tokens.positive.toUpperCase(),
				positive_soft: tokens["positive-soft"].toUpperCase(),
				negative: tokens.negative.toUpperCase(),
				negative_soft: tokens["negative-soft"].toUpperCase(),
				warning: tokens.warning.toUpperCase(),
				warning_soft: tokens["warning-soft"].toUpperCase(),
				neutral_soft: tokens["neutral-soft"].toUpperCase(),
			});
		}
	});

	it("still accepts the synthetic brands that set no status group (brand-2)", () => {
		expect(problemsOf(brand2)).toEqual([]);
	});
});

describe("the style sheet of a theme with optional roles", () => {
	it("writes the optional roles after the twelve, light then dark, each as a custom property", () => {
		const css = brandThemeCss(brandThemeOf(brand3));
		const light = css.slice(0, css.indexOf("@media"));
		const names = [...light.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
		expect(names.slice(0, 12)).toEqual([
			"surface",
			"surface-raised",
			"surface-sunken",
			"ink",
			"ink-muted",
			"line",
			"accent",
			"accent-ink",
			"brand-highlight",
			"brand-hero",
			"brand-hero-ink",
			"brand-tile",
		]);
		expect(names.slice(12, 12 + OPTIONAL_THEME_TOKENS.length)).toEqual([
			"line-strong",
			"badge",
			"badge-ink",
			"positive",
			"positive-soft",
			"negative",
			"negative-soft",
			"warning",
			"warning-soft",
			"neutral-soft",
			"inverse",
			"inverse-ink",
			"tone-1",
			"tone-1-ink",
			"tone-1-soft",
			"tone-2",
			"tone-2-ink",
			"tone-2-soft",
			"tone-3",
			"tone-3-ink",
			"tone-3-soft",
			"tone-4",
			"tone-4-ink",
			"tone-4-soft",
			"art-plate",
		]);
		expect(css).toContain(`--tone-2-soft:${brand3.light.tone_2_soft}`);
		expect(css).toContain(`--tone-2-soft:${brand3.dark.tone_2_soft}`);
		expect(css).toContain(`--line-strong:${brand3.dark.line_strong}`);
		expect(css.match(/html:root\{/g)).toHaveLength(2);
	});

	it("writes nothing for a group that is not set", () => {
		const minimal = {
			...brand3,
			light: without(brand3.light, OPTIONAL_THEME_TOKENS),
			dark: without(brand3.dark, OPTIONAL_THEME_TOKENS),
		} as BrandThemeRow;
		const css = brandThemeCss(brandThemeOf(minimal));
		for (const name of [
			"--line-strong",
			"--badge",
			"--positive",
			"--inverse",
			"--tone-1",
			"--art-plate",
		]) {
			expect(css, name).not.toContain(name);
		}
	});

	it("is byte for byte what it was for the synthetic brand-2, which sets no optional role", () => {
		expect(brandThemeCss(brandThemeOf(brand2))).toBe(
			"html:root{--surface:#F3F5F8;--surface-raised:#FFFFFF;--surface-sunken:#E6EAF0;--ink:#14213D;--ink-muted:#4A5568;--line:#CBD2DC;--accent:#14213D;--accent-ink:#FFFFFF;--brand-highlight:#1F4E8C;--brand-hero:#14213D;--brand-hero-ink:#F3F5F8;--brand-tile:#E0A458;--focus:#14213D;--zaui-light-bottom-navigation-active-color:var(--brand-highlight);--zaui-dark-bottom-navigation-active-color:var(--brand-highlight)}@media (prefers-color-scheme: dark){html:root{--surface:#0F1626;--surface-raised:#18223A;--surface-sunken:#0A0F1A;--ink:#EEF1F6;--ink-muted:#B4BCCB;--line:#2E3A52;--accent:#E0A458;--accent-ink:#14213D;--brand-highlight:#8FB8F0;--brand-hero:#0A0F1A;--brand-hero-ink:#EEF1F6;--brand-tile:#E0A458;--focus:#E0A458;--zaui-light-bottom-navigation-active-color:var(--brand-highlight);--zaui-dark-bottom-navigation-active-color:var(--brand-highlight)}}",
		);
	});

	it("never writes anything but #RRGGBB, even if a hostile value got past the configuration", () => {
		// a theme object built by hand, as a corrupted build config would hold it: the writer is the second line of defence
		const hostile = "red;}body{display:none";
		const theme = brandThemeOf(brand3);
		const poisoned = {
			...theme,
			light: {
				...theme.light,
				badge: hostile,
				tone_1: "url(javascript:alert(1))",
				accent: "</style><script>alert(1)</script>",
				line_strong: "#112233;--surface:#000000",
			},
		};
		const css = brandThemeCss(poisoned);
		for (const bad of [
			hostile,
			"url(",
			"</style>",
			"<script",
			"--surface:#000000",
			"javascript:",
		]) {
			expect(css, bad).not.toContain(bad);
		}
		// the poisoned light values are left out; the dark palette, which was not touched, keeps its own
		const light = css.slice(0, css.indexOf("@media"));
		for (const name of [
			"--badge:",
			"--tone-1:",
			"--line-strong:",
			"--accent:",
			"--focus:",
		]) {
			expect(light, name).not.toContain(name);
		}
		expect(css).toContain(`--badge:${brand3.dark.badge}`);
		// what remains is made only of #RRGGBB values, var() of the two Zalo links and the media query
		const stripped = css
			.replace(/--[a-z0-9-]+:#[0-9A-F]{6}/g, "")
			.replace(
				/--zaui-(light|dark)-bottom-navigation-active-color:var\(--brand-highlight\)/g,
				"",
			)
			.replace(/@media \(prefers-color-scheme: dark\)/, "")
			.replace(/html:root/g, "");
		expect(stripped.replace(/[;{}]/g, "")).toBe("");
	});
});

// The real brand's file is private and may be absent (CI, another machine). When it is there, the validator must take
// its roles, and the synthetic brands must not borrow its colours.
const privateBrandFile = join(
	packageRoot,
	"..",
	"..",
	"docs",
	"private",
	"zalo",
	"brand-1.json",
);

describe.skipIf(!existsSync(privateBrandFile))(
	"the owner's private brand file",
	() => {
		const file = existsSync(privateBrandFile)
			? JSON.parse(readFileSync(privateBrandFile, "utf8"))
			: { mini_apps: [] };

		it("is accepted by the validator, with every role it sets", () => {
			const accepted = parseMiniAppConfiguration({
				mini_apps: file.mini_apps.map((row: object) => ({
					brand_key: file.brand,
					...row,
				})),
			});
			expect(accepted.length).toBeGreaterThan(0);
		});

		it("shares no colour with the synthetic brands", () => {
			const owned = new Set<string>();
			for (const row of file.mini_apps) {
				for (const mode of ["light", "dark"] as const) {
					for (const colour of Object.values(row.theme?.[mode] ?? {})) {
						owned.add(String(colour).toUpperCase());
					}
				}
			}
			for (const row of rows) {
				for (const mode of ["light", "dark"] as const) {
					for (const colour of Object.values(row.theme?.[mode] ?? {})) {
						// white and black belong to everyone
						if (colour === "#FFFFFF" || colour === "#000000") continue;
						expect(
							owned.has(colour),
							`${row.brand_key} ${mode} ${colour}`,
						).toBe(false);
					}
				}
			}
		});
	},
);
