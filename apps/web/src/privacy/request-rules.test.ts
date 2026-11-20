import { describe, expect, it } from "vitest";
import {
	CONTACT_MAX,
	checkName,
	checkRequest,
	NAME_MAX,
	NOTES_MAX,
	type RequestDraft,
} from "./request-rules";

const VALID: RequestDraft = {
	requestType: "access",
	contact: "khach@example.com",
	usesProcessor: false,
	notes: "",
	subjectId: null,
};

describe("recording a request", () => {
	it("accepts a valid draft and trims it (valid partition)", () => {
		expect(
			checkRequest({ ...VALID, contact: "  khach@example.com ", notes: " x " }),
		).toEqual({
			issues: [],
			value: {
				requestType: "access",
				subjectId: null,
				contact: "khach@example.com",
				usesProcessor: false,
				notes: "x",
			},
		});
	});

	it("turns empty notes into null", () => {
		expect(checkRequest({ ...VALID, notes: "   " }).value?.notes).toBeNull();
	});

	it("accepts every request type of the database and no other (equivalence)", () => {
		for (const type of [
			"access",
			"correction",
			"deletion",
			"export",
			"objection",
			"withdraw_consent",
		]) {
			expect(checkRequest({ ...VALID, requestType: type }).issues).toEqual([]);
		}
		for (const type of ["", "delete", "ACCESS", "access; drop table x"]) {
			expect(checkRequest({ ...VALID, requestType: type }).issues).toEqual([
				"type",
			]);
		}
	});

	it("refuses an empty or blank contact (boundary 0 and whitespace)", () => {
		expect(checkRequest({ ...VALID, contact: "" }).issues).toEqual([
			"contactEmpty",
		]);
		expect(checkRequest({ ...VALID, contact: "   " }).issues).toEqual([
			"contactEmpty",
		]);
	});

	it("accepts a contact of exactly the maximum and refuses one more (boundary)", () => {
		expect(
			checkRequest({ ...VALID, contact: "a".repeat(CONTACT_MAX) }).issues,
		).toEqual([]);
		expect(
			checkRequest({ ...VALID, contact: "a".repeat(CONTACT_MAX + 1) }).issues,
		).toEqual(["contactTooLong"]);
	});

	it("does the same for the notes (boundary)", () => {
		expect(
			checkRequest({ ...VALID, notes: "n".repeat(NOTES_MAX) }).issues,
		).toEqual([]);
		expect(
			checkRequest({ ...VALID, notes: "n".repeat(NOTES_MAX + 1) }).issues,
		).toEqual(["notesTooLong"]);
	});

	it("refuses control characters in the contact (input abuse)", () => {
		expect(checkRequest({ ...VALID, contact: "a\u0000b" }).issues).toContain(
			"control",
		);
		expect(checkRequest({ ...VALID, contact: "a\nb" }).issues).toContain(
			"control",
		);
	});

	it("reports every issue at once and gives no value", () => {
		const check = checkRequest({
			...VALID,
			requestType: "x",
			contact: "",
			notes: "n".repeat(NOTES_MAX + 1),
		});
		expect(check.issues).toEqual(["type", "contactEmpty", "notesTooLong"]);
		expect(check.value).toBeNull();
	});

	it("keeps the linked customer", () => {
		expect(checkRequest({ ...VALID, subjectId: "c1" }).value?.subjectId).toBe(
			"c1",
		);
	});
});

describe("the corrected name", () => {
	it("accepts names of 1 to 120 characters", () => {
		expect(checkName("A")).toBeNull();
		expect(checkName("Nguyễn Văn A")).toBeNull();
		expect(checkName("a".repeat(NAME_MAX))).toBeNull();
	});

	it("refuses an empty, blank, too long or control-character name", () => {
		expect(checkName("")).toBe("empty");
		expect(checkName("   ")).toBe("empty");
		expect(checkName("a".repeat(NAME_MAX + 1))).toBe("tooLong");
		expect(checkName("a\tb")).toBe("control");
	});
});
