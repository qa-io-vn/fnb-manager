import { normalizeLoyaltyPhone } from "@fnb/core";

export const VISIBLE_PHONE_DIGITS = 3;
const MIN_MASKABLE_DIGITS = 7;
const MASK = "••• •••";
const VIETNAM_PREFIX = "+84";

function digitsOf(text: string): string {
	return text.replace(/\D/g, "");
}

export function maskPhone(raw: string | null | undefined): string | null {
	if (raw === null || raw === undefined) return null;
	const normalized = normalizeLoyaltyPhone(raw);
	const digits = digitsOf(normalized ?? raw);
	if (digits.length < MIN_MASKABLE_DIGITS) return null;
	const tail = digits.slice(-VISIBLE_PHONE_DIGITS);
	return normalized?.startsWith(VIETNAM_PREFIX)
		? `${VIETNAM_PREFIX} ${MASK} ${tail}`
		: `${MASK} ${tail}`;
}

export function formatFullPhone(raw: string | null | undefined): string | null {
	if (raw === null || raw === undefined) return null;
	const normalized = normalizeLoyaltyPhone(raw);
	if (normalized === null) return null;
	if (!normalized.startsWith(VIETNAM_PREFIX)) return normalized;
	const national = normalized.slice(VIETNAM_PREFIX.length);
	if (national.length !== 9) return normalized;
	return `${VIETNAM_PREFIX} ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}
