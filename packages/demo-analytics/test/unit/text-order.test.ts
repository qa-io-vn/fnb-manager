import { describe, expect, it } from "vitest";
import { byteOrder } from "../../src/text-order.js";

describe("byteOrder", () => {
	it('orders by code point, as collate "C" orders UTF-8 bytes', () => {
		expect(byteOrder("Trà ～", "Trà 🍓")).toBe(-1);
		expect("Trà ～" < "Trà 🍓").toBe(false);
		expect(byteOrder("Z-01", "item-01")).toBe(-1);
		expect(byteOrder("abc", "abc")).toBe(0);
		expect(byteOrder("ab", "abc")).toBe(-1);
		expect(byteOrder("abc", "ab")).toBe(1);
	});
});
