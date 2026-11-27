import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	constantTimeEqual,
	hmacHex,
	hmacSha256Hex,
	sha256Hex,
	signatureEqual,
} from "../../src/index.js";

// payments:unit/crypto: the keyed hashes against published vectors (RFC 4231 test case 2) and against Node's own
// implementation as an oracle; equivalence classes of the constant-time comparisons.

describe("hmacHex", () => {
	it("matches RFC 4231 test case 2 for SHA-256 and SHA-512", async () => {
		expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
			"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
		);
		expect(
			await hmacHex("SHA-512", "Jefe", "what do ya want for nothing?"),
		).toBe(
			"164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
		);
	});

	it("agrees with node:crypto on Vietnamese text and an empty message", async () => {
		for (const data of [
			"",
			"Đơn trực tuyến · Cửa hàng mẫu",
			"amount=35000&desc=x",
		]) {
			expect(await hmacSha256Hex("synthetic-key", data)).toBe(
				createHmac("sha256", "synthetic-key")
					.update(data, "utf8")
					.digest("hex"),
			);
		}
	});

	it("refuses a blank key, which would sign anything", async () => {
		await expect(hmacSha256Hex("", "data")).rejects.toThrow(/needs a key/);
	});

	it("hashes SHA-256 as hex", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});

describe("constantTimeEqual and signatureEqual", () => {
	it("equal texts are equal; a different character, length or empty text is not", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(false);
		expect(constantTimeEqual("Key", "key")).toBe(false);
	});

	it("compares hex signatures whatever the case, and refuses anything that is not hex", () => {
		expect(signatureEqual("ab01", "AB01")).toBe(true);
		expect(signatureEqual("ab01", "ab02")).toBe(false);
		expect(signatureEqual("ab01", "")).toBe(false);
		expect(signatureEqual("ab01", "ab0z")).toBe(false);
	});
});
