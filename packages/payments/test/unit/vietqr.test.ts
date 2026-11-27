import { describe, expect, it } from "vitest";
import {
	buildVietQr,
	crc16Ccitt,
	crcText,
	MAX_REFERENCE_CANDIDATES,
	parseTlv,
	parseVietQr,
	REFERENCE_ALPHABET,
	REFERENCE_PATTERN,
	referenceCandidates,
	tlv,
	VIETQR_MAX_AMOUNT,
} from "../../src/index.js";

// payments:unit/vietqr: the EMVCo CRC against its published check value, the payload's structure object by object,
// boundary values of the amount, the BIN, the account and the purpose, and equivalence classes of the transfer texts
// a bank may send back (separators kept, glued, lower-cased, with accents, other words that look alike).

const input = {
	bankBin: "970400",
	accountNumber: "0123456789",
	amount: 35_000,
	purpose: "FNB7K2M9Q4T",
};

describe("crc16Ccitt", () => {
	it("gives the CRC-16/CCITT-FALSE check value of 123456789", () => {
		expect(crc16Ccitt("123456789")).toBe(0x29b1);
		expect(crcText("123456789")).toBe("29B1");
	});

	it("is FFFF for an empty text and pads to four digits", () => {
		expect(crcText("")).toBe("FFFF");
		expect(crcText("A")).toMatch(/^[0-9A-F]{4}$/);
	});
});

describe("tlv", () => {
	it("writes the id, a two-digit length and the value", () => {
		expect(tlv("00", "01")).toBe("000201");
		expect(tlv("58", "VN")).toBe("5802VN");
	});

	it("refuses an empty value, more than 99 characters and non-ASCII", () => {
		expect(() => tlv("00", "")).toThrow();
		expect(() => tlv("00", "x".repeat(100))).toThrow();
		expect(tlv("00", "x".repeat(99))).toHaveLength(103);
		expect(() => tlv("00", "Đ")).toThrow();
		expect(() => tlv("0", "x")).toThrow();
	});
});

describe("buildVietQr", () => {
	it("writes NAPAS's objects in order and a CRC over everything before it", () => {
		const payload = buildVietQr(input);
		const objects = parseTlv(payload);
		expect(objects?.map((object) => object.id)).toEqual([
			"00",
			"01",
			"38",
			"53",
			"54",
			"58",
			"62",
			"63",
		]);
		expect(objects?.find((object) => object.id === "00")?.value).toBe("01");
		expect(objects?.find((object) => object.id === "01")?.value).toBe("12");
		expect(objects?.find((object) => object.id === "53")?.value).toBe("704");
		expect(objects?.find((object) => object.id === "54")?.value).toBe("35000");
		expect(objects?.find((object) => object.id === "58")?.value).toBe("VN");
		expect(objects?.find((object) => object.id === "62")?.value).toBe(
			"0811FNB7K2M9Q4T",
		);
		const merchant = objects?.find((object) => object.id === "38")?.value ?? "";
		// 00 the NAPAS GUID · 01 { 00 the BIN, 01 the account } · 02 transfer to an account
		expect(merchant).toBe(
			"0010A000000727" +
				"0124" +
				"0006970400" +
				"01100123456789" +
				"0208QRIBFTTA",
		);
		expect(payload.slice(-8, -4)).toBe("6304");
		expect(payload.slice(-4)).toBe(crcText(payload.slice(0, -4)));
		expect(payload.startsWith("000201010212")).toBe(true);
	});

	it("reads back what it wrote", () => {
		expect(parseVietQr(buildVietQr(input))).toEqual({
			bankBin: "970400",
			accountNumber: "0123456789",
			amount: 35_000,
			purpose: "FNB7K2M9Q4T",
			dynamic: true,
		});
	});

	it("refuses a payload whose CRC or any character changed", () => {
		const payload = buildVietQr(input);
		expect(parseVietQr(`${payload.slice(0, -4)}0000`)).toBeNull();
		expect(parseVietQr(payload.replace("35000", "35001"))).toBeNull();
		expect(parseVietQr("")).toBeNull();
	});

	it("takes amounts from 1 to the largest 13 digits, whole only", () => {
		expect(parseVietQr(buildVietQr({ ...input, amount: 1 }))?.amount).toBe(1);
		expect(
			parseVietQr(buildVietQr({ ...input, amount: VIETQR_MAX_AMOUNT }))?.amount,
		).toBe(VIETQR_MAX_AMOUNT);
		for (const amount of [0, -1, 1.5, VIETQR_MAX_AMOUNT + 1, Number.NaN]) {
			expect(() => buildVietQr({ ...input, amount })).toThrow(/amount/);
		}
	});

	it("takes a six-digit BIN, an account of 1 to 19 letters or digits and a purpose of 1 to 25", () => {
		expect(() => buildVietQr({ ...input, bankBin: "97040" })).toThrow(/BIN/);
		expect(() => buildVietQr({ ...input, bankBin: "9704000" })).toThrow(/BIN/);
		expect(() =>
			buildVietQr({ ...input, accountNumber: "1".repeat(19) }),
		).not.toThrow();
		expect(() =>
			buildVietQr({ ...input, accountNumber: "1".repeat(20) }),
		).toThrow(/account/);
		expect(() => buildVietQr({ ...input, accountNumber: "012-345" })).toThrow(
			/account/,
		);
		expect(() =>
			buildVietQr({ ...input, purpose: "X".repeat(25) }),
		).not.toThrow();
		expect(() => buildVietQr({ ...input, purpose: "X".repeat(26) })).toThrow(
			/purpose/,
		);
		expect(() => buildVietQr({ ...input, purpose: "" })).toThrow(/purpose/);
		expect(() => buildVietQr({ ...input, purpose: "Đơn 1" })).toThrow(
			/purpose/,
		);
	});
});

