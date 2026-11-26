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

// Optional colour roles. Each group is all or nothing, and a theme sets the same groups in its light and its dark
// palette. A brand that sets none of them keeps today's look: the design tokens answer for the status colours, and the
// style sheet of the shell (`styles/mini-app.css`) gives every other role a default made of the roles above.
export const STATUS_TOKENS = [
	"positive",
	"positive_soft",
	"negative",
	"negative_soft",
	"warning",
	"warning_soft",
	"neutral_soft",
] as const;

export type StatusToken = (typeof STATUS_TOKENS)[number];

export const OPTIONAL_THEME_GROUPS = {
	line_strong: ["line_strong"],
	badge: ["badge", "badge_ink"],
	status: STATUS_TOKENS,
	inverse: ["inverse", "inverse_ink"],
	tone_1: ["tone_1", "tone_1_ink", "tone_1_soft"],
	tone_2: ["tone_2", "tone_2_ink", "tone_2_soft"],
	tone_3: ["tone_3", "tone_3_ink", "tone_3_soft"],
	tone_4: ["tone_4", "tone_4_ink", "tone_4_soft"],
	art_plate: ["art_plate"],
} as const;

export type OptionalThemeGroup = keyof typeof OPTIONAL_THEME_GROUPS;

export type OptionalThemeToken =
	(typeof OPTIONAL_THEME_GROUPS)[OptionalThemeGroup][number];

export const OPTIONAL_THEME_GROUP_NAMES = Object.keys(
	OPTIONAL_THEME_GROUPS,
) as readonly OptionalThemeGroup[];

export const OPTIONAL_THEME_TOKENS: readonly OptionalThemeToken[] =
	OPTIONAL_THEME_GROUP_NAMES.flatMap(
		(group): readonly OptionalThemeToken[] => OPTIONAL_THEME_GROUPS[group],
	);

/** A role of a palette: one of the twelve required colours or one of the optional ones. */
export type ThemeRole = ThemeToken | OptionalThemeToken;

export type BrandPalette = Readonly<Record<ThemeToken, string>> &
	Readonly<Partial<Record<OptionalThemeToken, string>>>;

/**
 * What a brand without a status group gets: the design tokens' status colours (`packages/design-tokens`, kept in step
 * with them by a unit test). The brand's surfaces and ink are checked against these, because the status colours are
 * drawn on them whether or not the brand chose its own.
 */
export const DEFAULT_STATUS_COLOURS: Readonly<
	Record<"light" | "dark", Readonly<Record<StatusToken, string>>>
> = {
	light: {
		positive: "#1B7A48",
		positive_soft: "#DCF2E4",
		negative: "#B3261E",
		negative_soft: "#F9DCD9",
		warning: "#8A5A00",
		warning_soft: "#FBE9C4",
		neutral_soft: "#E8E4DC",
	},
	dark: {
		positive: "#6FD39C",
		positive_soft: "#163826",
		negative: "#FF8F86",
		negative_soft: "#44201D",
		warning: "#F0C060",
		warning_soft: "#3D2E0C",
		neutral_soft: "#2D2B31",
	},
};

// The shape of a brand's screens (rounded or square, flat or with a shadow) and the size of its body text. Every
// field is optional: one that is not set keeps today's look, because each utility of the shell's style sheet falls back
// to today's value (`rounded-card` is `var(--radius-card, 1.5rem)`).
export const SHAPE_FIELDS = [
	"card",
	"panel",
	"control",
	"field",
	"tile",
	"sheet",
	"border",
	"outline",
	"shadow",
] as const;

export type ShapeField = (typeof SHAPE_FIELDS)[number];

/** The largest corner radius, in px, of each rounded part; a radius is a multiple of 0.5. */
export const SHAPE_RADIUS_MAX = {
	card: 32,
	panel: 32,
	control: 24,
	field: 32,
	tile: 32,
	sheet: 40,
} as const;

