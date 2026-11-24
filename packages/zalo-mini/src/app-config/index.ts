export const MINI_APP_KINDS = ["staff", "customer"] as const;

export type MiniAppKind = (typeof MINI_APP_KINDS)[number];

export const HEADER_TEXT_COLORS = ["white", "black"] as const;

export type HeaderTextColor = (typeof HEADER_TEXT_COLORS)[number];

export interface MiniAppRow {
	readonly brand_key: string;
	readonly kind: MiniAppKind;
	readonly title: string;
	readonly header_title_vi: string;
	readonly header_title_en: string;
	readonly header_color_light: string;
	readonly header_color_dark: string;
	readonly text_color_light: HeaderTextColor;
	readonly text_color_dark: HeaderTextColor;
	/** The brand's palette and wordmark (optional; the design tokens apply without it). */
	readonly theme?: BrandThemeRow;
}

export interface AppConfigApp {
	readonly title: string;
	readonly headerTitle: { readonly vi: string; readonly en: string };
	readonly headerColor: { readonly light: string; readonly dark: string };
	readonly textColor: {
		readonly light: HeaderTextColor;
		readonly dark: HeaderTextColor;
	};
	readonly statusBarType: "normal";
	readonly hideIOSSafeAreaBottom: false;
	readonly hideAndroidBottomNavigationBar: false;
}

export interface AppConfig {
	readonly app: AppConfigApp;
	readonly listCSS: readonly string[];
	readonly listSyncJS: readonly string[];
	readonly listAsyncJS: readonly string[];
	/** Read by the build only: the deployed app-config.json never carries it. */
	readonly theme?: BrandThemeRow;
}

export interface MiniAppBuildConfig {
	readonly brand: string;
	readonly kind: MiniAppKind;
	readonly app: AppConfigApp;
	readonly theme?: BrandTheme | null;
}

export function buildThemeOf(config: AppConfig): BrandTheme | null {
	return config.theme === undefined ? null : brandThemeOf(config.theme);
}

export const CONFIGURED_APP_FIELDS: readonly string[] = [
	"app.title",
	"app.headerTitle.vi",
	"app.headerTitle.en",
	"app.headerColor.light",
	"app.headerColor.dark",
	"app.textColor.light",
	"app.textColor.dark",
];

export const TITLE_MIN_LENGTH = 3;
export const TITLE_MAX_LENGTH = 50;
export const HEADER_TITLE_MAX_LENGTH = 50;
export const MIN_HEADER_CONTRAST = 4.5;

const BRAND_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const FORBIDDEN_TITLE_WORDS: readonly RegExp[] = [
	/zalo/i,
	/mini\s*app/i,
	/(^|[^\p{L}\p{N}])app([^\p{L}\p{N}]|$)/iu,
];

export class AppConfigError extends Error {
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(problems.join("; "));
		this.name = "AppConfigError";
		this.problems = problems;
	}
}

export function titleProblems(title: string): string[] {
	const problems: string[] = [];
	const length = [...title.trim()].length;
	if (length < TITLE_MIN_LENGTH || length > TITLE_MAX_LENGTH) {
		problems.push(
			`title must be ${TITLE_MIN_LENGTH} to ${TITLE_MAX_LENGTH} characters`,
		);
	}
	if (
		title === title.toLocaleUpperCase("vi") &&
		title !== title.toLocaleLowerCase("vi")
	) {
		problems.push("title must not be written in capitals only");
	}
	if (FORBIDDEN_TITLE_WORDS.some((pattern) => pattern.test(title))) {
		problems.push("title must not contain Zalo, App or Mini App");
	}
	return problems;
}

function channel(value: number): number {
	const scaled = value / 255;
	return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const red = Number.parseInt(hex.slice(1, 3), 16);
	const green = Number.parseInt(hex.slice(3, 5), 16);
	const blue = Number.parseInt(hex.slice(5, 7), 16);
	return (
		0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
	);
}

