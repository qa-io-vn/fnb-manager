import { personalTextRules } from "./aggregates.js";
import { DataPackError } from "./errors.js";

const WHITESPACE_RUN = /\s+/gu;

export function normalizeRequestText(
	value: string | null,
	field: string,
	maxLength: number,
): string | null {
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new DataPackError("pack_invalid", `${field} is not text`);
	}
	const text = value.normalize("NFC").replace(WHITESPACE_RUN, " ").trim();
	if (text === "") return null;
	const length = [...text].length;
	if (length > maxLength) {
		throw new DataPackError(
			"pack_text_too_long",
			`${field} has ${length} characters, at most ${maxLength}`,
		);
	}
	const rules = personalTextRules(text);
	if (rules.length > 0) {
		throw new DataPackError(
			"pack_text_contact_details",
			`${field} looks like it holds contact details (${rules.join(", ")})`,
		);
	}
	return text;
}