export const RADIUS_STEP = 0.5;
export const BORDER_WIDTHS = [1, 1.5, 2] as const;
export const OUTLINE_WIDTHS = [1.5, 2] as const;
export const BODY_SIZES = [15, 16] as const;
/** The radius that makes a part a pill, written for `control: "pill"`. */
export const PILL_RADIUS_PX = 9999;
/** The line height that goes with a 15 px body (a 16 px body keeps today's 1.5). */
export const BODY_15_LINE_HEIGHT = 1.45;

export interface BrandShape {
	/** Cards, list rows, coupons, tiles of figures and the boxes of messages. */
	readonly card?: number;
	/** The big panels: the brand banner and the member card. */
	readonly panel?: number;
	/** Buttons, chips and option pills; "pill" is fully round. */
	readonly control?: number | "pill";
	/** Text fields, selects and search fields. */
	readonly field?: number;
	/** Photos, icon tiles and plates. */
	readonly tile?: number;
	/** The top corners of a sheet. */
	readonly sheet?: number;
	/** The width of a card's and a field's border. */
	readonly border?: 1 | 1.5 | 2;
	/** The width of the outline of a secondary button, an idle chip and a stepper. */
	readonly outline?: 1.5 | 2;
	/** False turns the shadow of cards and buttons off. */
	readonly shadow?: boolean;
}

export interface BrandType {
	/** The size in px of body text. */
	readonly body?: 15 | 16;
}

export interface BrandTheme {
	readonly light: BrandPalette;
	readonly dark: BrandPalette;
	/** One to four letters or digits, drawn as rounded tiles (a 2x2 grid for four). */
	readonly wordmark: string | null;
	readonly taglineVi: string | null;
	readonly taglineEn: string | null;
	/** A short line under the tagline, such as the kind of place. */
	readonly kicker: string | null;
	readonly shape: BrandShape | null;
	readonly type: BrandType | null;
}

/** The theme as it is written in a configuration row (snake case). */
export interface BrandThemeRow {
	readonly light: BrandPalette;
	readonly dark: BrandPalette;
	readonly wordmark?: string;
	readonly tagline_vi?: string;
	readonly tagline_en?: string;
	readonly kicker?: string;
	readonly shape?: BrandShape;
	readonly type?: BrandType;
}

export interface ContrastRule {
	readonly foreground: ThemeRole;
	readonly background: ThemeRole;
	readonly minimum: number;
	readonly use: string;
}

function rule(
	foreground: ThemeRole,
	background: ThemeRole,
	minimum: number,
	use: string,
): ContrastRule {
	return { foreground, background, minimum, use };
}

const TONE_NUMBERS = [1, 2, 3, 4] as const;

function toneRules(n: (typeof TONE_NUMBERS)[number]): ContrastRule[] {
	const tone = `tone_${n}` as const;
	return [
		rule(tone, "surface", 4.5, `the text of tone ${n} on the page`),
		rule(tone, "surface_raised", 4.5, `the text of tone ${n} on a card`),
		rule(`${tone}_ink`, tone, 4.5, `the label of a selected tone ${n} chip`),
	];
}

