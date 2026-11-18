export type Language = "vi" | "en";

export const LANGUAGES: readonly Language[] = ["vi", "en"];

export type MessageParams = Readonly<Record<string, string | number>>;

export type Catalog = Readonly<Record<string, string>>;

export type Translate = (key: string, params?: MessageParams) => string;

export function interpolate(template: string, params?: MessageParams): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined ? placeholder : String(value);
	});
}

export function languageFrom(value: string | null | undefined): Language {
	return value?.trim().toLowerCase().startsWith("en") ? "en" : "vi";
}

export function createTranslator(
	catalog: Catalog,
	onMissing: (key: string) => void = () => undefined,
): Translate {
	return (key, params) => {
		const template = catalog[key];
		if (template === undefined) {
			onMissing(key);
			return key;
		}
		return interpolate(template, params);
	};
}

export function mergeCatalogs(...catalogs: readonly Catalog[]): Catalog {
	const merged: Record<string, string> = {};
	for (const catalog of catalogs) {
		for (const [key, value] of Object.entries(catalog)) {
			if (Object.hasOwn(merged, key)) {
				throw new Error(`message key ${key} is defined twice`);
			}
			merged[key] = value;
		}
	}
	return merged;
}

export interface CatalogParity {
	readonly missingInEnglish: readonly string[];
	readonly missingInVietnamese: readonly string[];
	readonly placeholderMismatches: readonly string[];
	readonly empty: readonly string[];
}

function placeholdersOf(template: string): string {
	return [...template.matchAll(/\{(\w+)\}/g)]
		.map((match) => match[1])
		.sort()
		.join(",");
}

export function catalogParity(vi: Catalog, en: Catalog): CatalogParity {
	const viKeys = Object.keys(vi);
	const enKeys = Object.keys(en);
	return {
		missingInEnglish: viKeys.filter((key) => !Object.hasOwn(en, key)),
		missingInVietnamese: enKeys.filter((key) => !Object.hasOwn(vi, key)),
		placeholderMismatches: viKeys.filter(
			(key) =>
				Object.hasOwn(en, key) &&
				placeholdersOf(vi[key] ?? "") !== placeholdersOf(en[key] ?? ""),
		),
		empty: [...viKeys, ...enKeys].filter(
			(key) => (vi[key] ?? en[key] ?? "").trim() === "",
		),
	};
}
