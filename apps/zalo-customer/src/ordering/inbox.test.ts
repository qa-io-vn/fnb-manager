import { createTranslator } from "@fnb/zalo-mini/i18n/translate";
import type { InboxItem } from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { orderingCatalogs } from "./i18n/catalog";
import {
	inboxAgo,
	inboxPath,
	inboxText,
	PRICE_MARK,
	splitAtPrice,
} from "./inbox";
import { badgeText } from "./inbox-bell";

// Unit tests of C12's words and places (design spec C12): boundary values of "how long ago" (59.999 s and 60 s, 59:59
// and 60:00, the shop's midnight on either side, the day before and two days before) on the shop's calendar; a
// decision table of what each kind says (a table or a takeaway, with or without a number, a refund due or not, each
// way money goes back, a campaign's text or a promotion's); every price kept out of the words (a marker PriceText
// replaces); where each target leads; and the bell's badge at 99 and 100.

const t = createTranslator(orderingCatalogs.vi, (key) => {
	throw new Error(`no message ${key}`);
});

const base: InboxItem = {
	id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
	cursor: 1,
	kind: "order_ready",
	topic: "orders",
	createdAt: "2026-11-27T05:00:00.000Z",
	readAt: null,
	target: "order",
	orderId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
	order: {
		displayNo: "#007",
		type: "table",
		tableLabel: "Bàn 12",
		status: "serving",
		paymentStatus: "paid",
		total: 74000,
		pickupAt: null,
		cancelReason: null,
		firstItem: "Cà phê sữa",
		items: 1,
	},
	rewardName: null,
	params: {
		orderType: "table",
		amount: null,
		method: null,
		reason: null,
		refundDue: null,
		refundedOn: null,
		by: null,
		added: null,
		stamps: null,
		left: null,
		per: null,
		rewards: null,
		offer: null,
		inactiveDays: null,
	},
	title: null,
	line: null,
};

const item = (overrides: Partial<InboxItem>): InboxItem => ({
	...base,
	...overrides,
});
const params = (overrides: Partial<InboxItem["params"]>) => ({
	...base.params,
	...overrides,
});

describe("how long ago", () => {
	// 12:00 in Ho Chi Minh City on 27 November 2026
	const noon = Date.parse("2026-11-27T05:00:00.000Z");
	const at = (ms: number) => new Date(noon - ms).toISOString();

	it.each([
		[0, "vừa xong"],
		[59_999, "vừa xong"],
		[60_000, "1 phút trước"],
		[3_599_999, "59 phút trước"],
		[3_600_000, "hôm nay"],
		[12 * 3_600_000, "hôm nay"],
		[12 * 3_600_000 + 1, "hôm qua"],
		[36 * 3_600_000, "hôm qua"],
		[36 * 3_600_000 + 1, "2 ngày trước"],
		[6 * 86_400_000, "6 ngày trước"],
	])("%i ms before noon reads %s", (ago, words) => {
		const { key, values } = inboxAgo(at(ago), noon);
		expect(t(key, values)).toBe(words);
	});

	it("reads an item from a clock a little ahead as just now", () => {
		expect(inboxAgo(new Date(noon + 5_000).toISOString(), noon).key).toBe(
			"inbox.ago.now",
		);
	});
});