// 4.5:1 for body text, 3:1 for large bold text and for interface parts (WCAG 2.2 SC 1.4.3 and 1.4.11). A rule whose
// roles are optional applies when the brand sets them; the status roles also apply when it does not, with the defaults.
export const THEME_CONTRAST_RULES: readonly ContrastRule[] = [
	rule("ink", "surface", 4.5, "text on the page"),
	rule("ink", "surface_raised", 4.5, "text on a card"),
	rule("ink", "surface_sunken", 4.5, "text on a sunken panel"),
	rule("ink_muted", "surface", 4.5, "secondary text on the page"),
	rule("ink_muted", "surface_raised", 4.5, "secondary text on a card"),
	rule("accent_ink", "accent", 4.5, "the label of a main button"),
	rule(
		"accent",
		"surface",
		3,
		"a main button and the focus ring against the page",
	),
	rule(
		"highlight",
		"surface_raised",
		4.5,
		"the active tab's label on the tab bar",
	),
	rule("hero_ink", "hero", 4.5, "the tagline on the brand banner"),
	rule(
		"tile",
		"hero",
		4.5,
		"the short line under the tagline on the brand banner",
	),
	rule("hero", "tile", 3, "a large wordmark letter on a coloured tile"),
	rule("hero", "hero_ink", 3, "a large wordmark letter on a light tile"),
	// added with the optional roles
	rule("ink_muted", "surface_sunken", 4.5, "secondary text on a sunken panel"),
	rule(
		"accent",
		"surface_raised",
		3,
		"the focus ring and a selected option on a card",
	),
	rule(
		"accent",
		"surface_sunken",
		3,
		"a progress bar and a stamp ring against a sunken panel",
	),
	rule("highlight", "surface", 4.5, "prices, kickers and links on the page"),
	rule(
		"highlight",
		"surface_sunken",
		3,
		"a large (24 px) hand-written line on a sunken panel; large text only",
	),
	rule(
		"line_strong",
		"surface",
		3,
		"the edge of a field or a checkbox on the page",
	),
	rule(
		"line_strong",
		"surface_raised",
		3,
		"the edge of a field, a stepper or an option on a card",
	),
	rule("badge_ink", "badge", 4.5, "the label of a badge"),
	rule("positive", "surface", 4.5, "positive text on the page"),
	rule("positive", "surface_raised", 4.5, "positive text on a card"),
	rule(
		"surface_raised",
		"positive",
		4.5,
		"the label of a filled positive pill",
	),
	rule("negative", "surface", 4.5, "error text on the page"),
	rule("negative", "surface_raised", 4.5, "error text on a card"),
	rule("warning", "surface", 4.5, "warning text on the page"),
	rule("warning", "warning_soft", 4.5, "warning text on its own box"),
	rule("ink", "positive_soft", 4.5, "text inside a positive box"),
	rule("ink", "negative_soft", 4.5, "text inside a negative box"),
	rule("ink", "warning_soft", 4.5, "text inside a warning box"),
	rule("ink", "neutral_soft", 4.5, "text inside a neutral box"),
	rule("ink_muted", "neutral_soft", 4.5, "secondary text inside a neutral box"),
	rule("ink_muted", "warning_soft", 4.5, "secondary text inside a warning box"),
	rule(
		"ink_muted",
		"positive_soft",
		4.5,
		"secondary text inside a positive box",
	),
	rule("inverse_ink", "inverse", 4.5, "the label on an inverse bar or button"),
	...TONE_NUMBERS.flatMap(toneRules),
];

export const WORDMARK_MAX_LETTERS = 4;
export const TAGLINE_MAX_LENGTH = 80;
export const KICKER_MAX_LENGTH = 40;

const WORDMARK = /^[\p{L}\p{N}]{1,4}$/u;
const CONTROL = /\p{Cc}/u;

export function themeContrast(first: string, second: string): number {
	return contrastRatio(first, second);
}

