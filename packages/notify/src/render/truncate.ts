const ELLIPSIS = "…";

export function normalizeText(text: string): string {
	return text.normalize("NFC");
}

export function utf16Units(text: string): number {
	return normalizeText(text).length;
}

export function fitToUnits(text: string, maxUnits: number): string {
	const normalized = normalizeText(text);
	if (normalized.length <= maxUnits) {
		return normalized;
	}
	const budget = Math.max(0, maxUnits - ELLIPSIS.length);
	let cut = normalized.slice(0, budget);
	const last = cut.charCodeAt(cut.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) {
		cut = cut.slice(0, -1);
	}
	return `${cut.trimEnd()}${ELLIPSIS}`;
}

export function fitSubject(
	subject: string,
	maxCharacters: number | null,
): string {
	return maxCharacters === null
		? normalizeText(subject)
		: fitToUnits(subject, maxCharacters);
}
