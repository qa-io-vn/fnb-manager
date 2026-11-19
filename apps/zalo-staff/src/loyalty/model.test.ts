import { describe, expect, it } from "vitest";
import {
	amountProblem,
	canManageQueue,
	canUseTill,
	entryDigits,
	isoDayIn,
	maskPhone,
	nationalPhone,
	needsManager,
	readAdjustment,
	readEntry,
	readScannedMember,
	readScannedRedemption,
	reasonProblem,
	redemptionCode,
	shownPhone,
	signed,
} from "./model";

const COUNTRY = "+84";

describe("the Vietnamese mobile-number check", () => {
	it("takes the national form of every mobile prefix", () => {
		for (const phone of [
			"0321234567",
			"0391234567",
			"0521234567",
			"0551234567",
			"0591234567",
			"0701234567",
			"0761234567",
			"0791234567",
			"0811234567",
			"0891234567",
			"0900001234",
			"0991234567",
		])
			expect(nationalPhone(phone)).toBe(phone);
	});

	it("reads the country forms and separators back to the national form", () => {
		expect(nationalPhone(`${COUNTRY}900001234`)).toBe("0900001234");
		expect(nationalPhone(`0084${"900001234"}`)).toBe("0900001234");
		expect(nationalPhone(`84${"900001234"}`)).toBe("0900001234");
		expect(nationalPhone("090 000-1234")).toBe("0900001234");
		expect(nationalPhone("(090) 000.1234")).toBe("0900001234");
	});

	it("refuses landlines, old 11-digit numbers, unknown prefixes and short numbers", () => {
		for (const phone of [
			"0241234567",
			"01234567890",
			"0123456789",
			"0301234567",
			"0511234567",
			"0711234567",
			"0801234567",
			"090000123",
			"09000012345",
			"",
		])
			expect(nationalPhone(phone)).toBeNull();
	});
});

describe("masking", () => {
	it("keeps only the last three digits of a phone", () => {
		expect(maskPhone("0900001234")).toBe("•••• ••• 234");
		expect(maskPhone(`${COUNTRY}900005678`)).toBe("•••• ••• 678");
		expect(maskPhone("12")).toBe("•••");
	});

	it("masks a full phone that reaches a screen, and leaves a masked one alone", () => {
		expect(shownPhone("0900001234")).toBe("•••• ••• 234");
		expect(shownPhone("•••• ••• 234")).toBe("•••• ••• 234");
		expect(shownPhone("09•• ••• 234")).toBe("•••• ••• 234");
		expect(shownPhone("0900 001 234")).toBe("•••• ••• 234");
	});
});

describe("the check-in entry", () => {
	it("keeps digits only, at most 11", () => {
		expect(entryDigits("09a0-0 001234 99")).toBe("09000012349");
	});

	it("reads 6 digits as a member code and a mobile number as a phone", () => {
		expect(readEntry("246810")).toEqual({
			ok: true,
			entry: { kind: "code", code: "246810", payload: null },
		});
		expect(readEntry("012345")).toEqual({
			ok: true,
			entry: { kind: "code", code: "012345", payload: null },
		});
		expect(readEntry(" 0900001234 ")).toEqual({
			ok: true,
			entry: { kind: "phone", phone: "0900001234" },
		});
		expect(readEntry("84900001234")).toEqual({
			ok: true,
			entry: { kind: "phone", phone: "0900001234" },
		});
	});

	it("says what is wrong with anything else", () => {
		expect(readEntry("  ")).toEqual({ ok: false, problem: "empty" });
		expect(readEntry("0241234567")).toEqual({ ok: false, problem: "phone" });
		expect(readEntry("09000")).toEqual({ ok: false, problem: "phone" });
		expect(readEntry("12345")).toEqual({ ok: false, problem: "format" });
		expect(readEntry("1234567")).toEqual({ ok: false, problem: "format" });
	});
});

