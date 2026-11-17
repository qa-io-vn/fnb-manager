import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/pack/canonical.js";
import {
	fixedClock,
	generatedAt,
	type PackClock,
} from "../../src/pack/clock.js";
import { DataPackError } from "../../src/pack/errors.js";
import { packIdOf, packIdText, sha256Hex } from "../../src/pack/hash.js";
import { sealPack } from "../../src/pack/seal.js";
import { draftPack, reorderKeys } from "./format-fixtures.js";

function nodeSha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("sha256Hex", () => {
	it("gives the published digests", async () => {
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("hashes the UTF-8 bytes, equal to an independent implementation", async () => {
		const texts = [
			"Trà sữa trân châu",
			"Trè sữa",
			"\u{1f600} ｡  ",
			canonicalJson(draftPack()),
			"x".repeat(1_000_003),
		];
		for (const text of texts) {
			expect(await sha256Hex(text)).toBe(nodeSha256(text));
		}
	});
});

describe("pack_id", () => {
	it("hashes the canonical text with pack_id and generated_at blanked", async () => {
		const pack = draftPack();
		const text = packIdText(pack);
		expect(text).toContain('"generated_at":""');
		expect(text).toContain('"pack_id":""');
		expect(text).not.toContain(pack.generated_at);
		expect(await packIdOf(pack)).toBe(nodeSha256(text));
	});

	it("is pinned for the fixture pack", async () => {
		expect(await packIdOf(draftPack())).toBe(
			"2f2877cdd80ae50eaa87b07a5844b209d5de3bacc391d103a3ad16500e963d78",
		);
	});

	it("ignores generated_at, pack_id and key order, and follows every other byte", async () => {
		const pack = draftPack();
		const id = await packIdOf(pack);
		expect(
			await packIdOf({
				...pack,
				generated_at: "2030-01-01T00:00:00Z",
				pack_id: "f".repeat(64),
			}),
		).toBe(id);
		expect(await packIdOf(reorderKeys(pack) as typeof pack)).toBe(id);
		expect(
			await packIdOf({
				...pack,
				budget: { ...pack.budget, estimated_tokens: 1 },
			}),
		).not.toBe(id);
		expect(
			await packIdOf({
				...pack,
				request: { ...pack.request, focus: "Tăng giá trị hóa đơn buổi tối" },
			}),
		).not.toBe(id);
	});
});

describe("the clock", () => {
	it("writes generated_at in UTC to the second, truncating milliseconds", () => {
		expect(generatedAt(fixedClock("2026-11-12T03:00:00.987Z"))).toBe(
			"2026-11-12T03:00:00Z",
		);
		expect(generatedAt(fixedClock("2026-11-12T10:00:59+07:00"))).toBe(
			"2026-11-12T03:00:59Z",
		);
	});

	it("reads the injected clock once", () => {
		let reads = 0;
		const clock: PackClock = {
			now: () => {
				reads += 1;
				return fixedClock("2026-11-12T03:00:00Z").now();
			},
		};
		generatedAt(clock);
		expect(reads).toBe(1);
	});

	it("takes only an ISO instant with Z or an offset, so no process time zone enters", () => {
		for (const instant of [
			"2026-11-12T03:00:00Z",
			"2026-11-12T03:00:00.987Z",
			"2026-11-12T10:00:00+07:00",
			"2026-11-11T19:00:00-08:00",
		]) {
			expect(generatedAt(fixedClock(instant)), instant).toBe(
				"2026-11-12T03:00:00Z",
			);
		}
		for (const instant of [
			"2026-11-12T03:00:00",
			"2026-11-12",
			"2026-11-12 03:00:00Z",
			"Nov 12 2026 03:00:00 GMT",
			"2026-02-30T03:00:00Z",
			"2026-11-12T24:00:00Z",
			"2026-11-12T03:00:00.5Z",
			"+002026-11-12T03:00:00Z",
			"2026-11-12T03:00:00+0700",
		]) {
			expect(() => fixedClock(instant), instant).toThrow(DataPackError);
		}
	});

	it("refuses a time that cannot be written", () => {
		expect(() => fixedClock("not a time")).toThrow(DataPackError);
		expect(() =>
			generatedAt({ now: () => fixedClock("1970-01-01T00:00:00Z").now() }),
		).not.toThrow();
		const invalid = { now: () => new Date(Number.NaN) };
		expect(() => generatedAt(invalid)).toThrow(/^pack_invalid: /);
		const farFuture = { now: () => new Date(8.64e15) };
		expect(() => generatedAt(farFuture)).toThrow(/^pack_invalid: /);
	});
});

describe("sealPack", () => {
	it("sets the estimate and the pack_id and writes the canonical text, reading no clock", async () => {
		const draft = draftPack();
		const sealed = await sealPack(draft);
		expect(sealed.pack.generated_at).toBe(draft.generated_at);
		expect(sealed.packId).toBe(
			await packIdOf({ ...draft, budget: sealed.pack.budget }),
		);
		expect(sealed.pack.pack_id).toBe(sealed.packId);
		expect(sealed.text).toBe(canonicalJson(sealed.pack));
		expect(sealed.estimatedTokens).toBe(sealed.pack.budget.estimated_tokens);
		expect(sealed.pack.budget.trimmed).toEqual([]);
		expect(await sealPack(draft)).toEqual(sealed);
	});

	it("gives packs that differ only in generated_at the same pack_id", async () => {
		const one = await sealPack(draftPack());
		const two = await sealPack({
			...draftPack(),
			generated_at: "2026-11-12T09:30:00Z",
		});
		expect(two.packId).toBe(one.packId);
		expect(two.text).not.toBe(one.text);
		expect(
			two.text.replace("2026-11-12T09:30:00Z", one.pack.generated_at),
		).toBe(one.text);
	});
});