describe("references", () => {
	it("use an alphabet of 32 characters without 0, 1, I and O", () => {
		expect(REFERENCE_ALPHABET).toHaveLength(32);
		expect(REFERENCE_ALPHABET).not.toMatch(/[01IO]/);
		expect(REFERENCE_PATTERN.test("FNB7K2M9Q4T")).toBe(true);
		expect(REFERENCE_PATTERN.test("FNB7K2M9Q")).toBe(false);
		expect(REFERENCE_PATTERN.test("FNB7K2M9Q4O")).toBe(false);
		expect(REFERENCE_PATTERN.test("F7K2M9Q4TA")).toBe(false);
	});

	it("are found as whole words whatever the case and the separators", () => {
		expect(referenceCandidates("FNB7K2M9Q4T", "FNB")).toEqual(["FNB7K2M9Q4T"]);
		expect(referenceCandidates("ck fnb7k2m9q4t thanh toan", "FNB")).toEqual([
			"FNB7K2M9Q4T",
		]);
		expect(
			referenceCandidates("MBVCB.1234567.FNB7K2M9Q4T.CT tu 0123", "FNB"),
		).toEqual(["FNB7K2M9Q4T"]);
	});

	it("are found inside a word a bank glued to its own text", () => {
		expect(referenceCandidates("IBFT FNB7K2M9Q4TCHUYENTIEN", "FNB")).toEqual([
			"FNB7K2M9Q4T",
		]);
		expect(referenceCandidates("thanhtoanFNB7K2M9Q4T", "FNB")).toEqual([
			"FNB7K2M9Q4T",
		]);
	});

	it("are none in a transfer without one, or with another prefix", () => {
		expect(referenceCandidates("Nguyen Van A chuyen tien", "FNB")).toEqual([]);
		expect(referenceCandidates("XC7K2M9Q4T", "FNB")).toEqual([]);
		expect(referenceCandidates("FNB7K2M9Q4", "FNB")).toEqual([]);
	});

	it("are at most five, the whole words first", () => {
		const many = Array.from(
			{ length: 8 },
			(_, index) => `FNB${REFERENCE_ALPHABET.slice(index, index + 8)}`,
		).join(" ");
		const found = referenceCandidates(many, "FNB");
		expect(found).toHaveLength(MAX_REFERENCE_CANDIDATES);
		expect(found[0]).toBe("FNB23456789");
	});

	it("refuse a prefix that is not 2 to 4 capital letters", () => {
		expect(() => referenceCandidates("x", "F")).toThrow();
		expect(() => referenceCandidates("x", "fnb")).toThrow();
		expect(() => referenceCandidates("x", "FNBXY")).toThrow();
	});
});
