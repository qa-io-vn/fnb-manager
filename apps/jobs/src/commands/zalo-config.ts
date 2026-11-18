import { UsageError } from "../context.js";

export const BRAND_KEY_PATTERN = /^brand-[1-9][0-9]{0,2}$/;
export const ZALO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const OA_TIERS = [
	"co_ban",
	"tieu_chuan",
	"tang_truong",
	"toan_dien",
] as const;
export const WEBHOOK_MODES = ["observe", "enforce"] as const;
export const APP_STATUSES = ["active", "disabled"] as const;
export const MINI_APP_KINDS = ["staff", "customer"] as const;
export const TEXT_COLORS = ["black", "white"] as const;
export const APP_SECRET_PREFIX = "ZALO_APP_SECRET_";
export const OA_SECRET_PREFIX = "ZALO_OA_SECRET_";

export type OaTier = (typeof OA_TIERS)[number];
export type WebhookMode = (typeof WEBHOOK_MODES)[number];
export type AppStatus = (typeof APP_STATUSES)[number];
export type MiniAppKind = (typeof MINI_APP_KINDS)[number];
export type TextColor = (typeof TEXT_COLORS)[number];

export interface ZaloAppConfig {
	readonly id: string;
	readonly secretName: string;
	readonly status: AppStatus;
}

export interface OaConfig {
	readonly id: string;
	readonly secretName: string;
	readonly packageTier: OaTier;
	readonly packageExpiresOn: string | null;
	readonly verified: boolean;
	readonly webhookMode: WebhookMode;
}

export interface MiniAppConfig {
	readonly kind: MiniAppKind;
	readonly id: string;
	readonly title: string;
	readonly headerTitleVi: string;
	readonly headerTitleEn: string;
	readonly headerColorLight: string;
	readonly headerColorDark: string;
	readonly textColorLight: TextColor;
	readonly textColorDark: TextColor;
}

export interface BrandConfig {
	readonly brand: string;
	readonly name: string;
	readonly stores: readonly string[];
	readonly zaloApp: ZaloAppConfig;
	readonly oa: OaConfig | null;
	readonly miniApps: readonly MiniAppConfig[];
}

export function secretNameValid(name: string, prefix: string): boolean {
	if (
		!/^ZALO_[A-Z0-9_]{1,60}$/.test(name) ||
		!name.startsWith(prefix) ||
		name.length <= prefix.length
	) {
		return false;
	}
	return name
		.split("_")
		.every(
			(segment) =>
				segment !== "" &&
				segment.length <= 16 &&
				!(/[0-9]/.test(segment) && segment.length > 8),
		);
}

export function miniAppTitleValid(title: string): boolean {
	const length = [...title].length;
	return (
		length >= 3 &&
		length <= 50 &&
		title === title.trim() &&
		!/\p{Cc}/u.test(title) &&
		!(title === title.toUpperCase() && title !== title.toLowerCase()) &&
		!/zalo/i.test(title) &&
		!/(^|[^\p{L}\p{N}_])apps?(?![\p{L}\p{N}_])/iu.test(title) &&
		!/Apps?(?![\p{L}\p{N}_])/u.test(title)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainText(
	value: unknown,
	field: string,
	maxLength: number,
	problems: string[],
): string {
	if (typeof value !== "string" || value.trim() === "") {
		problems.push(`${field} is required`);
		return "";
	}
	if ([...value].length > maxLength || /\p{Cc}/u.test(value)) {
		problems.push(
			`${field} must be 1 to ${maxLength} characters without control characters`,
		);
	}
	return value;
}

function zaloId(value: unknown, field: string, problems: string[]): string {
	if (typeof value !== "string" || !ZALO_ID_PATTERN.test(value)) {
		problems.push(
			`${field} must be a Zalo id: 1 to 64 letters, digits, - or _`,
		);
		return "";
	}
	return value;
}

function secretName(
	value: unknown,
	field: string,
	prefix: string,
	problems: string[],
): string {
	if (typeof value !== "string" || !secretNameValid(value, prefix)) {
		problems.push(
			`${field} must name a function secret such as ${prefix}BRAND_1, never hold its value`,
		);
		return "";
	}
	return value;
}

function oneOf<T extends string>(
	value: unknown,
	choices: readonly T[],
	field: string,
	fallback: T | null,
	problems: string[],
): T {
	if ((value === undefined || value === null) && fallback !== null) {
		return fallback;
	}
	const found = choices.find((choice) => choice === value);
	if (found === undefined) {
		problems.push(`${field} must be one of ${choices.join(", ")}`);
		return choices[0] as T;
	}
	return found;
}

function isoDate(
	value: unknown,
	field: string,
	problems: string[],
): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		problems.push(`${field} must be a date written YYYY-MM-DD`);
		return null;
	}
	const date = new Date(`${value}T00:00:00Z`);
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		problems.push(`${field} must be a date written YYYY-MM-DD`);
		return null;
	}
	return value;
}

