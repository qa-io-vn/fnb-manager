import { catalogParity } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import { looksLikePrice } from "../home/model";
import { appCatalogs, catalogs } from "./catalog";

describe("customer catalogues", () => {
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

	it("follow the registry's spelling and show no price", () => {
		const vietnamese = Object.values(appCatalogs.vi).join("\n");
		expect(vietnamese).not.toMatch(/hoá|huỷ|tuỳ/);
		for (const message of [
			...Object.values(appCatalogs.vi),
			...Object.values(appCatalogs.en),
		]) {
			expect(looksLikePrice(message), message).toBe(false);
		}
	});

	it("name the actions the tickets fix", () => {
		expect(appCatalogs.vi["home.join"]).toBe("Tham gia thành viên");
		expect(appCatalogs.vi["home.claim"]).toBe("Nhận điểm từ hóa đơn");
		expect(appCatalogs.vi["home.atCounter"]).toBe("Xem tại quầy");
		expect(appCatalogs.vi["settings.stop"]).toBe("Dừng nhận tin");
		expect(appCatalogs.vi["wallet.state.pending"]).toBe("Đang chờ xác nhận");
		expect(appCatalogs.vi["legal.privacyTitle"]).toBe(
			"Chính sách bảo mật Mini App {app}",
		);
	});
});
