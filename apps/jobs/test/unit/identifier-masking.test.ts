import { createRedactor } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import {
	maskIdentifierShapes,
	maskingIdentifiers,
} from "../../src/identifier-shapes.js";
import { capture } from "../support/capture.js";
import {
	INTERNATIONAL_PHONES,
	intl,
	PATH_SEGMENT,
	PHONES,
	POOL_CODES,
	ZALO_USER_ID,
} from "../support/identifiers.js";

// G-24 fix (security, component): with CI set the CLI masks what a phone, a Zalo user
// id, a path segment and a code look like in everything it prints, because a
// database error can echo a refused value. Techniques: equivalence partitioning
// of each shape (solid, separated, international, in prose), boundary value
// analysis of each length (phone 9 and 10 digits after the zero, id 14 and 15
// digits, token 42 and 43 characters) and a negative set of clean lines that must
// pass through unchanged.

const run = (length: number, alphabet: string) =>
	Array.from({ length }, (_, index) => alphabet[index % alphabet.length]).join(
		"",
	);
const [first = "", second = "", third = ""] = PHONES;

describe("maskIdentifierShapes", () => {
	it("masks a phone in every form it is written, and keeps the words around it", () => {
		const spaced = `${second.slice(0, 4)} ${second.slice(4, 7)} ${second.slice(7)}`;
		const dashed = `${second.slice(0, 3)}-${second.slice(3, 6)}-${second.slice(6)}`;
		const forms = [
			first,
			second,
			third,
			spaced,
			dashed,
			...INTERNATIONAL_PHONES,
			`${intl("")} ${second.slice(1, 4)} ${second.slice(4)}`,
		];
		for (const phone of forms) {
			expect(
				maskIdentifierShapes(
					`invalid input syntax for type bigint: "${phone}"`,
				),
				phone,
			).toBe('invalid input syntax for type bigint: "***"');
		}
	});

	it("takes 9 or 10 digits after the zero for a phone, and 8 or 11 for something else", () => {
		const zeroAnd = (digits: number) => `0${"7".repeat(digits)}`;
		expect(maskIdentifierShapes(`n ${zeroAnd(8)}`)).toBe(`n ${zeroAnd(8)}`);
		expect(maskIdentifierShapes(`n ${zeroAnd(9)}`)).toBe("n ***");
		expect(maskIdentifierShapes(`n ${zeroAnd(10)}`)).toBe("n ***");
		expect(maskIdentifierShapes(`n ${zeroAnd(11)}`)).toBe(`n ${zeroAnd(11)}`);
		expect(maskIdentifierShapes(`n ${intl("7".repeat(8))}`)).toBe(
			`n ${intl("7".repeat(8))}`,
		);
		expect(maskIdentifierShapes(`n ${intl("7".repeat(9))}`)).toBe("n ***");
	});

	it("masks a numeric id of 15 digits or more, and leaves 14 digits and a millisecond timestamp", () => {
		expect(maskIdentifierShapes(`zalo user ${ZALO_USER_ID} is gone`)).toBe(
			"zalo user *** is gone",
		);
		expect(maskIdentifierShapes(`id ${"4".repeat(15)}`)).toBe("id ***");
		expect(maskIdentifierShapes(`id ${"4".repeat(14)}`)).toBe(
			`id ${"4".repeat(14)}`,
		);
		expect(maskIdentifierShapes("at 1763700000000 ms")).toBe(
			"at 1763700000000 ms",
		);
	});

	it("masks a mixed-case token of 43 characters or more and leaves 42, snake_case names and rules", () => {
		const mixed = (length: number) => run(length, "aB3_-xY9");
		expect(maskIdentifierShapes(`/voucher-callback/${PATH_SEGMENT}`)).toBe(
			"/voucher-callback/***",
		);
		expect(maskIdentifierShapes(`path ${mixed(42)}`)).toBe(`path ${mixed(42)}`);
		expect(maskIdentifierShapes(`path ${mixed(43)}`)).toBe("path ***");
		expect(maskIdentifierShapes(`path ${mixed(44)}`)).toBe("path ***");
		const snake = "coupon_codes_path_sha256_hash_per_tenant_label_idx_live";
		expect(snake.length).toBeGreaterThanOrEqual(43);
		expect(maskIdentifierShapes(`index "${snake}"`)).toBe(`index "${snake}"`);
		const noDigit = run(50, "aBc_-De");
		expect(maskIdentifierShapes(noDigit)).toBe(noDigit);
		expect(maskIdentifierShapes("-".repeat(60))).toBe("-".repeat(60));
	});

	it("masks a code of letters and digits, in either case, and leaves short digit tails", () => {
		for (const code of POOL_CODES) {
			expect(maskIdentifierShapes(`code ${code} is assigned`), code).toBe(
				"code *** is assigned",
			);
		}
		expect(maskIdentifierShapes("hash SHA-256 in UTF-8")).toBe(
			"hash SHA-256 in UTF-8",
		);
		expect(maskIdentifierShapes("retry in 1500 ms")).toBe("retry in 1500 ms");
	});

	it("leaves the counts, dates, digests and ids of a clean CI report unchanged", () => {
		for (const line of [
			"tenant 1: loyalty: reconciled, a_earned 1, c_matched 0",
			"tenant 2: nightly clawbacks 2, expired_points 0, expired_stamps 3, liability_rows 1",
			"brand 1: 4 button(s), 3 change(s) (last applied 2026-11-18T03:00:00.000Z)",
			"fast lane: store 1: succeeded in 4.2 s, 3 days checked, 0 changed, 12 sales pulled, 7 connector calls, about 120 ms CPU",
			"menu applied (0a1b2c3d4e5f)",
			"run 11111111-1111-4111-8111-111111111111 for 00000000-0000-4000-8000-000000000a01",
			"--as-of takes an ISO instant with its offset, such as 2026-12-31T23:59:59+07:00",
			"codes status: store 1 free-drink: available 12, assigned 0, used 3, quarantined 0, expired 0",
			"",
		]) {
			expect(maskIdentifierShapes(line), line).toBe(line);
		}
	});
});

describe("maskingIdentifiers", () => {
	it("applies the credential redactor first and the identifier shapes after it", () => {
		const redact = maskingIdentifiers(
			createRedactor(["synthetic-secret-value"]),
		);
		expect(
			redact(`synthetic-secret-value and ${second} and ${ZALO_USER_ID}`),
		).toBe("*** and *** and ***");
		expect(redact("password=synthetic-password-1 for 14 stores")).toBe(
			"password=*** for 14 stores",
		);
	});
});

describe("the CLI redactor", () => {
	async function fnb(argv: readonly string[], env: Record<string, string>) {
		const out = capture();
		const code = await runCli(argv, env, {
			streams: out.streams,
			loadEnvFile: false,
		});
		return { code, stdout: out.stdout(), stderr: out.stderr() };
	}

	it("masks an identifier it echoes when CI is set, in the error stream", async () => {
		const result = await fnb([ZALO_USER_ID], { CI: "1" });
		expect(result.code).toBe(2);
		expect(result.stderr).toBe('unknown command "***"; run fnb --help\n');
	});

	it("masks it for GitHub Actions as well", async () => {
		const result = await fnb([second], { GITHUB_ACTIONS: "true" });
		expect(result.stderr).toContain('unknown command "***"');
		expect(result.stderr).not.toContain(second);
	});

	it("leaves the owner's own terminal alone when CI is not set", async () => {
		const result = await fnb([ZALO_USER_ID], {});
		expect(result.stderr).toBe(
			`unknown command "${ZALO_USER_ID}"; run fnb --help\n`,
		);
	});
});
