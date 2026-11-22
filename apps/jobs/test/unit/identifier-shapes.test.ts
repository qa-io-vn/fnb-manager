import { describe, expect, it } from "vitest";
import {
	expectNoIdentifiers,
	INTERNATIONAL_PHONES,
	identifierFindings,
	intl,
	kindsInLine,
	PATH_SEGMENT,
	PHONES,
	POOL_CODES,
	ZALO_USER_ID,
} from "../support/identifiers.js";

// G-24 positive controls. A test that asserts "no identifier in the output" proves
// nothing unless the detector it uses does find one. Techniques: equivalence
// partitioning of each shape (solid, separated, international, case) and boundary
// value analysis of each length (a segment of 42, 43 and 44 characters; a phone of
// 9, 10 and 11 digits after the zero; a Zalo id of 14 and 15 digits).

const run = (length: number, alphabet = "aB3_-") =>
	Array.from({ length }, (_, index) => alphabet[index % alphabet.length]).join(
		"",
	);

describe("the identifier shapes the output tests look for", () => {
	it("finds each synthetic phone in its local, international and separated forms", () => {
		for (const phone of [...PHONES, ...INTERNATIONAL_PHONES]) {
			expect(kindsInLine(`phone ${phone} read`), phone).toContain("phone");
		}
		const [first = ""] = PHONES;
		const spaced = `${first.slice(0, 4)} ${first.slice(4, 7)} ${first.slice(7)}`;
		const dotted = `${first.slice(0, 4)}.${first.slice(4, 7)}.${first.slice(7)}`;
		const dashed = `${first.slice(0, 3)}-${first.slice(3, 6)}-${first.slice(6)}`;
		const international = intl(first.slice(1));
		const bracketed = `${intl("")}(${first.slice(1, 4)})${first.slice(4)}`;
		for (const written of [spaced, dotted, dashed, international, bracketed]) {
			expect(kindsInLine(`phone ${written} read`), written).toContain("phone");
		}
	});

	it("takes a phone at 9 to 10 digits after the zero and nothing shorter or longer", () => {
		const zeroAnd = (digits: number) => `0${"7".repeat(digits)}`;
		expect(kindsInLine(zeroAnd(8))).not.toContain("phone");
		expect(kindsInLine(zeroAnd(9))).toContain("phone");
		expect(kindsInLine(zeroAnd(10))).toContain("phone");
		expect(kindsInLine(zeroAnd(11))).not.toContain("phone");
		expect(kindsInLine(`${intl("7".repeat(8))}`)).not.toContain("phone");
		expect(kindsInLine(`${intl("7".repeat(9))}`)).toContain("phone");
	});

	it("finds the pool codes whatever their case, and a code shaped letters then digits that is not in the fixture", () => {
		for (const code of POOL_CODES) {
			expect(kindsInLine(code)).toContain("pool code");
			expect(kindsInLine(code.toLowerCase())).toContain("pool code");
			expect(kindsInLine(code.toUpperCase())).toContain("pool code");
		}
		expect(kindsInLine("code ABC-123456 assigned")).toContain("pool code");
		expect(kindsInLine("code Q7W2E9R4T6 assigned")).not.toContain("pool code");
	});

	it("finds a segment of 43 characters and longer, and not 42 or a line of dashes", () => {
		expect(kindsInLine(`/${PATH_SEGMENT}`)).toContain("path segment");
		expect(PATH_SEGMENT).toHaveLength(43);
		expect(kindsInLine(run(42))).not.toContain("path segment");
		expect(kindsInLine(run(43))).toContain("path segment");
		expect(kindsInLine(run(44))).toContain("path segment");
		expect(kindsInLine(run(43, "-"))).not.toContain("path segment");
		expect(kindsInLine(run(60, "_"))).not.toContain("path segment");
		expect(kindsInLine(`a ${run(21)} ${run(21)} b`)).not.toContain(
			"path segment",
		);
	});

	it("finds a Zalo user id of 15 digits or more, not a millisecond timestamp", () => {
		expect(kindsInLine(`user ${ZALO_USER_ID}`)).toContain("Zalo user id");
		expect(ZALO_USER_ID).toHaveLength(19);
		expect(kindsInLine(`user ${"4".repeat(15)}`)).toContain("Zalo user id");
		expect(kindsInLine(`user ${"4".repeat(14)}`)).not.toContain("Zalo user id");
		expect(kindsInLine("at 1763700000000 ms")).toEqual([]);
	});

	it("takes each fixture for one kind only: an id is not a phone, a phone not an id, a segment's digits not a phone", () => {
		expect(kindsInLine(`user ${ZALO_USER_ID}`)).toEqual(["Zalo user id"]);
		expect(kindsInLine(`phone ${PHONES[1]}`)).toEqual(["phone"]);
		expect(kindsInLine(`/${PATH_SEGMENT}`)).toEqual(["path segment"]);
		for (const code of POOL_CODES) {
			expect(kindsInLine(`code ${code}`), code).toEqual(["pool code"]);
		}
	});

	it("lets the counts, dates and labels of a clean report through", () => {
		for (const line of [
			"tenant 1: loyalty: reconciled, a_earned 1, c_matched 0",
			"tenant 2: nightly clawbacks 2, expired_points 0, expired_stamps 3, liability_rows 1",
			"brand 1: 4 button(s), 3 change(s) (last applied 2026-11-18T03:00:00.000Z)",
			"  2. ~ Mini App link becomes Mini App link",
			"loyalty nightly: no tenant has an active or paused programme",
			"menu applied (0a1b2c3d4e5f)",
			"-------------------------------------------------------------",
			"",
		]) {
			expect(kindsInLine(line), line).toEqual([]);
		}
	});

	it("names the stream, the line and the kind of a finding, and never the value", () => {
		const text = `clean\nuser ${ZALO_USER_ID} and phone ${PHONES[0]}\n`;
		const findings = identifierFindings("stderr", text);
		expect(findings).toEqual([
			"stderr line 2: phone",
			"stderr line 2: Zalo user id",
		]);
		expect(findings.join("\n")).not.toContain(ZALO_USER_ID);
		expect(() =>
			expectNoIdentifiers({ stdout: "fine\n", stderr: text }),
		).toThrow();
		expect(() =>
			expectNoIdentifiers({ stdout: "fine\n", stderr: "also fine\n" }),
		).not.toThrow();
	});
});
