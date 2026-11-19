export const STAFF_CONTACT_MAX = 500;

export type StaffContactIssue = "tooLong" | "control" | "link";

const ENDS = /^[ \n\t]+|[ \n\t]+$/g;
const CONTROL = /\p{Cc}/u;
const ALNUM = "\\p{L}\\p{N}";
const LINK_PATTERNS: readonly RegExp[] = [
	/[a-z][a-z0-9+.-]*:\/\//iu,
	new RegExp(`(^|[^${ALNUM}_.-])www\\.[${ALNUM}-]`, "iu"),
	new RegExp(`[${ALNUM}-]\\.[a-z]{2,}/`, "u"),
	new RegExp(
		`(^|[^@${ALNUM}_.-])[${ALNUM}-]+(\\.[${ALNUM}-]+)*\\.(com|net|org|vn|me|io|co|info|biz|app|dev|link|page|site|online|shop|store)(?![${ALNUM}_])`,
		"iu",
	),
];

export function normalisedContact(text: string): string | null {
	const normalised = text
		.normalize("NFC")
		.replace(/\r\n?/g, "\n")
		.replace(ENDS, "");
	return normalised === "" ? null : normalised;
}

export function textHoldsLink(text: string): boolean {
	return LINK_PATTERNS.some((pattern) => pattern.test(text));
}

export function contactLength(text: string | null): number {
	return text === null ? 0 : [...text].length;
}

export function staffContactIssue(text: string): StaffContactIssue | null {
	const normalised = normalisedContact(text);
	if (normalised === null) return null;
	if (contactLength(normalised) > STAFF_CONTACT_MAX) return "tooLong";
	if (CONTROL.test(normalised.replace(/[\n\t]/g, ""))) return "control";
	if (textHoldsLink(normalised)) return "link";
	return null;
}
