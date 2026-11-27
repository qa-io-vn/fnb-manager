import { STORE_CODE_PATTERN } from "@fnb/zalo-mini/loyalty";
import { TABLE_TOKEN_PATTERN } from "@fnb/zalo-mini/ordering";

// A table's QR card opens the app with ?store=<store link key>&src=table&t=<token> (native-till.md section 4). The
// token says nothing by itself: the app sends it to customer_table and shows the table the server names, never a
// label from the address. Without a valid store and token the link is not a table link.

export const TABLE_SOURCE = "table";
export const TABLE_PARAMETER = "t";

export interface TableLink {
	readonly store: string;
	readonly token: string;
}

export function tableLinkFrom(
	params: Readonly<Record<string, string | undefined>>,
): TableLink | null {
	if (params.src !== TABLE_SOURCE) return null;
	const store = params.store?.trim() ?? "";
	const token = params[TABLE_PARAMETER]?.trim() ?? "";
	if (!STORE_CODE_PATTERN.test(store) || !TABLE_TOKEN_PATTERN.test(token))
		return null;
	return { store, token };
}

/** The table link in a scanned code: the link printed on the card (any host; only its query counts). */
export function tableLinkFromText(content: string): TableLink | null {
	const text = content.trim();
	const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : "";
	return tableLinkFrom(Object.fromEntries(new URLSearchParams(query)));
}

/** The table link in what Zalo hands the app on OpenApp: its params or query, or the query of its path. */
export function tableLinkFromEvent(data: unknown): TableLink | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Readonly<Record<string, unknown>>;
	const params = record.params ?? record.query;
	if (typeof params === "object" && params !== null) {
		const found = tableLinkFrom(
			Object.fromEntries(
				Object.entries(params).map(([key, value]) => [key, String(value)]),
			),
		);
		if (found !== null) return found;
	}
	if (typeof record.path !== "string") return null;
	const path = record.path;
	const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
	return tableLinkFrom(Object.fromEntries(new URLSearchParams(query)));
}
