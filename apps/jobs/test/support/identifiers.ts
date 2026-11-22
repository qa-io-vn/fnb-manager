import { expect } from "vitest";

// Synthetic identifiers for the no-identifier output tests of the CLI commands
// (test-gaps G-24), and the shape detectors that look for them in what a command
// prints. Phones come from 0900000000 to 0900000999 only; the international form is
// built from parts so that the public-safety scan finds no literal number.

export const intl = (national: string): string => `+84${national}`;

/** Local-form synthetic phones: the first, a middle one and the last of the range. */
export const PHONES: readonly string[] = [
	"0900000000",
	"0900000123",
	"0900000999",
];

/** The same phones in the international form, built from parts. */
export const INTERNATIONAL_PHONES: readonly string[] = PHONES.map((phone) =>
	intl(phone.slice(1)),
);

/** Pool codes as a CRM export carries them, in two spellings. */
export const POOL_CODES: readonly string[] = ["SYN00042", "syn-00043"];

/** A callback path segment: 43 characters of the base64url alphabet. */
export const PATH_SEGMENT = "Synthetic_path-segment_0123456789abcdefghij";

/** A Zalo user id: a 19-digit number. */
export const ZALO_USER_ID = "8800000000000000042";

export type IdentifierKind =
	| "phone"
	| "pool code"
	| "path segment"
	| "Zalo user id";

// A phone: a 0, 84 or +84 prefix and 9 or 10 more digits, written solid or with
// spaces, dots, dashes or brackets between the digits, and not part of a longer
// run of digits.
const PHONE_SHAPE =
	/(?<![\w+]|\d[.,])(?:\+84|84|0)[\s.()-]{0,2}\d(?:[\s.()-]{0,2}\d){8,9}(?![\s.()-]?\d)/;
// A pool code: a few letters, an optional dash and at least four digits.
const POOL_CODE_SHAPE = /(?<![A-Za-z])[A-Za-z]{2,5}-?\d{4,}(?!\d)/;
// A path segment: a run of 43 or more characters of the base64url alphabet.
const SEGMENT_RUN = /[A-Za-z0-9_-]{43,}/g;
// A Zalo user id: a run of 15 or more digits.
const ZALO_ID_SHAPE = /(?<!\d)\d{15,}/;

function literal(text: string, needles: readonly string[]): boolean {
	const lower = text.toLowerCase();
	return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

/** What one line of output looks like, by kind; empty when it looks like nothing sensitive. */
export function kindsInLine(line: string): IdentifierKind[] {
	const kinds: IdentifierKind[] = [];
	if (
		PHONE_SHAPE.test(line) ||
		literal(line, [...PHONES, ...INTERNATIONAL_PHONES])
	) {
		kinds.push("phone");
	}
	if (POOL_CODE_SHAPE.test(line) || literal(line, POOL_CODES)) {
		kinds.push("pool code");
	}
	// A line of dashes or underscores is a rule, not a segment: it needs a letter.
	if (
		[...line.matchAll(SEGMENT_RUN)].some((run) => /[A-Za-z]/.test(run[0])) ||
		literal(line, [PATH_SEGMENT])
	) {
		kinds.push("path segment");
	}
	if (ZALO_ID_SHAPE.test(line) || literal(line, [ZALO_USER_ID])) {
		kinds.push("Zalo user id");
	}
	return kinds;
}

/**
 * The findings of one stream, as "<stream> line <n>: <kind>" and never the
 * matched text, so that a failing run does not print the value it found.
 */
export function identifierFindings(stream: string, text: string): string[] {
	return text
		.split(/\r\n|\n|\r/)
		.flatMap((line, index) =>
			kindsInLine(line).map((kind) => `${stream} line ${index + 1}: ${kind}`),
		);
}

/** Asserts that no line of stdout, stderr or the job summary matches a shape. */
export function expectNoIdentifiers(run: {
	readonly stdout: string;
	readonly stderr: string;
	readonly summary?: string;
}): void {
	const findings = [
		...identifierFindings("stdout", run.stdout),
		...identifierFindings("stderr", run.stderr),
		...identifierFindings("summary", run.summary ?? ""),
	];
	expect(findings).toEqual([]);
}

/**
 * What a database could answer with when it refuses a value it was handed: the
 * message echoes the value. One message per kind of identifier, for the error
 * guessing tests of the commands (G-24); the kind names the test.
 */
export const ECHOING_ERRORS: readonly (readonly [string, string])[] = [
	[
		"phone",
		`invalid input syntax for type bigint: "${PHONES[1]}" (customer_phones)`,
	],
	[
		"phone in international form",
		`phone ${INTERNATIONAL_PHONES[1]} is already linked to another member`,
	],
	[
		"pool code",
		`duplicate key value violates unique constraint "coupon_codes_code_key" (code)=(${POOL_CODES[0]})`,
	],
	["lower-case pool code", `code ${POOL_CODES[1]} is already assigned`],
	["path segment", `no live callback path ${PATH_SEGMENT}`],
	["Zalo user id", `zalo user ${ZALO_USER_ID} has no membership`],
];