describe("what an item says", () => {
	it("an order brought to the table names its first item, the others and the table", () => {
		expect(inboxText(item({}), t)).toEqual({
			title: "Món của bạn đã xong",
			line: "Cà phê sữa đang trên đường ra Bàn 12",
			price: null,
		});
		const three = item({
			order: { ...base.order, items: 3 } as InboxItem["order"],
		});
		expect(inboxText(three, t).line).toBe(
			"Cà phê sữa và 2 món khác đang trên đường ra Bàn 12",
		);
	});

	it("a takeaway ready asks the customer to the counter, with or without a number", () => {
		const takeaway = item({
			params: params({ orderType: "takeaway" }),
			order: {
				...base.order,
				type: "takeaway",
				tableLabel: null,
			} as InboxItem["order"],
		});
		expect(inboxText(takeaway, t).line).toBe(
			"Đơn #007 đã xong, mời bạn ra quầy lấy món",
		);
		expect(
			inboxText(
				{
					...takeaway,
					order: { ...takeaway.order, displayNo: null } as InboxItem["order"],
				},
				t,
			).line,
		).toBe("Đơn của bạn đã xong, mời bạn ra quầy lấy món");
	});

	it("a receipt carries its amount for PriceText, never in the words", () => {
		const receipt = inboxText(
			item({ kind: "order_receipt", params: params({ amount: 74000 }) }),
			t,
		);
		expect(receipt.title).toBe("Hóa đơn #007");
		expect(receipt.price).toBe(74000);
		expect(receipt.line).toBe(`Đã thanh toán ${PRICE_MARK}`);
		expect(receipt.line).not.toMatch(/\d/);
		expect(splitAtPrice(receipt.line)).toEqual(["Đã thanh toán ", ""]);
	});

	it.each([
		[null, "Quán đang quá đông.", null],
		[
			45000,
			`Quán đang quá đông. Quán hoàn ${PRICE_MARK} cho bạn theo cách bạn đã trả.`,
			45000,
		],
	])(
		"a cancellation with refund due %s says why and what comes back",
		(due, line, price) => {
			const text = inboxText(
				item({
					kind: "order_cancelled",
					params: params({ reason: "store_busy", refundDue: due }),
				}),
				t,
			);
			expect(text).toEqual({ title: "Đơn #007 đã hủy", line, price });
		},
	);

	it("an unknown cancel reason reads as the shop's cancellation", () => {
		expect(
			inboxText(
				item({
					kind: "order_cancelled",
					params: params({ reason: "suspected_prank" }),
				}),
				t,
			).line,
		).toBe("Quán đã hủy đơn.");
	});

	it.each([
		["cash", `Quán đã trả lại ${PRICE_MARK} tiền mặt ngày 28/11/2026.`],
		["card", `Quán đã hoàn ${PRICE_MARK} vào thẻ ngày 28/11/2026.`],
		[
			"zalo_checkout",
			`Quán đã hoàn ${PRICE_MARK} vào Ví ZaloPay ngày 28/11/2026.`,
		],
		[
			"vietqr",
			`Quán đã hoàn ${PRICE_MARK} vào tài khoản đã chuyển ngày 28/11/2026.`,
		],
		["voucher", `Quán đã hoàn ${PRICE_MARK} ngày 28/11/2026.`],
	])(
		"a refund by %s says how much went back, how and on which day",
		(method, line) => {
			const text = inboxText(
				item({
					kind: "order_refunded",
					params: params({ amount: 40000, method, refundedOn: "2026-11-28" }),
				}),
				t,
			);
			expect(text).toEqual({
				title: "Đã hoàn tiền đơn #007",
				line,
				price: 40000,
			});
		},
	);

	it("stamps and a full card name the brand's reward", () => {
		expect(
			inboxText(
				item({
					kind: "stamp",
					topic: "offers",
					target: "stamps",
					rewardName: "Ly miễn phí",
					params: params({ added: 1, left: 8 }),
				}),
				t,
			),
		).toEqual({
			title: "Thêm 1 dấu vào thẻ tích dấu",
			line: "Còn 8 ly nữa là có Ly miễn phí",
			price: null,
		});
		expect(
			inboxText(
				item({
					kind: "reward",
					topic: "offers",
					target: "stamps",
					rewardName: "Ly miễn phí",
				}),
				t,
			).title,
		).toBe("Đủ dấu rồi, bạn có quà");
	});

	it("a campaign shows its own title and line; a promotion its words", () => {
		const offer = item({
			kind: "offer",
			topic: "offers",
			target: "offers",
			orderId: null,
			order: null,
		});
		expect(
			inboxText(
				{ ...offer, title: "Ưu đãi cuối tuần", line: "Giảm giá trước 10 giờ" },
				t,
			),
		).toEqual({
			title: "Ưu đãi cuối tuần",
			line: "Giảm giá trước 10 giờ",
			price: null,
		});
		expect(
			inboxText({ ...offer, params: params({ offer: "win_back" }) }, t).title,
		).toBe("Lâu rồi chưa gặp bạn");
		expect(
			inboxText({ ...offer, params: params({ offer: "birthday" }) }, t).title,
		).toBe("Chúc mừng sinh nhật");
	});
});

describe("where an item leads, and the badge", () => {
	it("opens the order, the card or the offers", () => {
		expect(inboxPath(item({}))).toBe(
			"/don/aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
		);
		expect(
			inboxPath(item({ kind: "stamp", target: "stamps", orderId: null })),
		).toBe("/the-thanh-vien");
		expect(
			inboxPath(item({ kind: "offer", target: "offers", orderId: null })),
		).toBe("/doi-qua");
	});

	it("counts to 99 and then says 99+", () => {
		expect(badgeText(1)).toBe("1");
		expect(badgeText(99)).toBe("99");
		expect(badgeText(100)).toBe("99+");
	});
});