function zaloAppOf(value: unknown, problems: string[]): ZaloAppConfig {
	if (!isRecord(value)) {
		problems.push("zalo_app is required");
		return { id: "", secretName: "", status: "active" };
	}
	return {
		id: zaloId(value.id, "zalo_app.id", problems),
		secretName: secretName(
			value.secret_name,
			"zalo_app.secret_name",
			APP_SECRET_PREFIX,
			problems,
		),
		status: oneOf(
			value.status,
			APP_STATUSES,
			"zalo_app.status",
			"active",
			problems,
		),
	};
}

function oaOf(value: unknown, problems: string[]): OaConfig | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (!isRecord(value)) {
		problems.push("oa must be an object");
		return null;
	}
	const verified = value.verified ?? false;
	if (typeof verified !== "boolean") {
		problems.push("oa.verified must be true or false");
	}
	return {
		id: zaloId(value.id, "oa.id", problems),
		secretName: secretName(
			value.secret_name,
			"oa.secret_name",
			OA_SECRET_PREFIX,
			problems,
		),
		packageTier: oneOf(
			value.package_tier,
			OA_TIERS,
			"oa.package_tier",
			"co_ban",
			problems,
		),
		packageExpiresOn: isoDate(
			value.package_expires_on,
			"oa.package_expires_on",
			problems,
		),
		verified: verified === true,
		webhookMode: oneOf(
			value.webhook_mode,
			WEBHOOK_MODES,
			"oa.webhook_mode",
			"observe",
			problems,
		),
	};
}

function miniAppOf(
	value: unknown,
	index: number,
	problems: string[],
): MiniAppConfig {
	const field = (name: string) => `mini_apps[${index}].${name}`;
	const row = isRecord(value) ? value : {};
	if (!isRecord(value)) {
		problems.push(`mini_apps[${index}] must be an object`);
	}
	const title = plainText(row.title, field("title"), 50, problems);
	if (title !== "" && !miniAppTitleValid(title)) {
		problems.push(
			`${field("title")} breaks Zalo's naming rules: 3 to 50 characters, not all capitals, without Zalo, App or Mini App`,
		);
	}
	const color = (name: string): string => {
		const text = row[name];
		if (typeof text !== "string" || !HEX_COLOR_PATTERN.test(text)) {
			problems.push(`${field(name)} must be a colour such as #0A6B56`);
			return "";
		}
		return text.toUpperCase();
	};
	return {
		kind: oneOf(row.kind, MINI_APP_KINDS, field("kind"), null, problems),
		id: zaloId(row.id, field("id"), problems),
		title,
		headerTitleVi: plainText(
			row.header_title_vi,
			field("header_title_vi"),
			50,
			problems,
		),
		headerTitleEn: plainText(
			row.header_title_en,
			field("header_title_en"),
			50,
			problems,
		),
		headerColorLight: color("header_color_light"),
		headerColorDark: color("header_color_dark"),
		textColorLight: oneOf(
			row.text_color_light,
			TEXT_COLORS,
			field("text_color_light"),
			null,
			problems,
		),
		textColorDark: oneOf(
			row.text_color_dark,
			TEXT_COLORS,
			field("text_color_dark"),
			null,
			problems,
		),
	};
}

