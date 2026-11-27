import type { MenuCategory, MenuItem } from "@fnb/zalo-mini/ordering";

// The menu search of C02: on the client, with or without Vietnamese marks ("ca phe sua" finds "Cà phê sữa"), every
// word of the query in the item's name or description, in any order.

/** Lower case without diacritics: NFD, combining marks removed, đ as d. */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/đ/g, "d")
		.replace(/Đ/g, "D")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

export function matchesQuery(item: MenuItem, query: string): boolean {
	const words = fold(query)
		.split(" ")
		.filter((word) => word !== "");
	if (words.length === 0) return true;
	const haystack = fold(`${item.name} ${item.description ?? ""}`);
	return words.every((word) => haystack.includes(word));
}

/** The categories with only the items the query matches, and no empty category. */
export function searchMenu(
	categories: readonly MenuCategory[],
	query: string,
): readonly MenuCategory[] {
	return categories
		.map((category) => ({
			...category,
			items: category.items.filter((item) => matchesQuery(item, query)),
		}))
		.filter((category) => category.items.length > 0);
}
