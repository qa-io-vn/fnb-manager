// How the Mini Apps write money, counts, times and dates (the brand handbook's "functional voice", design spec 5.2).
// Pure functions without Intl, so a phone's WebView with a thin ICU writes the same text as a test: a price is
// "35.000đ" (a dot every three digits, the "đ" attached, never "₫" or "VND"), a time is 24-hour ("07:00"), a range
// uses an en dash ("07:00–23:00") and a date is "26/11/2026". A value that cannot be written is refused with a
// RangeError, so a wrong number never reaches a screen as a plausible-looking price.

export const MINUS_SIGN = "−";
export const EN_DASH = "–";
export const DONG_SUFFIX = "đ";

function wholeNumber(value: number, what: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(`${what} must be a whole number, got ${value}`);
	}
}

function grouped(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** A whole number of 0 or more with a dot every three digits: 1000 is "1.000". */
export function formatCount(count: number): string {
	wholeNumber(count, "a count");
	if (count < 0)
		throw new RangeError(`a count cannot be negative, got ${count}`);
	return grouped(String(count));
}

/** An amount in đồng: 35000 is "35.000đ" and 0 is "0đ". Whole đồng of 0 or more; a refund is a delta. */
export function formatVnd(amount: number): string {
	wholeNumber(amount, "an amount");
	if (amount < 0) {
		throw new RangeError(`an amount cannot be negative, got ${amount}`);
	}
	return `${grouped(String(amount))}${DONG_SUFFIX}`;
}

/** A change of price with its sign: 5000 is "+5.000đ", -5000 is "−5.000đ" (U+2212) and 0 is "0đ", unsigned. */
export function formatVndDelta(amount: number): string {
	wholeNumber(amount, "an amount");
	if (amount === 0) return formatVnd(0);
	const sign = amount > 0 ? "+" : MINUS_SIGN;
	return `${sign}${formatVnd(Math.abs(amount))}`;
}

// 24:00 closes a day that opens in the morning ("07:00–24:00"), as the opening hours of a store may say
const CLOCK = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

/** A 24-hour time of day written as "HH:MM", from 00:00 to 23:59 and the closing time 24:00. */
export function formatTime(time: string): string {
	if (!CLOCK.test(time)) {
		throw new RangeError(
			`a time must be written HH:MM from 00:00 to 24:00, got "${time}"`,
		);
	}
	return time;
}

/** An opening span: "07:00–23:00" with an en dash. The closing time may be earlier than the opening one (a night). */
export function formatTimeRange(open: string, close: string): string {
	return `${formatTime(open)}${EN_DASH}${formatTime(close)}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date "2026-11-26" written "26/11/2026". The date must exist (no 31 November, 29 February only in leap years). */
export function formatDate(isoDate: string): string {
	const match = ISO_DATE.exec(isoDate);
	const [, year = "", month = "", day = ""] = match ?? [];
	// setUTCFullYear, because Date.UTC reads the years 0 to 99 as 1900 to 1999
	const check = new Date(0);
	check.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	if (
		match === null ||
		check.getUTCFullYear() !== Number(year) ||
		check.getUTCMonth() !== Number(month) - 1 ||
		check.getUTCDate() !== Number(day)
	) {
		throw new RangeError(
			`a date must be a real calendar date YYYY-MM-DD, got "${isoDate}"`,
		);
	}
	return `${day}/${month}/${year}`;
}

// What a price looks like in text: digits followed by ₫, đ, đồng, vnđ or vnd, or ₫ / vnđ / vnd before digits, or a
// shopkeeper's "35k". A "đ" that starts a word ("10 điểm", "3 đơn mới") is not a price. Used to keep prices out of places
// that must not show one (a hand-written note, a screen of a build without ordering) and to check that every price is
// marked with data-price.
export const PRICE_PATTERN =
	/\d[\d.,\s]*\s?(?:₫|đ(?![\p{L}])|đồng|vnđ|vnd)|(?:₫|vnđ|vnd)\s?\d|\dk\b/iu;

export function looksLikePrice(text: string): boolean {
	return PRICE_PATTERN.test(text);
}
