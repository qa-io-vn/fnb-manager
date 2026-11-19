import { describe, expect, it } from "vitest";
import {
	formatFullPhone,
	maskPhone,
	phoneTail,
	samePhone,
	VISIBLE_PHONE_DIGITS,
} from "./mask-phone";

const COUNTRY = "+84";
const NATIONAL = "900001234";
const E164 = `${COUNTRY}${NATIONAL}`;
const LOCAL = `0${NATIONAL}`;

function digitsOf(text: string): string {
	return text.replace(/\D/g, "");
}

describe("maskPhone", () => {
	it.each([
		["E.164", E164],
		["the national form", LOCAL],
		["the country code without +", `84${NATIONAL}`],
		["spaced and dotted", "090.000 12-34"],
		["00 for +", `0084${NATIONAL}`],
	])("masks %s to the country code and the last three digits", (_form, raw) => {
		expect(maskPhone(raw)).toBe(`${COUNTRY} ••• ••• 234`);
	});

	it("never shows more than three digits of the number itself", () => {
		const masked = maskPhone(LOCAL) ?? "";
		expect(digitsOf(masked.replace(COUNTRY, ""))).toBe("234");
		expect(digitsOf(masked.replace(COUNTRY, ""))).toHaveLength(
			VISIBLE_PHONE_DIGITS,
		);
		expect(masked).not.toContain(NATIONAL);
		expect(masked).not.toContain("1234");
	});

	it("masks a foreign number without guessing its country code", () => {
		expect(maskPhone("+6591234567")).toBe("••• ••• 567");
	});

	it("gives null for a missing or too short value", () => {
		expect(maskPhone(null)).toBeNull();
		expect(maskPhone(undefined)).toBeNull();
		expect(maskPhone("")).toBeNull();
		expect(maskPhone("12345")).toBeNull();
	});

	it("still masks an unreadable value that holds enough digits", () => {
		expect(maskPhone("ext 123456789")).toBe("••• ••• 789");
	});
});

describe("formatFullPhone", () => {
	it("groups a Vietnamese mobile number for the owner's lookup", () => {
		expect(formatFullPhone(LOCAL)).toBe(`${COUNTRY} 90 000 1234`);
		expect(formatFullPhone(E164)).toBe(`${COUNTRY} 90 000 1234`);
	});

	it("leaves other E.164 numbers as they are and refuses unreadable ones", () => {
		expect(formatFullPhone("+6591234567")).toBe("+6591234567");
		expect(formatFullPhone("not a phone")).toBeNull();
		expect(formatFullPhone(null)).toBeNull();
	});
});

describe("phoneTail and samePhone", () => {
	it("gives the last four digits used to narrow a lookup, never the full number", () => {
		expect(phoneTail(LOCAL)).toBe("1234");
		expect(phoneTail(E164)).toBe("1234");
		expect(phoneTail("123")).toBeNull();
	});

	it("compares phones in E.164 form whatever form the till stored", () => {
		expect(samePhone(LOCAL, E164)).toBe(true);
		expect(samePhone(`84${NATIONAL}`, "090 000 1234")).toBe(true);
		expect(samePhone(LOCAL, "0900001235")).toBe(false);
		expect(samePhone(null, null)).toBe(false);
	});
});