export function contrastRatio(first: string, second: string): number {
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const TEXT_COLOR_HEX: Readonly<Record<HeaderTextColor, string>> = {
	white: "#FFFFFF",
	black: "#000000",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(
	row: Record<string, unknown>,
	field: string,
	problems: string[],
): string {
	const value = row[field];
	if (typeof value !== "string" || value.trim() === "") {
		problems.push(`${field} is required`);
		return "";
	}
	return value.trim();
}

interface ThemeColors {
	readonly headerColor: string;
	readonly textColor: HeaderTextColor | undefined;
}

function themeColors(
	row: Record<string, unknown>,
	theme: "light" | "dark",
	problems: string[],
): ThemeColors {
	const headerColor = requireText(row, `header_color_${theme}`, problems);
	const validHeader = HEX_COLOR_PATTERN.test(headerColor);
	if (headerColor !== "" && !validHeader) {
		problems.push(`header_color_${theme} must be a colour such as #0A6B56`);
	}
	const textColor = HEADER_TEXT_COLORS.find(
		(name) => name === row[`text_color_${theme}`],
	);
	if (!textColor) problems.push(`text_color_${theme} must be white or black`);
	if (
		textColor &&
		validHeader &&
		contrastRatio(headerColor, TEXT_COLOR_HEX[textColor]) < MIN_HEADER_CONTRAST
	) {
		problems.push(
			`the ${theme} header colour and its text colour need a contrast of at least ${MIN_HEADER_CONTRAST}:1`,
		);
	}
	return { headerColor: headerColor.toUpperCase(), textColor };
}

export function validateMiniAppRow(value: unknown): MiniAppRow {
	if (!isRecord(value)) throw new AppConfigError(["a row must be an object"]);
	const problems: string[] = [];
	const brandKey = requireText(value, "brand_key", problems);
	if (brandKey !== "" && !BRAND_KEY_PATTERN.test(brandKey)) {
		problems.push("brand_key must be a neutral key such as brand-1");
	}
	const kind = MINI_APP_KINDS.find((name) => name === value.kind);
	if (!kind) problems.push("kind must be staff or customer");
	const title = requireText(value, "title", problems);
	if (title !== "") problems.push(...titleProblems(title));
	const headerTitleVi = requireText(value, "header_title_vi", problems);
	const headerTitleEn = requireText(value, "header_title_en", problems);
	for (const [field, text] of [
		["header_title_vi", headerTitleVi],
		["header_title_en", headerTitleEn],
	] as const) {
		if ([...text].length > HEADER_TITLE_MAX_LENGTH) {
			problems.push(
				`${field} must be at most ${HEADER_TITLE_MAX_LENGTH} characters`,
			);
		}
	}
	const light = themeColors(value, "light", problems);
	const dark = themeColors(value, "dark", problems);
	const theme =
		value.theme === undefined || value.theme === null
			? null
			: validateBrandThemeRow(value.theme, problems);
	if (problems.length > 0 || !kind || !light.textColor || !dark.textColor) {
		throw new AppConfigError(problems);
	}
	return {
		brand_key: brandKey,
		kind,
		title,
		header_title_vi: headerTitleVi,
		header_title_en: headerTitleEn,
		header_color_light: light.headerColor,
		header_color_dark: dark.headerColor,
		text_color_light: light.textColor,
		text_color_dark: dark.textColor,
		...(theme === null ? {} : { theme }),
	};
}

export function parseMiniAppConfiguration(value: unknown): MiniAppRow[] {
	if (!isRecord(value) || !Array.isArray(value.mini_apps)) {
		throw new AppConfigError(["the configuration needs a mini_apps list"]);
	}
	const rows = value.mini_apps.map((row: unknown, index: number) => {
		try {
			return validateMiniAppRow(row);
		} catch (error) {
			if (error instanceof AppConfigError) {
				throw new AppConfigError(
					error.problems.map((problem) => `row ${index + 1}: ${problem}`),
				);
			}
			throw error;
		}
	});
	const seen = new Set<string>();
	for (const row of rows) {
		const key = `${row.brand_key} ${row.kind}`;
		if (seen.has(key)) {
			throw new AppConfigError([
				`${row.brand_key} has more than one ${row.kind} Mini App`,
			]);
		}
		seen.add(key);
	}
	return rows;
}

export function selectMiniAppRow(
	rows: readonly MiniAppRow[],
	brandKey: string,
	kind: MiniAppKind,
): MiniAppRow {
	const row = rows.find(
		(candidate) => candidate.brand_key === brandKey && candidate.kind === kind,
	);
	if (!row) {
		throw new AppConfigError([
			`no ${kind} Mini App is configured for ${brandKey}`,
		]);
	}
	return row;
}

export function buildAppConfig(row: MiniAppRow): AppConfig {
	return {
		app: {
			title: row.title,
			headerTitle: { vi: row.header_title_vi, en: row.header_title_en },
			headerColor: {
				light: row.header_color_light,
				dark: row.header_color_dark,
			},
			textColor: { light: row.text_color_light, dark: row.text_color_dark },
			statusBarType: "normal",
			hideIOSSafeAreaBottom: false,
			hideAndroidBottomNavigationBar: false,
		},
		listCSS: [],
		listSyncJS: [],
		listAsyncJS: [],
		...(row.theme === undefined ? {} : { theme: row.theme }),
	};
}

export function appConfigJson(config: AppConfig): string {
	return `${JSON.stringify(config, null, "\t")}\n`;
}

export function readAppConfig(value: unknown): AppConfig {
	if (!isRecord(value) || !isRecord(value.app)) {
		throw new AppConfigError(["app-config.json needs an app section"]);
	}
	const app = value.app;
	const headerTitle = isRecord(app.headerTitle) ? app.headerTitle : {};
	const headerColor = isRecord(app.headerColor) ? app.headerColor : {};
	const textColor = isRecord(app.textColor) ? app.textColor : {};
	const row = validateMiniAppRow({
		brand_key: "brand-check",
		kind: "staff",
		title: app.title,
		header_title_vi: headerTitle.vi,
		header_title_en: headerTitle.en,
		header_color_light: headerColor.light,
		header_color_dark: headerColor.dark,
		text_color_light: textColor.light,
		text_color_dark: textColor.dark,
		theme: value.theme,
	});
	return buildAppConfig(row);
}

function flatten(value: unknown, prefix: string, into: Map<string, string>) {
	if (isRecord(value)) {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix === "" ? key : `${prefix}.${key}`, into);
		}
		return;
	}
	into.set(prefix, JSON.stringify(value));
}