describe("scanned codes", () => {
	it("reads a member QR payload or bare digits, and nothing else", () => {
		expect(readScannedMember("fnb-member:1:q1:246810")).toEqual({
			ok: true,
			code: "246810",
			payload: "fnb-member:1:q1:246810",
		});
		expect(readScannedMember("fnb-member:2:store-7:135790:c2lnbmVk")).toEqual({
			ok: true,
			code: "135790",
			payload: "fnb-member:2:store-7:135790:c2lnbmVk",
		});
		expect(readScannedMember(" 246810 ")).toEqual({
			ok: true,
			code: "246810",
			payload: null,
		});
		for (const content of [
			"fnb-member:1:q1:24681",
			"fnb-redeem:1:UD2468",
			"https://example.com/246810",
			"2468100",
		])
			expect(readScannedMember(content)).toEqual({ ok: false });
	});

	it("reads a reward payload or a bare code, never a member payload", () => {
		expect(readScannedRedemption("fnb-redeem:1:UD2468")).toEqual({
			ok: true,
			code: "UD2468",
			payload: "fnb-redeem:1:UD2468",
		});
		expect(readScannedRedemption("VC8F3K2Q")).toMatchObject({
			ok: true,
			code: "VC8F3K2Q",
		});
		expect(readScannedRedemption("fnb-member:1:q1:246810")).toEqual({
			ok: false,
		});
		expect(readScannedRedemption("two words")).toEqual({ ok: false });
	});

	it("takes a typed reward code without spaces, up to 64 characters", () => {
		expect(redemptionCode(" UD2468 ")).toBe("UD2468");
		expect(redemptionCode("UD 2468")).toBeNull();
		expect(redemptionCode("")).toBeNull();
		expect(redemptionCode("x".repeat(64))).toBe("x".repeat(64));
		expect(redemptionCode("x".repeat(65))).toBeNull();
	});
});

describe("roles, reasons and adjustments", () => {
	it("gives the till tools to owners, managers and staff, and the queue to owners and managers", () => {
		expect(
			["owner", "manager", "staff"].map((role) => canUseTill(role as "staff")),
		).toEqual([true, true, true]);
		expect(canUseTill("viewer")).toBe(false);
		expect(canUseTill("publisher")).toBe(false);
		expect(canManageQueue("owner")).toBe(true);
		expect(canManageQueue("manager")).toBe(true);
		expect(canManageQueue("staff")).toBe(false);
	});

	it("sends a staff adjustment above the threshold to a manager, never a manager's own", () => {
		const limits = { stamps: 2, points: 20 };
		expect(needsManager("staff", 2, 20, limits)).toBe(false);
		expect(needsManager("staff", -2, 0, limits)).toBe(false);
		expect(needsManager("staff", 3, 0, limits)).toBe(true);
		expect(needsManager("staff", 0, -21, limits)).toBe(true);
		expect(needsManager("staff", 1, 0, null)).toBe(true);
		expect(needsManager("manager", 50, 500, limits)).toBe(false);
		expect(needsManager("owner", 50, 500, null)).toBe(false);
	});

	it("reads signed whole numbers and checks them", () => {
		expect(readAdjustment("")).toBe(0);
		expect(readAdjustment("+3")).toBe(3);
		expect(readAdjustment("-2")).toBe(-2);
		expect(readAdjustment("−2")).toBe(-2);
		expect(readAdjustment("1.5")).toBeNull();
		expect(readAdjustment("12345")).toBeNull();
		expect(amountProblem(null, 0, true)).toBe("number");
		expect(amountProblem(0, 0, true)).toBe("zero");
		expect(amountProblem(0, 0, false)).toBeNull();
		expect(amountProblem(1001, 0, true)).toBe("large");
		expect(amountProblem(-1, 5, true)).toBeNull();
		expect(signed(2)).toBe("+2");
		expect(signed(-2)).toBe("−2");
		expect(signed(0)).toBe("0");
	});

	it("needs a reason of at most 200 characters", () => {
		expect(reasonProblem("   ")).toBe("empty");
		expect(reasonProblem("x".repeat(201))).toBe("long");
		expect(reasonProblem(` ${"x".repeat(200)} `)).toBeNull();
	});

	it("gives the store's calendar day of an instant", () => {
		expect(isoDayIn(new Date("2026-11-18T18:30:00Z"), "Asia/Ho_Chi_Minh")).toBe(
			"2026-11-19",
		);
	});
});
