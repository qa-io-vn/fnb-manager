import { stripNul } from "../json.js";

export function text(value: string): string {
	return stripNul(value);
}

export function textOrNull(value: string | undefined | null): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	const cleaned = stripNul(value);
	return cleaned.trim() === "" ? null : cleaned;
}

export function isoOrNull(value: Date | undefined): string | null {
	return value === undefined ? null : value.toISOString();
}
