import type { Redactor } from "@fnb/sync";

// With CI set, every line the CLI prints ends up in a public job log and summary.
// The commands print counts and numbered names, but a database or API error can
// echo the value it refused (an invalid-input message names the phone, code or id
// it was given). This masks what such a value looks like, whatever the message
// around it says: a phone, a long numeric id (a Zalo user id), a 43-character
// path segment and a code of letters followed by digits. It cannot know a
// vendor's own code format, so the commands must still never put a code in a
// message; this is the last line of defence, not the first.

const MASK = "***";

// A phone: 0, 84 or +84 and 9 or 10 more digits, solid or with spaces, dots,
// dashes or brackets between the digits, and not part of a longer number or word.
const PHONE =
	/(?<![\w+]|\d[.,])(?:\+84|84|0)[\s.()-]{0,2}\d(?:[\s.()-]{0,2}\d){8,9}(?![\s.()-]?\d)/g;
// A numeric id of 15 digits or more, such as a Zalo user id.
const LONG_NUMBER = /(?<!\d)\d{15,}(?!\d)/g;
// A run of 43 characters or more of the base64url alphabet that mixes upper case,
// lower case and digits, as a path segment does and a snake_case name does not.
const TOKEN = /[A-Za-z0-9_-]{43,}/g;
// A code of 2 to 5 letters, an optional dash and 4 or more digits.
const CODE = /(?<![A-Za-z])[A-Za-z]{2,5}-?\d{4,}(?!\d)/g;

function maskToken(run: string): string {
	return /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run) ? MASK : run;
}

export function maskIdentifierShapes(text: string): string {
	return text
		.replace(TOKEN, maskToken)
		.replace(LONG_NUMBER, MASK)
		.replace(PHONE, MASK)
		.replace(CODE, MASK);
}

/** The redactor of a CI run: the credential redactor, then the identifier shapes. */
export function maskingIdentifiers(redact: Redactor): Redactor {
	return (text) => maskIdentifierShapes(redact(text));
}
