import { STORE_CODE_PATTERN } from "@fnb/zalo-mini/loyalty";

export const LINK_SOURCES = ["qr", "standee", "receipt"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

export const STORE_PARAMETER = "store";
export const SOURCE_PARAMETER = "src";
export const ZALO_MINI_APP_LINK = "https://zalo.me/s/";
const MINI_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface StoreLink {
	readonly store: string;
	readonly source: LinkSource | null;
}

export function storeLinkFrom(
	params: Readonly<Record<string, string | undefined>>,
): StoreLink | null {
	const store = params[STORE_PARAMETER]?.trim() ?? "";
	if (!STORE_CODE_PATTERN.test(store)) return null;
	const source =
		LINK_SOURCES.find((name) => name === params[SOURCE_PARAMETER]) ?? null;
	return { store, source };
}

export function storeLinkFromPath(path: unknown): StoreLink | null {
	if (typeof path !== "string") return null;
	const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
	return storeLinkFrom(Object.fromEntries(new URLSearchParams(query)));
}

export function storeLinkFromEvent(data: unknown): StoreLink | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Readonly<Record<string, unknown>>;
	const params = record.params ?? record.query;
	if (typeof params === "object" && params !== null) {
		const found = storeLinkFrom(
			Object.fromEntries(
				Object.entries(params).map(([key, value]) => [key, String(value)]),
			),
		);
		if (found !== null) return found;
	}
	return storeLinkFromPath(record.path);
}

export function miniAppLink(miniAppId: string): string {
	if (!MINI_APP_ID_PATTERN.test(miniAppId)) {
		throw new Error(
			"a Mini App id is 1 to 64 letters, digits, - or _, as Zalo shows it",
		);
	}
	return `${ZALO_MINI_APP_LINK}${miniAppId}/`;
}

export function storeDeepLink(
	base: string,
	store: string,
	source: LinkSource,
): string {
	if (!STORE_CODE_PATTERN.test(store)) {
		throw new Error(
			`${store} is not a store link key: 1 to 64 of A-Z, a-z, 0-9, ., _ and -`,
		);
	}
	const url = new URL(base);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("a store link starts with https:// or http://");
	}
	url.searchParams.delete(STORE_PARAMETER);
	url.searchParams.delete(SOURCE_PARAMETER);
	url.searchParams.append(STORE_PARAMETER, store);
	url.searchParams.append(SOURCE_PARAMETER, source);
	return url.toString();
}