function isColour(value: unknown): value is string {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

function isGiven(value: unknown): boolean {
	return value !== undefined && value !== null;
}

/** The groups of optional roles that a palette sets completely. */
export function optionalGroupsOf(
	colours: BrandPalette,
): readonly OptionalThemeGroup[] {
	return OPTIONAL_THEME_GROUP_NAMES.filter((group) =>
		OPTIONAL_THEME_GROUPS[group].every(
			(token: OptionalThemeToken) => colours[token] !== undefined,
		),
	);
}

// the optional colours of one palette: hex values, whole groups only, tones numbered from 1 without gaps
function optionalColours(
	value: Record<string, unknown>,
	mode: "light" | "dark",
	problems: string[],
): Partial<Record<OptionalThemeToken, string>> {
	const colours: Partial<Record<OptionalThemeToken, string>> = {};
	const tones: number[] = [];
	for (const group of OPTIONAL_THEME_GROUP_NAMES) {
		const tokens: readonly OptionalThemeToken[] = OPTIONAL_THEME_GROUPS[group];
		const given = tokens.filter((token) => isGiven(value[token]));
		if (given.length === 0) continue;
		let valid = true;
		for (const token of given) {
			if (!isColour(value[token])) {
				problems.push(
					`theme.${mode}.${token} must be a colour such as #241C14`,
				);
				valid = false;
			}
		}
		if (given.length < tokens.length) {
			const missing = tokens.filter((token) => !given.includes(token));
			problems.push(
				`theme.${mode} sets part of the ${group} colours; it needs all of them (missing: ${missing.join(", ")})`,
			);
			valid = false;
		}
		if (!valid) continue;
		for (const token of tokens) {
			colours[token] = String(value[token]).toUpperCase();
		}
		if (group.startsWith("tone_")) tones.push(Number(group.slice(5)));
	}
	if (tones.some((tone, index) => tone !== index + 1)) {
		problems.push(
			`theme.${mode} must number its tone colours from tone_1 without gaps`,
		);
	}
	return colours;
}

function describeRole(role: ThemeRole, statusIsDefault: boolean): string {
	return statusIsDefault && (STATUS_TOKENS as readonly string[]).includes(role)
		? `${role} (default)`
		: role;
}

function palette(
	value: unknown,
	mode: "light" | "dark",
	problems: string[],
): BrandPalette | null {
	if (!isRecord(value)) {
		problems.push(`theme.${mode} must list the ${THEME_TOKENS.length} colours`);
		return null;
	}
	const unknown = Object.keys(value).filter(
		(key) =>
			!(THEME_TOKENS as readonly string[]).includes(key) &&
			!(OPTIONAL_THEME_TOKENS as readonly string[]).includes(key),
	);
	if (unknown.length > 0) {
		problems.push(`theme.${mode} has unknown colours: ${unknown.join(", ")}`);
	}
	const colours = {} as Record<ThemeToken, string>;
	let complete = true;
	for (const token of THEME_TOKENS) {
		const colour = value[token];
		if (!isColour(colour)) {
			problems.push(`theme.${mode}.${token} must be a colour such as #241C14`);
			complete = false;
			continue;
		}
		colours[token] = colour.toUpperCase();
	}
	const before = problems.length;
	const optional = optionalColours(value, mode, problems);
	if (!complete || problems.length > before) return null;
	const full: BrandPalette = { ...colours, ...optional };
	// the brand's own status colours, or the design tokens' when it sets none: they sit on its surfaces either way
	const statusIsDefault = !optionalGroupsOf(full).includes("status");
	const resolved: Partial<Record<ThemeRole, string>> = {
		...(statusIsDefault ? DEFAULT_STATUS_COLOURS[mode] : {}),
		...full,
	};
	for (const rule of THEME_CONTRAST_RULES) {
		const foreground = resolved[rule.foreground];
		const background = resolved[rule.background];
		if (foreground === undefined || background === undefined) continue;
		const ratio = themeContrast(foreground, background);
		if (ratio >= rule.minimum) continue;
		const first = describeRole(rule.foreground, statusIsDefault);
		const second = describeRole(rule.background, statusIsDefault);
		const note =
			first !== rule.foreground || second !== rule.background
				? "; the status colours are not set, so the default ones apply"
				: "";
		problems.push(
			`theme.${mode}: ${first} on ${second} (${rule.use}) has a contrast of ${ratio.toFixed(2)}:1, below ${rule.minimum}:1${note}`,
		);
	}
	return full;
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

function isWholeStep(value: unknown, max: number): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= max &&
		Number.isInteger(value / RADIUS_STEP)
	);
}

function oneOf<T extends number>(
	value: unknown,
	allowed: readonly T[],
): value is T {
	return allowed.some((candidate) => candidate === value);
}

