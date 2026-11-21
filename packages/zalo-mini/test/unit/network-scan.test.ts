// Test design (ISTQB): equivalence partitioning of a text (no phone, a national phone, an international phone, a phone
// inside a longer digit run, an allowed own phone) and boundary values of the digit count (9, 10, 11 digits after the
// prefix rules); the report never carries a whole number.
import { describe, expect, it } from "vitest";
import { findFullPhones } from "../../src/testing/network-scan";

describe("findFullPhones", () => {
	it("finds a national and an international full phone and shortens each to its last three digits", () => {
		expect(findFullPhones('{"phone":"0900001234"}')).toEqual(["…234"]);
		expect(findFullPhones('{"phone":"+84900001234"}')).toEqual(["…234"]);
		expect(findFullPhones("84900001234 and 0900005678")).toEqual([
			"…234",
			"…678",
		]);
	});

	it("leaves a masked phone, an amount, a short run and a long run alone (boundary values)", () => {
		expect(findFullPhones("Khách •••• ••• 234")).toEqual([]);
		expect(findFullPhones("85000 and 1763700000000")).toEqual([]);
		expect(findFullPhones("090000123")).toEqual([]);
		expect(findFullPhones("09000012345")).toEqual([]);
		expect(findFullPhones("+8490000123")).toEqual([]);
	});

	it("skips the phones a session may see, in any of their forms, and still finds another", () => {
		const own = "0900001234";
		expect(findFullPhones(`${own} +84900001234`, [own])).toEqual([]);
		expect(findFullPhones("+84900001234", ["+84900001234"])).toEqual([]);
		expect(findFullPhones(`${own} 0900005678`, [own])).toEqual(["…678"]);
	});
});