export function differingFields(first: unknown, second: unknown): string[] {
	const left = new Map<string, string>();
	const right = new Map<string, string>();
	flatten(first, "", left);
	flatten(second, "", right);
	const paths = new Set([...left.keys(), ...right.keys()]);
	return [...paths].filter((path) => left.get(path) !== right.get(path)).sort();
}

/** A path of app-config.json that a brand sets: the configured app fields and anything of its theme. */
export function isConfiguredPath(path: string): boolean {
	return (
		CONFIGURED_APP_FIELDS.includes(path) ||
		path === "theme" ||
		path.startsWith("theme.")
	);
}

export function unconfiguredDifferences(
	first: unknown,
	second: unknown,
): string[] {
	return differingFields(first, second).filter(
		(path) => !isConfiguredPath(path),
	);
}

// A brand's visual identity for its Mini Apps: a light and a dark palette over the design tokens, and an optional
// tile wordmark with a tagline for the home screen. It lives in the brand's configuration (a mini_apps row or the
// owner's private brand file), never in this repository, and is checked against WCAG 2.2 AA (ADR-034) before a
// build uses it.

export const THEME_TOKENS = [
	"surface",
	"surface_raised",
	"surface_sunken",
	"ink",
	"ink_muted",
	"line",
	"accent",
	"accent_ink",
	"highlight",
	"hero",
	"hero_ink",
	"tile",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export type BrandPalette = Readonly<Record<ThemeToken, string>>;

export interface BrandTheme {
	readonly light: BrandPalette;
	readonly dark: BrandPalette;
	/** One to four letters or digits, drawn as rounded tiles (a 2x2 grid for four). */
	readonly wordmark: string | null;
	readonly taglineVi: string | null;
	readonly taglineEn: string | null;
	/** A short line under the tagline, such as the kind of place. */
	readonly kicker: string | null;
}

/** The theme as it is written in a configuration row (snake case). */
export interface BrandThemeRow {
	readonly light: Readonly<Record<ThemeToken, string>>;
	readonly dark: Readonly<Record<ThemeToken, string>>;
	readonly wordmark?: string;
	readonly tagline_vi?: string;
	readonly tagline_en?: string;
	readonly kicker?: string;
}

export interface ContrastRule {
	readonly foreground: ThemeToken;
	readonly background: ThemeToken;
	readonly minimum: number;
	readonly use: string;
}

// 4.5:1 for body text, 3:1 for large bold text and for interface parts (WCAG 2.2 SC 1.4.3 and 1.4.11)
export const THEME_CONTRAST_RULES: readonly ContrastRule[] = [
	{
		foreground: "ink",
		background: "surface",
		minimum: 4.5,
		use: "text on the page",
	},
	{
		foreground: "ink",
		background: "surface_raised",
		minimum: 4.5,
		use: "text on a card",
	},
	{
		foreground: "ink",
		background: "surface_sunken",
		minimum: 4.5,
		use: "text on a sunken panel",
	},
	{
		foreground: "ink_muted",
		background: "surface",
		minimum: 4.5,
		use: "secondary text on the page",
	},
	{
		foreground: "ink_muted",
		background: "surface_raised",
		minimum: 4.5,
		use: "secondary text on a card",
	},
	{
		foreground: "accent_ink",
		background: "accent",
		minimum: 4.5,
		use: "the label of a main button",
	},
	{
		foreground: "accent",
		background: "surface",
		minimum: 3,
		use: "a main button and the focus ring against the page",
	},
	{
		foreground: "highlight",
		background: "surface_raised",
		minimum: 4.5,
		use: "the active tab's label on the tab bar",
	},
	{
		foreground: "hero_ink",
		background: "hero",
		minimum: 4.5,
		use: "the tagline on the brand banner",
	},
	{
		foreground: "tile",
		background: "hero",
		minimum: 4.5,
		use: "the short line under the tagline on the brand banner",
	},
	{
		foreground: "hero",
		background: "tile",
		minimum: 3,
		use: "a large wordmark letter on a coloured tile",
	},
	{
		foreground: "hero",
		background: "hero_ink",
		minimum: 3,
		use: "a large wordmark letter on a light tile",
	},
];

export const WORDMARK_MAX_LETTERS = 4;
export const TAGLINE_MAX_LENGTH = 80;
export const KICKER_MAX_LENGTH = 40;

const WORDMARK = /^[\p{L}\p{N}]{1,4}$/u;
const CONTROL = /\p{Cc}/u;

export function themeContrast(first: string, second: string): number {
	return contrastRatio(first, second);
}

function palette(
	value: unknown,
	mode: "light" | "dark",
	problems: string[],
): Record<ThemeToken, string> | null {
	if (!isRecord(value)) {
		problems.push(`theme.${mode} must list the ${THEME_TOKENS.length} colours`);
		return null;
	}
	const unknown = Object.keys(value).filter(
		(key) => !(THEME_TOKENS as readonly string[]).includes(key),
	);
	if (unknown.length > 0) {
		problems.push(`theme.${mode} has unknown colours: ${unknown.join(", ")}`);
	}
	const colours = {} as Record<ThemeToken, string>;
	let complete = true;
	for (const token of THEME_TOKENS) {
		const colour = value[token];
		if (typeof colour !== "string" || !HEX_COLOR_PATTERN.test(colour)) {
			problems.push(`theme.${mode}.${token} must be a colour such as #241C14`);
			complete = false;
			continue;
		}
		colours[token] = colour.toUpperCase();
	}
	if (!complete) return null;
	for (const rule of THEME_CONTRAST_RULES) {
		const ratio = themeContrast(
			colours[rule.foreground],
			colours[rule.background],
		);
		if (ratio < rule.minimum) {
			problems.push(
				`theme.${mode}: ${rule.foreground} on ${rule.background} (${rule.use}) has a contrast of ${ratio.toFixed(2)}:1, below ${rule.minimum}:1`,
			);
		}
	}
	return colours;
}

function optionalText(
	value: Record<string, unknown>,
	field: string,
	max: number,
	problems: string[],
): string | undefined {
	const text = value[field];
	if (text === undefined || text === null) return undefined;
	if (typeof text !== "string" || text.trim() === "") {
		problems.push(`theme.${field} must be a text when it is given`);
		return undefined;
	}
	const trimmed = text.trim();
	if ([...trimmed].length > max || CONTROL.test(trimmed)) {
		problems.push(
			`theme.${field} must be at most ${max} characters without control characters`,
		);
		return undefined;
	}
	return trimmed;
}

/** Checks a theme row and returns it normalised, or adds its problems; null when it is unusable. */
export function validateBrandThemeRow(
	value: unknown,
	problems: string[],
): BrandThemeRow | null {
	if (!isRecord(value)) {
		problems.push("theme must be an object with light and dark colours");
		return null;
	}
	const known = [
		"light",
		"dark",
		"wordmark",
		"tagline_vi",
		"tagline_en",
		"kicker",
	];
	const unknown = Object.keys(value).filter((key) => !known.includes(key));
	if (unknown.length > 0) {
		problems.push(`theme has unknown fields: ${unknown.join(", ")}`);
	}
	const before = problems.length;
	const light = palette(value.light, "light", problems);
	const dark = palette(value.dark, "dark", problems);
	let wordmark: string | undefined;
	if (value.wordmark !== undefined && value.wordmark !== null) {
		const text =
			typeof value.wordmark === "string" ? value.wordmark.trim() : "";
		if (!WORDMARK.test(text)) {
			problems.push(
				`theme.wordmark must be 1 to ${WORDMARK_MAX_LETTERS} letters or digits`,
			);
		} else {
			wordmark = text.toLocaleUpperCase("vi");
		}
	}
	const taglineVi = optionalText(
		value,
		"tagline_vi",
		TAGLINE_MAX_LENGTH,
		problems,
	);
	const taglineEn = optionalText(
		value,
		"tagline_en",
		TAGLINE_MAX_LENGTH,
		problems,
	);
	const kicker = optionalText(value, "kicker", KICKER_MAX_LENGTH, problems);
	const given = (field: string) =>
		value[field] !== undefined && value[field] !== null;
	if (given("tagline_vi") !== given("tagline_en")) {
		problems.push("theme.tagline_vi and theme.tagline_en are given together");
	}
	if (problems.length > before || light === null || dark === null) return null;
	return {
		light,
		dark,
		...(wordmark === undefined ? {} : { wordmark }),
		...(taglineVi === undefined ? {} : { tagline_vi: taglineVi }),
		...(taglineEn === undefined ? {} : { tagline_en: taglineEn }),
		...(kicker === undefined ? {} : { kicker }),
	};
}

export function brandThemeOf(row: BrandThemeRow): BrandTheme {
	return {
		light: row.light,
		dark: row.dark,
		wordmark: row.wordmark ?? null,
		taglineVi: row.tagline_vi ?? null,
		taglineEn: row.tagline_en ?? null,
		kicker: row.kicker ?? null,
	};
}

const CSS_VARIABLES: Readonly<Record<ThemeToken, string>> = {
	surface: "--surface",
	surface_raised: "--surface-raised",
	surface_sunken: "--surface-sunken",
	ink: "--ink",
	ink_muted: "--ink-muted",
	line: "--line",
	accent: "--accent",
	accent_ink: "--accent-ink",
	highlight: "--brand-highlight",
	hero: "--brand-hero",
	hero_ink: "--brand-hero-ink",
	tile: "--brand-tile",
};

function declarations(colours: BrandPalette): string {
	return [
		...THEME_TOKENS.map((token) => `${CSS_VARIABLES[token]}:${colours[token]}`),
		`--focus:${colours.accent}`,
		"--zaui-light-bottom-navigation-active-color:var(--brand-highlight)",
		"--zaui-dark-bottom-navigation-active-color:var(--brand-highlight)",
	].join(";");
}

/**
 * The style sheet of a theme. `html:root` outranks the tokens' `:root`, so the order of the style sheets does not
 * matter; the dark palette follows the same media query as the tokens.
 */
export function brandThemeCss(theme: BrandTheme): string {
	return `html:root{${declarations(theme.light)}}@media (prefers-color-scheme: dark){html:root{${declarations(theme.dark)}}}`;
}