function shapeOf(value: unknown, problems: string[]): BrandShape | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) {
		problems.push("theme.shape must be an object");
		return undefined;
	}
	const unknown = Object.keys(value).filter(
		(key) => !(SHAPE_FIELDS as readonly string[]).includes(key),
	);
	if (unknown.length > 0) {
		problems.push(`theme.shape has unknown fields: ${unknown.join(", ")}`);
	}
	const shape: { -readonly [K in keyof BrandShape]: BrandShape[K] } = {};
	for (const field of SHAPE_FIELDS) {
		const given = value[field];
		if (given === undefined || given === null) continue;
		switch (field) {
			case "card":
			case "panel":
			case "field":
			case "tile":
			case "sheet": {
				const max = SHAPE_RADIUS_MAX[field];
				if (isWholeStep(given, max)) shape[field] = given;
				else {
					problems.push(
						`theme.shape.${field} must be a number from 0 to ${max} in steps of ${RADIUS_STEP}`,
					);
				}
				break;
			}
			case "control": {
				if (given === "pill" || isWholeStep(given, SHAPE_RADIUS_MAX.control)) {
					shape.control = given;
				} else {
					problems.push(
						`theme.shape.control must be "pill" or a number from 0 to ${SHAPE_RADIUS_MAX.control} in steps of ${RADIUS_STEP}`,
					);
				}
				break;
			}
			case "border": {
				if (oneOf(given, BORDER_WIDTHS)) shape.border = given;
				else problems.push("theme.shape.border must be 1, 1.5 or 2");
				break;
			}
			case "outline": {
				if (oneOf(given, OUTLINE_WIDTHS)) shape.outline = given;
				else problems.push("theme.shape.outline must be 1.5 or 2");
				break;
			}
			case "shadow": {
				if (typeof given === "boolean") shape.shadow = given;
				else problems.push("theme.shape.shadow must be true or false");
				break;
			}
		}
	}
	return shape;
}

function typeOf(value: unknown, problems: string[]): BrandType | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) {
		problems.push("theme.type must be an object");
		return undefined;
	}
	const unknown = Object.keys(value).filter((key) => key !== "body");
	if (unknown.length > 0) {
		problems.push(`theme.type has unknown fields: ${unknown.join(", ")}`);
	}
	const type: { -readonly [K in keyof BrandType]: BrandType[K] } = {};
	const body = value.body;
	if (body !== undefined && body !== null) {
		if (oneOf(body, BODY_SIZES)) type.body = body;
		else problems.push("theme.type.body must be 15 or 16");
	}
	return type;
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
		"shape",
		"type",
	];
	const unknown = Object.keys(value).filter((key) => !known.includes(key));
	if (unknown.length > 0) {
		problems.push(`theme has unknown fields: ${unknown.join(", ")}`);
	}
	const before = problems.length;
	const light = palette(value.light, "light", problems);
	const dark = palette(value.dark, "dark", problems);
	if (light !== null && dark !== null) {
		const inLight = optionalGroupsOf(light);
		const inDark = optionalGroupsOf(dark);
		for (const group of OPTIONAL_THEME_GROUP_NAMES) {
			if (inLight.includes(group) === inDark.includes(group)) continue;
			const [has, lacks] = inLight.includes(group)
				? (["light", "dark"] as const)
				: (["dark", "light"] as const);
			problems.push(
				`theme.${lacks} must set the ${group} colours too, as theme.${has} does`,
			);
		}
	}
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
	const shape = shapeOf(value.shape, problems);
	const type = typeOf(value.type, problems);
	if (problems.length > before || light === null || dark === null) return null;
	return {
		light,
		dark,
		...(shape === undefined ? {} : { shape }),
		...(type === undefined ? {} : { type }),
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
		shape: row.shape ?? null,
		type: row.type ?? null,
	};
}

const CSS_VARIABLES: Readonly<Record<ThemeRole, string>> = {
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
	line_strong: "--line-strong",
	badge: "--badge",
	badge_ink: "--badge-ink",
	positive: "--positive",
	positive_soft: "--positive-soft",
	negative: "--negative",
	negative_soft: "--negative-soft",
	warning: "--warning",
	warning_soft: "--warning-soft",
	neutral_soft: "--neutral-soft",
	inverse: "--inverse",
	inverse_ink: "--inverse-ink",
	tone_1: "--tone-1",
	tone_1_ink: "--tone-1-ink",
	tone_1_soft: "--tone-1-soft",
	tone_2: "--tone-2",
	tone_2_ink: "--tone-2-ink",
	tone_2_soft: "--tone-2-soft",
	tone_3: "--tone-3",
	tone_3_ink: "--tone-3-ink",
	tone_3_soft: "--tone-3-soft",
	tone_4: "--tone-4",
	tone_4_ink: "--tone-4-ink",
	tone_4_soft: "--tone-4-soft",
	art_plate: "--art-plate",
};

