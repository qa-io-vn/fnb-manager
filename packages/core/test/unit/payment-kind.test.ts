import { describe, expect, it } from "vitest";
import { classifyPaymentKind } from "../../src/index.js";

describe("classifyPaymentKind", () => {
	it.each([
		["Tiền mặt", "cash"],
		["TIỀN MẶT", "cash"],
		["Cash", "cash"],
		["COD", "cash"],
		["Momo QR đa năng", "ewallet"],
		["MOMO_QR_AIO", "ewallet"],
		["MoMo QR Tĩnh", "ewallet"],
		["ZaloPay", "ewallet"],
		["VNPay QR", "ewallet"],
		["ShopeePay", "ewallet"],
		["TRANSFER", "bank_transfer"],
		["Chuyển khoản", "bank_transfer"],
		["Bank QR", "bank_transfer"],
		["Thẻ", "card"],
		["Card", "card"],
		["Visa", "card"],
		["Mastercard", "card"],
		["ATM", "card"],
		["Voucher", "voucher"],
		["Voucher đối tác", "voucher"],
		["Điểm thưởng", "other"],
		["", "other"],
	])("maps %j to %s", (name, kind) => {
		expect(classifyPaymentKind(name)).toBe(kind);
	});

	it("does not treat substrings of unrelated words as cash or card", () => {
		expect(classifyPaymentKind("Codino")).toBe("other");
		expect(classifyPaymentKind("Thẻ bàn")).toBe("card");
		expect(classifyPaymentKind("Discard")).toBe("other");
	});

	it("does not read generic English or Vietnamese words as tenders", () => {
		expect(classifyPaymentKind("Pay at the counter")).toBe("other");
		expect(classifyPaymentKind("TT thẻ")).toBe("card");
		expect(classifyPaymentKind("TT sau")).toBe("other");
	});

	it("lets per-tenant overrides win over the default patterns", () => {
		const overrides = {
			"Momo QR đa năng": "bank_transfer",
			Khác: "voucher",
		} as const;
		expect(classifyPaymentKind("Momo QR đa năng", { overrides })).toBe(
			"bank_transfer",
		);
		expect(classifyPaymentKind("momo qr đa năng ", { overrides })).toBe(
			"bank_transfer",
		);
		expect(classifyPaymentKind("Khác", { overrides })).toBe("voucher");
		expect(classifyPaymentKind("Tiền mặt", { overrides })).toBe("cash");
	});

	it("accepts a replacement rule set", () => {
		const rules = [{ kind: "card", pattern: /gold/iu }] as const;
		expect(classifyPaymentKind("Gold member", { rules })).toBe("card");
		expect(classifyPaymentKind("Tiền mặt", { rules })).toBe("other");
	});
});