export function parseBrandConfig(value: unknown): BrandConfig {
	if (!isRecord(value)) {
		throw new UsageError("the brand configuration must be a JSON object");
	}
	const problems: string[] = [];
	const brand = value.brand;
	if (typeof brand !== "string" || !BRAND_KEY_PATTERN.test(brand)) {
		problems.push("brand must be a neutral key such as brand-1");
	}
	const name = plainText(value.name, "name", 80, problems);
	const stores = value.stores;
	if (
		!Array.isArray(stores) ||
		stores.length === 0 ||
		stores.length > 50 ||
		!stores.every((store) => typeof store === "string" && store.trim() !== "")
	) {
		problems.push("stores must list 1 to 50 store external ids");
	} else if (new Set(stores).size !== stores.length) {
		problems.push("stores lists a store twice");
	}
	const zaloApp = zaloAppOf(value.zalo_app, problems);
	const oa = oaOf(value.oa, problems);
	const rawMiniApps = value.mini_apps ?? [];
	const miniApps = Array.isArray(rawMiniApps)
		? rawMiniApps.map((row, index) => miniAppOf(row, index, problems))
		: [];
	if (!Array.isArray(rawMiniApps)) {
		problems.push("mini_apps must be a list");
	}
	const kinds = miniApps.map((app) => app.kind);
	if (new Set(kinds).size !== kinds.length) {
		problems.push(
			"mini_apps holds one staff and one customer Mini App at most",
		);
	}
	if (problems.length > 0) {
		throw new UsageError(
			`the brand configuration is refused: ${problems.join("; ")}`,
		);
	}
	return {
		brand: brand as string,
		name,
		stores: stores as string[],
		zaloApp,
		oa,
		miniApps,
	};
}

export interface BrandFlags {
	readonly brand: string | undefined;
	readonly name: string | undefined;
	readonly stores: readonly string[];
	readonly appId: string | undefined;
	readonly appSecretName: string | undefined;
	readonly appStatus: string | undefined;
	readonly oaId: string | undefined;
	readonly oaSecretName: string | undefined;
	readonly oaTier: string | undefined;
	readonly oaExpiresOn: string | undefined;
	readonly oaVerified: boolean;
	readonly webhookMode: string | undefined;
}

export function configFromFlags(flags: BrandFlags): BrandConfig {
	const oaGiven =
		flags.oaId !== undefined ||
		flags.oaSecretName !== undefined ||
		flags.oaTier !== undefined ||
		flags.oaExpiresOn !== undefined ||
		flags.oaVerified ||
		flags.webhookMode !== undefined;
	return parseBrandConfig({
		brand: flags.brand,
		name: flags.name,
		stores: [...flags.stores],
		zalo_app: {
			id: flags.appId,
			secret_name: flags.appSecretName,
			status: flags.appStatus,
		},
		...(oaGiven
			? {
					oa: {
						id: flags.oaId,
						secret_name: flags.oaSecretName,
						package_tier: flags.oaTier,
						package_expires_on: flags.oaExpiresOn,
						verified: flags.oaVerified,
						webhook_mode: flags.webhookMode,
					},
				}
			: {}),
	});
}

export function parseBrandFile(text: string): BrandConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new UsageError("the brand configuration file is not JSON");
	}
	return parseBrandConfig(parsed);
}

export interface BrandOverview {
	readonly brand: string;
	readonly name: string;
	readonly storeCount: number;
	readonly appId: string | null;
	readonly appSecretName: string | null;
	readonly appStatus: string | null;
	readonly oaId: string | null;
	readonly oaSecretName: string | null;
	readonly oaTier: string | null;
	readonly oaExpiresOn: string | null;
	readonly oaVerified: boolean | null;
	readonly webhookMode: string | null;
	readonly miniApps: readonly {
		readonly kind: string;
		readonly id: string;
		readonly title: string;
	}[];
	readonly identities: number;
}

export function showLines(
	brands: readonly BrandOverview[],
	ci: boolean,
): string[] {
	if (brands.length === 0) {
		return ["no brand is configured; add one with fnb zalo config set"];
	}
	return brands.flatMap((brand, index) => {
		const kinds = brand.miniApps.map((app) => app.kind).join(" and ");
		const oaState =
			brand.oaTier === null
				? "no OA"
				: `OA ${brand.oaTier}, ${brand.oaVerified ? "verified" : "not verified"}, webhook ${brand.webhookMode}, package ${brand.oaExpiresOn === null ? "without expiry date" : `until ${brand.oaExpiresOn}`}`;
		const state = `${brand.storeCount} stores; Zalo App ${brand.appStatus ?? "missing"}; ${oaState}; Mini Apps ${kinds === "" ? "none" : kinds}; ${brand.identities} bound identities`;
		if (ci) {
			return [`brand ${index + 1}: ${state}`];
		}
		return [
			`${brand.brand} (${brand.name}): ${state}`,
			`  Zalo App ${brand.appId ?? "–"}, secret ${brand.appSecretName ?? "–"}`,
			...(brand.oaId === null
				? []
				: [`  OA ${brand.oaId}, secret ${brand.oaSecretName ?? "–"}`]),
			...brand.miniApps.map(
				(app) => `  ${app.kind} Mini App ${app.id}: ${app.title}`,
			),
		];
	});
}