// Only a #RRGGBB value is ever written, so nothing a brand's configuration holds can add a rule, a selector or a URL
// to the style sheet (a value that is not one is left out, and the token underneath answers).
function declarations(colours: BrandPalette): string {
	const roles: readonly ThemeRole[] = [
		...THEME_TOKENS,
		...OPTIONAL_THEME_TOKENS,
	];
	const written = roles.flatMap((role) => {
		const colour = colours[role];
		return isColour(colour) ? [`${CSS_VARIABLES[role]}:${colour}`] : [];
	});
	return [
		...written,
		...(isColour(colours.accent) ? [`--focus:${colours.accent}`] : []),
		"--zaui-light-bottom-navigation-active-color:var(--brand-highlight)",
		"--zaui-dark-bottom-navigation-active-color:var(--brand-highlight)",
	].join(";");
}

function radiusPx(value: unknown, max: number): string | null {
	return isWholeStep(value, max) ? `${value}px` : null;
}

// The custom properties of a brand's shape and body size. Each one is written only when it is a number inside its
// bounds (or the word "pill"), so no text of a configuration can reach the style sheet through them.
function shapeDeclarations(
	shape: BrandShape | null,
	type: BrandType | null,
): string[] {
	const written: string[] = [];
	const radii: ReadonlyArray<readonly [string, string | null]> = [
		["--radius-card", radiusPx(shape?.card, SHAPE_RADIUS_MAX.card)],
		["--radius-panel", radiusPx(shape?.panel, SHAPE_RADIUS_MAX.panel)],
		[
			"--radius-control",
			shape?.control === "pill"
				? `${PILL_RADIUS_PX}px`
				: radiusPx(shape?.control, SHAPE_RADIUS_MAX.control),
		],
		["--radius-field", radiusPx(shape?.field, SHAPE_RADIUS_MAX.field)],
		["--radius-tile", radiusPx(shape?.tile, SHAPE_RADIUS_MAX.tile)],
		["--radius-sheet", radiusPx(shape?.sheet, SHAPE_RADIUS_MAX.sheet)],
	];
	for (const [name, value] of radii) {
		if (value !== null) written.push(`${name}:${value}`);
	}
	if (oneOf(shape?.border, BORDER_WIDTHS)) {
		written.push(
			`--card-border:${shape?.border}px`,
			`--field-border:${shape?.border}px`,
		);
	}
	if (oneOf(shape?.outline, OUTLINE_WIDTHS)) {
		// a brand with an outline draws it in its ink (a danger action in its negative colour), as the handbook does
		written.push(
			`--outline-width:${shape?.outline}px`,
			"--outline-color:var(--ink)",
			"--outline-danger-color:var(--negative)",
		);
	}
	if (shape?.shadow === false) written.push("--card-shadow:none");
	if (type?.body === 15) {
		written.push(
			`--text-body:15px`,
			`--text-body--line-height:${BODY_15_LINE_HEIGHT}`,
		);
	}
	return written;
}

/**
 * The style sheet of a theme. `html:root` outranks the tokens' `:root`, so the order of the style sheets does not
 * matter; the dark palette follows the same media query as the tokens.
 */
export function brandThemeCss(theme: BrandTheme): string {
	// the shape and the body size do not depend on the colour scheme: they sit in the first block only
	const first = [
		declarations(theme.light),
		...shapeDeclarations(theme.shape, theme.type),
	].join(";");
	return `html:root{${first}}@media (prefers-color-scheme: dark){html:root{${declarations(theme.dark)}}}`;
}
