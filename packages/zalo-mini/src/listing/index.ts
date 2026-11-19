import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	MINI_APP_KINDS,
	type MiniAppKind,
	titleProblems,
} from "../app-config/index";
import { STORE_CODE_PATTERN } from "../loyalty/contract";

export { decodePng, LOGO_MIN_SIDE, logoProblems, PngError } from "./png";

const CONFIG_FOLDER = join(import.meta.dirname, "..", "..", "config");
export const SYNTHETIC_LISTING_CONFIGS: readonly string[] = [
	join(CONFIG_FOLDER, "synthetic-brands.json"),
	join(CONFIG_FOLDER, "synthetic-listings.json"),
];
export const LISTING_CATEGORY = "FNB";
export const DESCRIPTION_MIN_LENGTH = 20;
export const DESCRIPTION_MAX_LENGTH = 500;
export const MINI_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_CHARACTERS = /^[\p{L}\p{M}\p{N} &'’.,-]+$/u;
const LINK_PATTERN =
	/https?:\/\/|www\.|zalo\.me|\b[\p{L}\p{N}-]+\.(?:com|vn|net|org|me|io|app)\b/iu;

export interface ListingStore {
	readonly code: string;
	readonly name: string;
}

export interface Listing {
	readonly brandKey: string;
	readonly kind: MiniAppKind;
	readonly miniAppId: string | null;
	readonly name: string;
	readonly headerTitle: string | null;
	readonly headerColor: string | null;
	readonly textColor: "white" | "black" | null;
	readonly ownerMark: string | null;
	readonly description: string | null;
	readonly category: string | null;
	readonly logo: string | null;
	readonly stores: readonly ListingStore[];
	readonly problems: readonly string[];
}

export const LISTING_FIELDS = [
	"owner_mark",
	"description",
	"category",
	"logo",
] as const;

export const OWNER_CHECKLIST: readonly string[] = [
	"the logo is the brand's own mark and shows no QR code and no phone number",
	"the owner confirmed the owner-identifying part of the name",
	"the description says what the Mini App does, in Vietnamese with diacritics",
];

export class ListingConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ListingConfigError";
	}
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(
	row: Row,
	field: string,
	problems: string[],
): string | null {
	const value = row[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		problems.push(`${field} must be text`);
		return null;
	}
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

function readStores(value: unknown, problems: string[]): ListingStore[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		problems.push("stores must be a list of {code, name}");
		return [];
	}
	const stores: ListingStore[] = [];
	const seen = new Set<string>();
	value.forEach((entry: unknown, index) => {
		if (!isRecord(entry)) {
			problems.push(`store ${index + 1} must be {code, name}`);
			return;
		}
		const code = typeof entry.code === "string" ? entry.code.trim() : "";
		const name = typeof entry.name === "string" ? entry.name.trim() : "";
		if (!STORE_CODE_PATTERN.test(code)) {
			problems.push(
				`store ${index + 1}: code must be the store's link key, 1 to 64 of A-Z, a-z, 0-9, ., _ and -`,
			);
			return;
		}
		if (name === "") {
			problems.push(`store ${code}: name is required`);
			return;
		}
		if (seen.has(code)) {
			problems.push(`store ${code} is listed twice`);
			return;
		}
		seen.add(code);
		stores.push({ code, name });
	});
	return stores;
}

function readListing(value: unknown, brandFallback: string | null): Listing {
	if (!isRecord(value))
		throw new ListingConfigError("a Mini App row must be an object");
	const problems: string[] = [];
	const brandKey =
		(typeof value.brand_key === "string" && value.brand_key.trim()) ||
		brandFallback ||
		"";
	if (brandKey === "") problems.push("brand_key is required");
	const kind = MINI_APP_KINDS.find((name) => name === value.kind);
	if (kind === undefined) {
		throw new ListingConfigError(
			`${brandKey || "a row"}: kind must be staff or customer`,
		);
	}
	const miniAppId = optionalText(value, "id", problems);
	if (miniAppId !== null && !MINI_APP_ID_PATTERN.test(miniAppId)) {
		problems.push(
			"id must be the Mini App id Zalo shows: letters, digits, - or _",
		);
	}
	const textColor = value.text_color_light;
	return {
		brandKey,
		kind,
		miniAppId,
		name: typeof value.title === "string" ? value.title.trim() : "",
		headerTitle: optionalText(value, "header_title_vi", problems),
		headerColor: optionalText(value, "header_color_light", problems),
		textColor:
			textColor === "white" || textColor === "black" ? textColor : null,
		ownerMark: optionalText(value, "owner_mark", problems),
		description: optionalText(value, "description", problems),
		category: optionalText(value, "category", problems),
		logo: optionalText(value, "logo", problems),
		stores: readStores(value.stores, problems),
		problems,
	};
}

