import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	encodeQr,
	QR_QUIET_ZONE,
	QrCapacityError,
	type QrCode,
	qrPathOf,
} from "./qr-code";

const LINK = "https://zalo.me/s/mock-staff-app/?store=CH1";

function digestOf(code: QrCode): string {
	const rows = code.modules.map((row) =>
		row.map((dark) => (dark ? "1" : "0")).join(""),
	);
	return createHash("sha256")
		.update(rows.join("\n"))
		.digest("hex")
		.slice(0, 24);
}

const LINK_DIGESTS = [
	"4fc393fc462a456cc229a368",
	"2a09540d9611ac28783ec655",
	"37c7cbaf631ed74653916410",
	"b4f685976ef1e1a2e150e750",
	"bf8ee53a731a4b28c6cbce54",
	"f05d869578aa8639ebe9b2cf",
	"b96b2db5667bca23fcac7f5d",
	"fbca0f9fca1880a1e67714f6",
] as const;

describe("encodeQr", () => {
	it.each(LINK_DIGESTS.map((digest, mask) => [mask, digest] as const))(
		"draws a staff app link with mask %i module for module as the reference encoder does",
		(mask, digest) => {
			const code = encodeQr(LINK, { mask });
			expect(code.version).toBe(4);
			expect(code.size).toBe(33);
			expect(code.mask).toBe(mask);
			expect(digestOf(code)).toBe(digest);
		},
	);

	it.each([
		["a", 5, 1, "e8ab680854e4019c4ac89bd0"],
		["Nhân viên 1", 2, 1, "053a2c1929409b7105edfdaa"],
		["x".repeat(150), 6, 8, "75fb25cabde9039f5b030f40"],
		["y".repeat(300), 3, 13, "cc741856f930c447a6e16df4"],
		["q".repeat(1500), 4, 32, "425b7363a57f841332396596"],
		["w".repeat(2331), 7, 40, "07bb8a5f26c8d559f4c25062"],
	] as const)(
		"encodes %j with mask %i in version %i as the reference encoder does",
		(text, mask, version, digest) => {
			const code = encodeQr(text, { mask });
			expect(code.version).toBe(version);
			expect(code.size).toBe(version * 4 + 17);
			expect(digestOf(code)).toBe(digest);
		},
	);

	it("picks a mask by itself and keeps the finder patterns in the three corners", () => {
		const code = encodeQr(LINK);
		expect(code.mask).toBeGreaterThanOrEqual(0);
		expect(code.mask).toBeLessThan(8);
		const corner = (x: number, y: number) =>
			[0, 1, 2, 3, 4, 5, 6].map((dy) =>
				[0, 1, 2, 3, 4, 5, 6]
					.map((dx) => (code.modules[y + dy]?.[x + dx] ? "1" : "0"))
					.join(""),
			);
		const finder = [
			"1111111",
			"1000001",
			"1011101",
			"1011101",
			"1011101",
			"1000001",
			"1111111",
		];
		expect(corner(0, 0)).toEqual(finder);
		expect(corner(code.size - 7, 0)).toEqual(finder);
		expect(corner(0, code.size - 7)).toEqual(finder);
	});

	it("refuses a text longer than the largest code holds", () => {
		expect(() => encodeQr("w".repeat(2332))).toThrow(QrCapacityError);
	});
});

describe("qrPathOf", () => {
	it("draws one rectangle per run of dark modules, inside the quiet zone", () => {
		const code: QrCode = {
			version: 1,
			size: 3,
			mask: 0,
			modules: [
				[true, true, false],
				[false, false, false],
				[true, false, true],
			],
		};
		const q = QR_QUIET_ZONE;
		expect(qrPathOf(code)).toBe(
			`M${q} ${q}h2v1h-2zM${q} ${q + 2}h1v1h-1zM${q + 2} ${q + 2}h1v1h-1z`,
		);
	});
});
