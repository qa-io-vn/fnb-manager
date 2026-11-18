import { catalogParity } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import { appCatalogs, catalogs } from "./catalog";

describe("staff catalogues", () => {
	it("give every Vietnamese key an English message with the same placeholders", () => {
		expect(catalogParity(appCatalogs.vi, appCatalogs.en)).toEqual({
			missingInEnglish: [],
			missingInVietnamese: [],
			placeholderMismatches: [],
			empty: [],
		});
		expect(catalogParity(catalogs.vi, catalogs.en)).toEqual({
			missingInEnglish: [],
			missingInVietnamese: [],
			placeholderMismatches: [],
			empty: [],
		});
	});
});
