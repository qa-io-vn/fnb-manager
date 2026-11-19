import { describe, expect, it } from "vitest";
import {
	parseVoucherCallback,
	VOUCHER_CALLBACK_PAYLOAD_VERSION,
	voucherCallbackResponse,
} from "../../src/voucher-callback/index.js";

const ASSUMED_PAYLOAD_STATUS = "assumed";

function assumedPayload(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		Pos_Parent: "SYNTHETIC-BRAND",
		Pos_Id: 101,
		Coupon_Code: " SYNC2345 ",
		Membership_Id: "0900000101",
		Sale_Tran_Id: "synthetic-sale-0101",
		Created_At: "2026-11-19 10:00:00",
		Code: 1,
		Date_Start: "2026-11-01",
		Date_End: "2026-12-31",
		Voucher_Order_Line: [
			{
				Item_Type_Id: "TYPE-1",
				Item_Id: "ITEM-A",
				Description: "Synthetic drink",
				Quantity: 2,
				Amount: 60000,
				Pr_Key: 1,
				Price_Sale: 30000,
				Discount: 0,
				Detail_State: 0,
				Package_Id: null,
			},
			{
				Item_Id: 77,
				Quantity: "1",
				Amount: "40000",
				Price_Sale: 40000,
				Discount: 5000,
			},
		],
		...overrides,
	};
}

describe("the voucher callback adapter (payload shape assumed from the 2020 vendor pages)", () => {
	it("is versioned and marked as assumed", () => {
		expect(VOUCHER_CALLBACK_PAYLOAD_VERSION).toContain("assumed");
		expect(ASSUMED_PAYLOAD_STATUS).toBe("assumed");
	});

	it("turns the vendor payload into canonical values", () => {
		const parsed = parseVoucherCallback(assumedPayload());
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		expect(parsed.request).toEqual({
			payloadVersion: VOUCHER_CALLBACK_PAYLOAD_VERSION,
			storeRef: "101",
			brandRef: "SYNTHETIC-BRAND",
			programmeRef: null,
			code: "SYNC2345",
			saleRef: "synthetic-sale-0101",
			memberPhone: "0900000101",
			memberAttached: true,
			lines: [
				{ item: "ITEM-A", quantity: 2, amount: 60000 },
				{ item: "77", quantity: 1, amount: 35000 },
			],
			billAmount: 95000,
		});
		expect(JSON.stringify(parsed.request)).not.toMatch(
			/Pos_|Coupon_|Sale_Tran|Voucher_Order/,
		);
	});

	it("keeps a membership id that is not a phone out of the phone field", () => {
		const parsed = parseVoucherCallback(
			assumedPayload({ Membership_Id: "MEMBER-0001" }),
		);
		expect(parsed.ok && parsed.request.memberPhone).toBe(null);
		expect(parsed.ok && parsed.request.memberAttached).toBe(true);
		const none = parseVoucherCallback(assumedPayload({ Membership_Id: "" }));
		expect(none.ok && none.request.memberAttached).toBe(false);
	});

	it("refuses a malformed payload with field paths only", () => {
		for (const body of [
			null,
			[],
			"text",
			assumedPayload({ Coupon_Code: undefined }),
			assumedPayload({ Coupon_Code: "TWO WORDS" }),
			assumedPayload({ Pos_Id: "" }),
			assumedPayload({ Sale_Tran_Id: { id: 1 } }),
			assumedPayload({
				Voucher_Order_Line: [{ Item_Id: "ITEM-A", Quantity: "two", Amount: 1 }],
			}),
			assumedPayload({
				Voucher_Order_Line: new Array(301).fill({
					Item_Id: "A",
					Quantity: 1,
					Amount: 1,
				}),
			}),
		]) {
			const parsed = parseVoucherCallback(body);
			expect(parsed.ok).toBe(false);
			if (!parsed.ok) {
				expect(parsed.reason).toBe("malformed");
				expect(parsed.fields.join(" ")).not.toContain("SYNC2345");
			}
		}
	});

	it("refuses amounts out of range, an amount above its line total among them", () => {
		for (const line of [
			{ Item_Id: "ITEM-A", Quantity: 1, Price_Sale: 30000, Amount: 90000 },
			{
				Item_Id: "ITEM-A",
				Quantity: 1,
				Price_Sale: 30000,
				Amount: 30000,
				Discount: 40000,
			},
			{ Item_Id: "ITEM-A", Quantity: 0, Amount: 0 },
			{ Item_Id: "ITEM-A", Quantity: 20000, Amount: 1 },
			{ Item_Id: "ITEM-A", Quantity: 1, Amount: -5 },
		]) {
			const parsed = parseVoucherCallback(
				assumedPayload({ Voucher_Order_Line: [line] }),
			);
			expect(parsed).toMatchObject({
				ok: false,
				reason: "amount_out_of_range",
				fields: ["Voucher_Order_Line[0]"],
			});
		}
		const huge = parseVoucherCallback(
			assumedPayload({
				Voucher_Order_Line: [
					{
						Item_Id: "A",
						Quantity: 10,
						Price_Sale: 90_000_000,
						Amount: 900_000_000,
					},
					{
						Item_Id: "B",
						Quantity: 10,
						Price_Sale: 90_000_000,
						Amount: 900_000_000,
					},
				],
			}),
		);
		expect(huge).toMatchObject({ ok: false, reason: "amount_out_of_range" });
	});

	it("answers in the vendor shape, echoing the payload", () => {
		const payload = assumedPayload();
		expect(
			voucherCallbackResponse(payload, {
				discountAmount: 6000.7,
				description: "Giảm 10%",
				accepted: true,
			}),
		).toMatchObject({
			Sale_Tran_Id: "synthetic-sale-0101",
			Discount_Amount: 6000,
			Discount_Description: "Giảm 10%",
			Code: 1,
		});
		expect(
			voucherCallbackResponse(null, {
				discountAmount: 0,
				description: "Mã đã được sử dụng",
				accepted: false,
			}),
		).toEqual({
			Discount_Amount: 0,
			Discount_Description: "Mã đã được sử dụng",
		});
	});
});
