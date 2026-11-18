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

	it("use the registry's spelling: hóa, hủy and tùy", () => {
		const older = Object.entries(catalogs.vi).filter(([, message]) =>
			/(hoá|huỷ|tuỳ)/i.test(message.normalize("NFC")),
		);
		expect(older).toEqual([]);
		expect(catalogs.vi["profile.withdraw.cancel"]).toBe("Hủy");
	});
});