function rowsOf(value: unknown): Row[] {
	if (!isRecord(value)) {
		throw new ListingConfigError("a configuration file must hold an object");
	}
	const brand =
		typeof value.brand === "string" && value.brand.trim() !== ""
			? value.brand.trim()
			: null;
	const rows: Row[] = [];
	for (const field of ["mini_apps", "listings"] as const) {
		const list = value[field];
		if (list === undefined) continue;
		if (!Array.isArray(list)) {
			throw new ListingConfigError(`${field} must be a list`);
		}
		for (const row of list) {
			if (!isRecord(row)) {
				throw new ListingConfigError(`every ${field} row must be an object`);
			}
			rows.push(
				typeof row.brand_key === "string" || brand === null
					? row
					: { ...row, brand_key: brand },
			);
		}
	}
	return rows;
}

export function readListings(...values: readonly unknown[]): Listing[] {
	if (
		!values.some((value) => isRecord(value) && Array.isArray(value.mini_apps))
	) {
		throw new ListingConfigError("the configuration needs a mini_apps list");
	}
	const merged = new Map<string, Record<string, unknown>>();
	for (const value of values) {
		for (const row of rowsOf(value)) {
			const key = `${String(row.brand_key)} ${String(row.kind)}`;
			const defined = Object.fromEntries(
				Object.entries(row).filter(([, field]) => field !== undefined),
			);
			merged.set(key, { ...merged.get(key), ...defined });
		}
	}
	return [...merged.values()].map((row) => readListing(row, null));
}

function withLogoFrom(value: unknown, folder: string): unknown {
	if (!isRecord(value)) return value;
	const resolveRows = (list: unknown) =>
		Array.isArray(list)
			? list.map((row: unknown) =>
					isRecord(row) &&
					typeof row.logo === "string" &&
					row.logo.trim() !== ""
						? { ...row, logo: resolve(folder, row.logo.trim()) }
						: row,
				)
			: list;
	return {
		...value,
		mini_apps: resolveRows(value.mini_apps),
		listings: resolveRows(value.listings),
	};
}

export function loadListings(paths: readonly string[]): Listing[] {
	return readListings(
		...paths.map((path) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(readFileSync(path, "utf8"));
			} catch (error) {
				throw new ListingConfigError(
					`${path} cannot be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return withLogoFrom(parsed, dirname(path));
		}),
	);
}

export function isListed(listing: Listing): boolean {
	return (
		listing.kind === "customer" ||
		listing.ownerMark !== null ||
		listing.description !== null ||
		listing.category !== null ||
		listing.logo !== null
	);
}

function length(text: string): number {
	return [...text.normalize("NFC")].length;
}

function folded(text: string): string {
	return text.normalize("NFC").toLocaleLowerCase("vi");
}

export function nameProblems(name: string, ownerMark: string | null): string[] {
	if (name === "") return ["the name (title) is required"];
	const problems = titleProblems(name).map((problem) =>
		problem.replace(/^title/, "the name"),
	);
	if (!NAME_CHARACTERS.test(name)) {
		problems.push("the name must not contain emoji or special characters");
	}
	if (ownerMark === null) {
		problems.push(
			"owner_mark is required: the part of the name that identifies the business, as the owner confirmed it",
		);
	} else if (!folded(name).includes(folded(ownerMark))) {
		problems.push(`the name must contain the owner's mark "${ownerMark}"`);
	}
	return problems;
}

export function descriptionProblems(description: string | null): string[] {
	if (description === null) return ["description is required"];
	const problems: string[] = [];
	const size = length(description);
	if (size < DESCRIPTION_MIN_LENGTH || size > DESCRIPTION_MAX_LENGTH) {
		problems.push(
			`the description must be ${DESCRIPTION_MIN_LENGTH} to ${DESCRIPTION_MAX_LENGTH} characters; it has ${size}`,
		);
	}
	if (LINK_PATTERN.test(description)) {
		problems.push("the description must not contain a link");
	}
	return problems;
}

export function listingProblems(listing: Listing): string[] {
	const problems = [
		...listing.problems,
		...nameProblems(listing.name, listing.ownerMark),
		...descriptionProblems(listing.description),
	];
	if (listing.category === null) {
		problems.push(`category is required: ${LISTING_CATEGORY}`);
	} else if (listing.category !== LISTING_CATEGORY) {
		problems.push(
			`the category must be ${LISTING_CATEGORY} for a food and drink business; it is ${listing.category}`,
		);
	}
	if (listing.logo === null) problems.push("logo is required: a PNG file");
	return problems;
}

export function selectListing(
	listings: readonly Listing[],
	brandKey: string,
	kind: MiniAppKind = "customer",
): Listing {
	const found = listings.find(
		(listing) => listing.brandKey === brandKey && listing.kind === kind,
	);
	if (found === undefined) {
		throw new ListingConfigError(
			`no ${kind} Mini App is configured for ${brandKey}`,
		);
	}
	return found;
}
