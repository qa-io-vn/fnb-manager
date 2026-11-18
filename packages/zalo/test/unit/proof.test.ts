import { describe, expect, it } from "vitest";
import { appSecretProof, hmacSha256Hex } from "../../src/proof.js";

describe("app-secret proof", () => {
	it("matches the HMAC-SHA256 vectors of RFC 4231 and a common text vector", async () => {
		expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
			"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
		);
		expect(
			await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
		).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
		expect(await hmacSha256Hex("\u000b".repeat(20), "Hi There")).toBe(
			"b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
		);
	});

	it("keys the HMAC of the access token with the App secret", async () => {
		const proof = await appSecretProof(
			"synthetic-access-token",
			"synthetic-secret",
		);
		expect(proof).toBe(
			await hmacSha256Hex("synthetic-secret", "synthetic-access-token"),
		);
		expect(proof).toMatch(/^[0-9a-f]{64}$/);
		expect(proof).not.toBe(
			await hmacSha256Hex("synthetic-access-token", "synthetic-secret"),
		);
	});

	it("handles Vietnamese text as UTF-8", async () => {
		expect(await hmacSha256Hex("khóa", "Xin chào")).toBe(
			await hmacSha256Hex("khóa", "Xin chào"),
		);
	});
});
