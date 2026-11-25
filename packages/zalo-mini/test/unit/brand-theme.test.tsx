import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	AppConfigError,
	type BrandThemeRow,
	brandThemeCss,
	brandThemeOf,
	buildAppConfig,
	buildThemeOf,
	type MiniAppRow,
	readAppConfig,
	THEME_CONTRAST_RULES,
	THEME_TOKENS,
	themeContrast,
	unconfiguredDifferences,
	validateBrandThemeRow,
	validateMiniAppRow,
} from "../../src/app-config/index";
import {
	applyBrandTheme,
	BRAND_THEME_STYLE_ID,
	BrandBanner,
	BrandHero,
	currentBrandTheme,
} from "../../src/react/brand-theme";
import { I18nProvider } from "../../src/react/i18n";
import { deployedAppConfig } from "../../src/vite/index";

// A synthetic palette (not any real brand's): a dark roast banner, a sand page, a clay tile.
const LIGHT = {
	surface: "#F5F1E8",
	surface_raised: "#FFFFFF",
	surface_sunken: "#EAE4D8",
	ink: "#1E1A16",
	ink_muted: "#5A5249",
	line: "#D6CDBE",
	accent: "#1E1A16",
	accent_ink: "#F5F1E8",
	highlight: "#7A4E26",
	hero: "#1E1A16",
	hero_ink: "#F5F1E8",
	tile: "#B9874E",
} as const;
const DARK = {
	surface: "#1B1612",
	surface_raised: "#27201A",
	surface_sunken: "#13100C",
	ink: "#F5F1E8",
	ink_muted: "#C8BBA8",
	line: "#43392F",
	accent: "#B9874E",
	accent_ink: "#1E1A16",
	highlight: "#D6A770",
	hero: "#100C09",
	hero_ink: "#F5F1E8",
	tile: "#B9874E",
} as const;
const THEME: BrandThemeRow = {
	light: LIGHT,
	dark: DARK,
	wordmark: "abcd",
	tagline_vi: "Một quán thử, chỉ để kiểm tra.",
	tagline_en: "A test shop, for checks only.",
	kicker: "Test line",
};
// what a build receives: the row after validation (upper-case wordmark and colours)
const VALID = validateBrandThemeRow(THEME, []) as BrandThemeRow;
const ROW: MiniAppRow = {
	brand_key: "brand-9",
	kind: "customer",
	title: "Thành viên Quán Thử",
	header_title_vi: "Quán Thử",
	header_title_en: "Test Shop",
	header_color_light: "#1E1A16",
	header_color_dark: "#100C09",
	text_color_light: "white",
	text_color_dark: "white",
};

function problemsOf(value: unknown): string[] {
	const problems: string[] = [];
	validateBrandThemeRow(value, problems);
	return problems;
}

function withLight(changes: Partial<Record<string, string>>): unknown {
	return { ...THEME, light: { ...LIGHT, ...changes } };
}

