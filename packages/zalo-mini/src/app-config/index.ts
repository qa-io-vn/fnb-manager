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
}

export interface MiniAppBuildConfig {
	readonly brand: string;
	readonly kind: MiniAppKind;
	readonly app: AppConfigApp;
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

export function unconfiguredDifferences(
	first: unknown,
	second: unknown,
): string[] {
	return differingFields(first, second).filter(
		(path) => !CONFIGURED_APP_FIELDS.includes(path),
	);
}
