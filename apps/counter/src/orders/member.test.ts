import { describe, expect, it } from "vitest";
import {
	ATTACH_AFTER_COMPLETION_MS,
	attachable,
	groupedNumber,
	luhnCheckDigit,
	readMemberCode,
	shortName,
	stampUnits,
} from "./member";
import type { Order } from "./types";

// counter:unit/member-code (Q01 "Quét mã thành viên", C20; native-till.md 16.5):
// - the Luhn check digit against the database's own app.luhn_check_digit (values read from the local stack);
// - EP and BVA of what the cashier types: empty, letters, 7, 8 and 9 digits, spaces, dots and dashes, a wrong check
//   digit (each single-digit slip is caught), the QR payload and its malformed neighbours;
// - security: the name shown is the last word, 20 characters at most, whatever an answer carries;
// - decision table of "Gắn thẻ thành viên": source × attached × status × payment × minutes since completion.

const ORDER = "99999999-0000-4000-8000-000000000042";
const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";

describe("the Luhn check digit", () => {
	it("matches the database's app.luhn_check_digit", () => {
		const oracle: readonly [string, number][] = [
			["4821736", 8],
			["0000000", 0],
			["1234567", 4],
			["7992739871", 3],
			["9999999", 7],
			["0000001", 8],
			["5000000", 9],
		];
		for (const [digits, check] of oracle)
			expect(luhnCheckDigit(digits), digits).toBe(check);
	});

	it("refuses anything but digits", () => {
		expect(() => luhnCheckDigit("12a")).toThrow(RangeError);
		expect(() => luhnCheckDigit("")).toThrow(RangeError);
	});
});

describe("reading a typed or scanned member code (EP, BVA)", () => {
	it("takes 8 digits with a right check digit, with or without separators", () => {
		for (const typed of ["48217368", "4821 7368", " 4821-7368 ", "4821.7368"])
			expect(readMemberCode(typed), typed).toEqual({
				ok: true,
				kind: "number",
				code: "48217368",
			});
	});

	it("refuses 7 and 9 digits (boundaries around 8), empty and letters", () => {
		expect(readMemberCode("4821736")).toEqual({
			ok: false,
			problem: "too_short",
		});
		expect(readMemberCode("482173680")).toEqual({
			ok: false,
			problem: "too_long",
		});
		expect(readMemberCode("")).toEqual({ ok: false, problem: "empty" });
		expect(readMemberCode("   ")).toEqual({ ok: false, problem: "empty" });
		expect(readMemberCode("4821 736a")).toEqual({
			ok: false,
			problem: "not_digits",
		});
	});

	it("catches every single-digit slip and every check digit but the right one", () => {
		for (let check = 0; check <= 9; check += 1) {
			const answer = readMemberCode(`4821736${check}`);
			expect(answer.ok, String(check)).toBe(check === 8);
		}
		const right = "48217368";
		for (let position = 0; position < 7; position += 1) {
			for (let digit = 0; digit <= 9; digit += 1) {
				if (String(digit) === right[position]) continue;
				const slipped = `${right.slice(0, position)}${digit}${right.slice(position + 1)}`;
				expect(readMemberCode(slipped), slipped).toEqual({
					ok: false,
					problem: "check_digit",
				});
			}
		}
	});

	it("takes the QR payload as scanned and refuses its malformed neighbours", () => {
		expect(readMemberCode(`fnb-stamp:1:${TOKEN}`)).toEqual({
			ok: true,
			kind: "qr",
			code: `fnb-stamp:1:${TOKEN}`,
		});
		for (const bad of [
			`fnb-stamp:2:${TOKEN}`,
			`fnb-stamp:1:${TOKEN.slice(1)}`,
			`fnb-stamp:1:${TOKEN}A`,
			`fnb-stamp:1:${TOKEN.slice(1)}=`,
			"https://example.test/?code=48217368",
		])
			expect(readMemberCode(bad).ok, bad).toBe(false);
	});

	it("groups the digits typed as the customer's screen shows them", () => {
		expect(groupedNumber("4821")).toBe("4821");
		expect(groupedNumber("48217")).toBe("4821 7");
		expect(groupedNumber("4821-7368")).toBe("4821 7368");
		expect(groupedNumber("482173689999")).toBe("4821 7368");
		expect(groupedNumber("abc")).toBe("");
	});
});

describe("the name the counter shows (security)", () => {
	it("is the last word, at most 20 characters, never a full name", () => {
		expect(shortName("Lan")).toBe("Lan");
		expect(shortName("Nguyễn Thị Lan")).toBe("Lan");
		expect(shortName("  Trần   Văn   Bình  ")).toBe("Bình");
		expect(shortName("A".repeat(25))).toBe("A".repeat(20));
		expect(shortName("")).toBeNull();
		expect(shortName(null)).toBeNull();
		expect(shortName(undefined)).toBeNull();
	});
});

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: ORDER,
		order_no: 42,
		display_no: "#042",
		business_date: "2026-11-28",
		source: "counter",
		type: "takeaway",
		table: null,
		pickup_at: null,
		status: "accepted",
		payment_status: "paid",
		payment_method: "cash",
		version: 2,
		subtotal: 0,
		discount_amount: 0,
		total: 0,
		note: null,
		placed_at: "2026-11-28T03:00:00Z",
		accepted_at: "2026-11-28T03:00:00Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: null,
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		member_attached: false,
		...overrides,
	};
}

describe("Gắn thẻ thành viên is offered (decision table)", () => {
	const now = Date.parse("2026-11-28T04:00:00Z");
	const completedAgo = (ms: number) =>
		order({
			status: "completed",
			completed_at: new Date(now - ms).toISOString(),
		});
	const rows: readonly [string, Order, boolean][] = [
		["a counter order, accepted", order(), true],
		["a counter order, unpaid", order({ payment_status: "unpaid" }), true],
		[
			"the counter's other source name",
			order({ source: "native-counter" }),
			true,
		],
		["an app order", order({ source: "app" }), false],
		["already attached", order({ member_attached: true }), false],
		["cancelled", order({ status: "cancelled" }), false],
		["refund pending", order({ payment_status: "refund_pending" }), false],
		["refunded", order({ payment_status: "refunded" }), false],
		[
			"partially refunded",
			order({ payment_status: "partially_refunded" }),
			false,
		],
		["completed 29 minutes ago", completedAgo(29 * 60_000), true],
		[
			"completed exactly 30 minutes ago",
			completedAgo(ATTACH_AFTER_COMPLETION_MS),
			true,
		],
		[
			"completed 30 minutes and 1 second ago",
			completedAgo(ATTACH_AFTER_COMPLETION_MS + 1000),
			false,
		],
		["completed without a time", order({ status: "completed" }), false],
	];
	it.each(rows)("%s", (_name, given, offered) => {
		expect(attachable(given, now)).toBe(offered);
	});
});

describe("the drinks that earn", () => {
	it("count only the lines that earn stamps, by quantity", () => {
		const line = (quantity: number, counts: boolean) => ({
			line_no: 1,
			item_id: "i",
			size_id: "s",
			item_name: "x",
			size_label: null,
			quantity,
			unit_price: 0,
			options: [],
			options_amount: 0,
			line_total: 0,
			counts_for_stamps: counts,
			note: null,
		});
		expect(stampUnits({ lines: [] })).toBe(0);
		expect(
			stampUnits({ lines: [line(2, true), line(1, false), line(1, true)] }),
		).toBe(3);
	});
});
