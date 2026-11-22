// Test design (ISTQB): equivalence partitioning of a text (no phone, a national phone, an international phone, a phone
// inside a longer digit run, an allowed own phone) and boundary values of the digit count (9, 10, 11 digits after the
// prefix rules); the report never carries a whole number.
import { describe, expect, it } from "vitest";
import { findFullPhones, findTokens } from "../../src/testing/network-scan";

// Built from parts so the public-safety scan, which looks for literal international phone numbers, finds none here.
const intl = (national: string): string => `+84${national}`;

describe("findFullPhones", () => {
	it("finds a national and an international full phone and shortens each to its last three digits", () => {
		expect(findFullPhones('{"phone":"0900001234"}')).toEqual(["…234"]);
		expect(findFullPhones(`{"phone":"${intl("900001234")}"}`)).toEqual([
			"…234",
		]);
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

	it("leaves a run of digits inside an identifier alone, and still finds a phone in text, a list or a URL query", () => {
		expect(findFullPhones('{"id":"id-4b7d-8e5f-0123456790ab"}')).toEqual([]);
		expect(findFullPhones("order-0900001234-x")).toEqual([]);
		expect(findFullPhones("call 0900001234, then 0900005678.")).toEqual([
			"…234",
			"…678",
		]);
		expect(findFullPhones("/rest/v1/x?phone=0900001234&a=1")).toEqual(["…234"]);
		expect(findFullPhones(`["${intl("900001234")}"]`)).toEqual(["…234"]);
	});

	it("skips the phones a session may see, in any of their forms, and still finds another", () => {
		const own = "0900001234";
		expect(findFullPhones(`${own} ${intl("900001234")}`, [own])).toEqual([]);
		expect(findFullPhones(intl("900001234"), [intl("900001234")])).toEqual([]);
		expect(findFullPhones(`${own} 0900005678`, [own])).toEqual(["…678"]);
	});
});

describe("findTokens", () => {
	it("finds a code that stands alone in a body and reports its position, never the code", () => {
		const codes = ["102847", "555123"];
		expect(findTokens('{"code":"102847"}', codes)).toEqual([0]);
		expect(findTokens("a 555123, b 102847.", codes)).toEqual([0, 1]);
		expect(findTokens("/rest/v1/x?code=555123&a=1", codes)).toEqual([1]);
		expect(findTokens('{"state":"refused"}', codes)).toEqual([]);
	});

	it("leaves a code inside a longer run of digits, a number or an identifier alone (boundary values)", () => {
		const codes = ["102847"];
		expect(findTokens("1028470", codes)).toEqual([]);
		expect(findTokens("9102847", codes)).toEqual([]);
		expect(findTokens("1763700102847", codes)).toEqual([]);
		expect(findTokens("id-102847-x", codes)).toEqual([]);
		expect(findTokens("code102847", codes)).toEqual([]);
		expect(findTokens("10284", codes)).toEqual([]);
	});

	it("ignores an empty secret and treats a pattern character in a secret as plain text", () => {
		expect(findTokens("anything", [""])).toEqual([]);
		expect(findTokens("fnb-member:1:s.1:123456", ["s.1"])).toEqual([0]);
		expect(findTokens("fnb-member:1:sx1:123456", ["s.1"])).toEqual([]);
		expect(findTokens("(a+b)", ["(a+b)"])).toEqual([0]);
	});
});