describe("a brand theme in the configuration", () => {
	it("accepts a complete theme, upper-cases the colours and the wordmark", () => {
		const problems: string[] = [];
		const row = validateBrandThemeRow(
			{ ...THEME, light: { ...LIGHT, line: "#d6cdbe" } },
			problems,
		);
		expect(problems).toEqual([]);
		expect(row?.light.line).toBe("#D6CDBE");
		expect(row?.wordmark).toBe("ABCD");
		expect(brandThemeOf(row as BrandThemeRow)).toMatchObject({
			wordmark: "ABCD",
			taglineVi: "Một quán thử, chỉ để kiểm tra.",
			taglineEn: "A test shop, for checks only.",
			kicker: "Test line",
		});
	});

	it("accepts colours only: no wordmark, no tagline", () => {
		expect(problemsOf({ light: LIGHT, dark: DARK })).toEqual([]);
	});

	it("refuses a missing palette, a colour that is not #RRGGBB, an unknown colour and an unknown field", () => {
		expect(problemsOf({ light: LIGHT })).toContain(
			`theme.dark must list the ${THEME_TOKENS.length} colours`,
		);
		for (const bad of ["#12345", "red", "#GGGGGG", "#FFF;}body{x:y", ""]) {
			expect(problemsOf(withLight({ surface: bad })), bad).toContain(
				"theme.light.surface must be a colour such as #241C14",
			);
		}
		expect(problemsOf(withLight({ glow: "#FFFFFF" }))).toContain(
			"theme.light has unknown colours: glow",
		);
		expect(problemsOf({ ...THEME, font: "x" })).toContain(
			"theme has unknown fields: font",
		);
		expect(problemsOf("dark")).toEqual([
			"theme must be an object with light and dark colours",
		]);
	});

	it("checks every contrast rule at its boundary (4.5:1 for text, 3:1 for large text and interface parts)", () => {
		// grey on white: #767676 is the darkest grey above 4.5:1, #777777 falls just below; #949494 / #959595 at 3:1
		expect(themeContrast("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
		expect(themeContrast("#777777", "#FFFFFF")).toBeLessThan(4.5);
		expect(themeContrast("#949494", "#FFFFFF")).toBeGreaterThanOrEqual(3);
		expect(themeContrast("#959595", "#FFFFFF")).toBeLessThan(3);
		const white = {
			surface: "#FFFFFF",
			surface_raised: "#FFFFFF",
			surface_sunken: "#FFFFFF",
		};
		expect(problemsOf(withLight({ ...white, ink_muted: "#767676" }))).toEqual(
			[],
		);
		const below = problemsOf(withLight({ ...white, ink_muted: "#777777" }));
		expect(below).toHaveLength(2);
		expect(below[0]).toMatch(
			/^theme\.light: ink_muted on surface \(secondary text on the page\) has a contrast of 4\.4\d:1, below 4\.5:1$/,
		);
		expect(
			problemsOf(
				withLight({
					...white,
					ink: "#000000",
					accent: "#949494",
					accent_ink: "#000000",
				}),
			),
		).toEqual([]);
		expect(
			problemsOf(
				withLight({
					...white,
					ink: "#000000",
					accent: "#959595",
					accent_ink: "#000000",
				}),
			),
		).toEqual([
			expect.stringMatching(/^theme\.light: accent on surface .* below 3:1$/),
		]);
	});

	it("names each failing rule in the dark palette too, with the use it protects", () => {
		const flat = Object.fromEntries(
			THEME_TOKENS.map((token) => [token, "#808080"]),
		);
		const problems = problemsOf({ light: LIGHT, dark: flat });
		expect(problems).toHaveLength(THEME_CONTRAST_RULES.length);
		for (const rule of THEME_CONTRAST_RULES) {
			expect(problems).toContain(
				`theme.dark: ${rule.foreground} on ${rule.background} (${rule.use}) has a contrast of 1.00:1, below ${rule.minimum}:1`,
			);
		}
	});

	it("bounds the wordmark (1 to 4 letters or digits) and the texts", () => {
		for (const [mark, ok] of [
			["A", true],
			["ĐÀ", true],
			["AB12", true],
			["ABCDE", false],
			["X-O", false],
			["", false],
			["A B", false],
		] as const) {
			expect(problemsOf({ ...THEME, wordmark: mark }).length === 0, mark).toBe(
				ok,
			);
		}
		expect(
			validateBrandThemeRow({ ...THEME, wordmark: "đà" }, [])?.wordmark,
		).toBe("ĐÀ");
		const at = (n: number) => "a".repeat(n);
		expect(
			problemsOf({ ...THEME, tagline_vi: at(80), tagline_en: at(80) }),
		).toEqual([]);
		expect(
			problemsOf({ ...THEME, tagline_vi: at(81), tagline_en: at(80) }),
		).toEqual([
			"theme.tagline_vi must be at most 80 characters without control characters",
		]);
		expect(problemsOf({ ...THEME, kicker: at(40) })).toEqual([]);
		expect(problemsOf({ ...THEME, kicker: at(41) })).toHaveLength(1);
		expect(problemsOf({ ...THEME, kicker: "a\u0007b" })).toHaveLength(1);
		const { tagline_en: _dropped, ...viOnly } = THEME;
		expect(problemsOf(viOnly)).toEqual([
			"theme.tagline_vi and theme.tagline_en are given together",
		]);
	});

	it("carries the theme from a row to the build config, and never into the deployed app-config.json", () => {
		const row = validateMiniAppRow({ ...ROW, theme: THEME });
		expect(row.theme?.wordmark).toBe("ABCD");
		const config = buildAppConfig(row);
		expect(config.theme).toEqual(row.theme);
		const reread = readAppConfig(JSON.parse(JSON.stringify(config)));
		expect(reread.theme).toEqual(row.theme);
		expect(buildThemeOf(reread)?.taglineEn).toBe(
			"A test shop, for checks only.",
		);
		expect(buildThemeOf(buildAppConfig(validateMiniAppRow(ROW)))).toBeNull();
		const deployed = deployedAppConfig(config, {});
		expect(Object.keys(deployed).sort()).toEqual([
			"app",
			"listAsyncJS",
			"listCSS",
			"listSyncJS",
		]);
		expect(JSON.stringify(deployed)).not.toContain("checks only");
	});

	it("refuses a row whose theme fails, with the row's other problems", () => {
		expect(() =>
			validateMiniAppRow({
				...ROW,
				theme: withLight({ accent: "#FFFFFF", accent_ink: "#FFFFFF" }),
			}),
		).toThrow(AppConfigError);
	});

	it("lets two brands differ in their themes without failing the comparison", () => {
		const first = buildAppConfig(validateMiniAppRow(ROW));
		const second = buildAppConfig(validateMiniAppRow({ ...ROW, theme: THEME }));
		expect(unconfiguredDifferences(first, second)).toEqual([]);
	});

	it("writes one style sheet that outranks the tokens, light then dark", () => {
		const css = brandThemeCss(brandThemeOf(VALID));
		expect(css.startsWith("html:root{--surface:#F5F1E8;")).toBe(true);
		expect(css).toContain(
			"@media (prefers-color-scheme: dark){html:root{--surface:#1B1612;",
		);
		expect(css).toContain("--brand-tile:#B9874E");
		expect(css).toContain("--focus:#1E1A16");
		expect(css).toContain(
			"--zaui-light-bottom-navigation-active-color:var(--brand-highlight)",
		);
		expect(css.match(/html:root\{/g)).toHaveLength(2);
	});
});

describe("the brand theme in the running app", () => {
	afterEach(() => applyBrandTheme(null));

	it("adds exactly one style element, replaces it on a second call and removes it without a theme", () => {
		applyBrandTheme(brandThemeOf(VALID));
		applyBrandTheme(brandThemeOf(VALID));
		const styles = document.querySelectorAll(`#${BRAND_THEME_STYLE_ID}`);
		expect(styles).toHaveLength(1);
		expect(styles[0]?.textContent).toBe(brandThemeCss(brandThemeOf(VALID)));
		expect(currentBrandTheme()?.wordmark).toBe("ABCD");
		applyBrandTheme(null);
		expect(document.getElementById(BRAND_THEME_STYLE_ID)).toBeNull();
		expect(currentBrandTheme()).toBeNull();
	});

	function hero(language: "vi" | "en") {
		return render(
			<I18nProvider language={language} catalogs={{ vi: {}, en: {} }}>
				<BrandHero />
			</I18nProvider>,
		);
	}

	it("draws the wordmark as four tiles with the light ones on a diagonal, and the tagline in the app's language", () => {
		applyBrandTheme(brandThemeOf(VALID));
		const { unmount } = hero("vi");
		const tiles = [
			...screen.getByTestId("brand-wordmark").children,
		] as HTMLElement[];
		expect(tiles.map((tile) => tile.textContent)).toEqual(["A", "B", "C", "D"]);
		expect(tiles.map((tile) => tile.style.background)).toEqual([
			"var(--brand-hero-ink)",
			"var(--brand-tile)",
			"var(--brand-tile)",
			"var(--brand-hero-ink)",
		]);
		expect(
			screen.getByTestId("brand-wordmark").getAttribute("aria-hidden"),
		).toBe("true");
		expect(screen.getByText("Một quán thử, chỉ để kiểm tra.")).toBeTruthy();
		expect(screen.getByText("Test line")).toBeTruthy();
		unmount();
		hero("en");
		expect(screen.getByText("A test shop, for checks only.")).toBeTruthy();
	});

	it("draws nothing without a theme, or when the theme has neither a wordmark nor a tagline", () => {
		const { container, unmount } = hero("vi");
		expect(container.innerHTML).toBe("");
		unmount();
		applyBrandTheme(brandThemeOf({ light: LIGHT, dark: DARK }));
		expect(hero("vi").container.innerHTML).toBe("");
	});

	// Test design (ISTQB): equivalence partitions of the home banner, theme or none, with or without a line under the
	// wordmark, room for an overlapping card or not, and the two languages; plus a security case: the line under the
	// wordmark (a customer's Zalo name) is shown as text, never as markup.
	function banner(
		language: "vi" | "en",
		props: { readonly overlap?: boolean; readonly line?: string } = {},
	) {
		return render(
			<I18nProvider language={language} catalogs={{ vi: {}, en: {} }}>
				<BrandBanner overlap={props.overlap ?? false}>{props.line}</BrandBanner>
			</I18nProvider>,
		);
	}

	it("draws the full-width banner with the small wordmark, the line, the tagline and the kicker", () => {
		applyBrandTheme(brandThemeOf(VALID));
		const { unmount } = banner("vi", { line: "Xin chào, Khách thử!" });
		const header = screen.getByTestId("brand-banner");
		expect(header.tagName).toBe("HEADER");
		expect(header.style.background).toBe("var(--brand-hero)");
		expect(header.style.color).toBe("var(--brand-hero-ink)");
		expect(screen.getByTestId("brand-wordmark").textContent).toBe("ABCD");
		expect(screen.getByText("Xin chào, Khách thử!")).toBeTruthy();
		expect(screen.getByText("Một quán thử, chỉ để kiểm tra.")).toBeTruthy();
		expect(screen.getByText("Test line")).toBeTruthy();
		expect(header.className).toContain("pb-7");
		unmount();
		banner("en", { overlap: true });
		expect(screen.getByText("A test shop, for checks only.")).toBeTruthy();
		expect(screen.getByTestId("brand-banner").className).toContain("pb-16");
	});

	it("shows a name with markup in it as plain text", () => {
		applyBrandTheme(brandThemeOf(VALID));
		const name = '<img src="x" onerror="alert(1)">';
		const { container } = banner("vi", { line: name });
		expect(screen.getByText(name)).toBeTruthy();
		expect(container.querySelector("img")).toBeNull();
	});

	it("draws no banner without a theme, so a brand without one keeps the plain page", () => {
		expect(banner("vi", { line: "Xin chào!" }).container.innerHTML).toBe("");
	});
});
