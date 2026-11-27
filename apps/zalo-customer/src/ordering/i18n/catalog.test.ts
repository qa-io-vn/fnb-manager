import { catalogParity } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import { looksLikePrice } from "../../home/model";
import { appCatalogs } from "../../i18n/catalog";
import { orderingAppCatalogs, orderingCatalogs } from "./catalog";

// The ordering screens' messages: the same rules as the app's catalogues (parity, the registry's spelling, no price
// written in a message: PriceText writes every price), no key shared with the loyalty catalogue, and no brand word.

describe("the ordering catalogues", () => {
	it("give every Vietnamese key an English message with the same placeholders", () => {
		expect(
			catalogParity(orderingAppCatalogs.vi, orderingAppCatalogs.en),
		).toEqual({
			missingInEnglish: [],
			missingInVietnamese: [],
			placeholderMismatches: [],
			empty: [],
		});
		expect(catalogParity(orderingCatalogs.vi, orderingCatalogs.en)).toEqual({
			missingInEnglish: [],
			missingInVietnamese: [],
			placeholderMismatches: [],
			empty: [],
		});
	});

	it("follow the registry's spelling, show no price and reuse no key of the loyalty app", () => {
		const vietnamese = Object.values(orderingAppCatalogs.vi).join("\n");
		expect(vietnamese).not.toMatch(/hoá|huỷ|tuỳ|[Xx]oá/);
		for (const message of [
			...Object.values(orderingAppCatalogs.vi),
			...Object.values(orderingAppCatalogs.en),
		]) {
			expect(looksLikePrice(message), message).toBe(false);
		}
		expect(
			Object.keys(orderingAppCatalogs.vi).filter(
				(key) => key in appCatalogs.vi,
			),
		).toEqual([]);
	});

	it("name the owner's actions and the three ways to pay", () => {
		expect(orderingAppCatalogs.vi["order.call"]).toBe("Gọi nhân viên");
		expect(orderingAppCatalogs.vi["order.again"]).toBe("Gọi thêm");
		expect(orderingAppCatalogs.vi["checkout.counter"]).toBe("Trả tại quầy");
		expect(orderingAppCatalogs.vi["checkout.wallet"]).toBe("Ví ZaloPay");
		expect(orderingAppCatalogs.vi["checkout.transfer"]).toBe("Chuyển khoản QR");
		expect(orderingAppCatalogs.vi["tab.menu"]).toBe("Thực đơn");
		expect(orderingAppCatalogs.vi["tab.stamps"]).toBe("Tích điểm");
		expect(orderingAppCatalogs.vi["tab.me"]).toBe("Tôi");
	});
});
