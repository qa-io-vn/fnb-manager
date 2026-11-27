/**
 * The dynamic VietQR (NAPAS's profile of the EMVCo merchant-presented QR): one payload per payment attempt naming the
 * bank (its 6-digit BIN), the account, the exact amount in đồng and the attempt's reference as the purpose of the
 * transfer, so a bank app fills everything in and the bank's notification carries the reference back.
 *
 * Layout (ID, two-digit length, value):
 *   00 "01" payload format · 01 "12" dynamic (one amount) · 38 merchant account: 00 "A000000727" (NAPAS),
 *   01 { 00 BIN, 01 account }, 02 "QRIBFTTA" (transfer to an account) · 53 "704" (VND) · 54 amount · 58 "VN" ·
 *   62 { 08 purpose } · 63 CRC-16/CCITT-FALSE of everything before it, "6304" included, as four upper-case hex digits.
 */

export const VIETQR_GUID = "A000000727";
export const VIETQR_SERVICE_ACCOUNT = "QRIBFTTA";
export const VIETQR_CURRENCY_VND = "704";
export const VIETQR_COUNTRY = "VN";
export const VIETQR_MAX_AMOUNT = 9_999_999_999_999;
export const VIETQR_PURPOSE_MAX = 25;

export const BANK_BIN_PATTERN = /^[0-9]{6}$/;
export const ACCOUNT_NUMBER_PATTERN = /^[0-9A-Za-z]{1,19}$/;
const PURPOSE_PATTERN = /^[A-Za-z0-9 ]{1,25}$/;

/**
 * A payment reference: a prefix of 2 to 4 capital letters and 8 characters of an alphabet without 0, 1, I and O, so it
 * survives being read aloud, typed again or upper-cased by a bank (40 random bits, made by the database).
 */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERENCE_PREFIX_PATTERN = /^[A-Z]{2,4}$/;
export const REFERENCE_PATTERN = /^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$/;
const REFERENCE_BODY = "[2-9A-HJ-NP-Z]{8}";
export const MAX_REFERENCE_CANDIDATES = 5;

export class VietQrError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VietQrError";
	}
}

/** CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF, no reflection, no final XOR) of an ASCII text. */
export function crc16Ccitt(text: string): number {
	let crc = 0xffff;
	for (let index = 0; index < text.length; index += 1) {
		crc ^= (text.charCodeAt(index) & 0xff) << 8;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
		}
	}
	return crc;
}

export function crcText(text: string): string {
	return crc16Ccitt(text).toString(16).toUpperCase().padStart(4, "0");
}

/** One EMVCo data object: the two-digit id, the two-digit length and the value (ASCII only, at most 99 characters). */
export function tlv(id: string, value: string): string {
	if (!/^[0-9]{2}$/.test(id)) {
		throw new VietQrError("an EMVCo id is two digits");
	}
	if (
		!/^[\x20-\x7e]*$/.test(value) ||
		value.length === 0 ||
		value.length > 99
	) {
		throw new VietQrError(
			"an EMVCo value is 1 to 99 printable ASCII characters",
		);
	}
	return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

export interface VietQrInput {
	readonly bankBin: string;
	readonly accountNumber: string;
	/** whole đồng, 1 or more */
	readonly amount: number;
	/** the transfer's purpose: the attempt's reference */
	readonly purpose: string;
}

/** The dynamic VietQR payload of one transfer; refuses anything a bank app could misread. */
export function buildVietQr(input: VietQrInput): string {
	if (!BANK_BIN_PATTERN.test(input.bankBin)) {
		throw new VietQrError("a bank BIN is six digits");
	}
	if (!ACCOUNT_NUMBER_PATTERN.test(input.accountNumber)) {
		throw new VietQrError("an account number is 1 to 19 letters or digits");
	}
	if (
		!Number.isSafeInteger(input.amount) ||
		input.amount < 1 ||
		input.amount > VIETQR_MAX_AMOUNT
	) {
		throw new VietQrError("a VietQR amount is a whole number of đồng from 1");
	}
	if (!PURPOSE_PATTERN.test(input.purpose)) {
		throw new VietQrError(
			"a transfer purpose is 1 to 25 letters, digits or spaces",
		);
	}
	const beneficiary = tlv("00", input.bankBin) + tlv("01", input.accountNumber);
	const merchant =
		tlv("00", VIETQR_GUID) +
		tlv("01", beneficiary) +
		tlv("02", VIETQR_SERVICE_ACCOUNT);
	const body =
		tlv("00", "01") +
		tlv("01", "12") +
		tlv("38", merchant) +
		tlv("53", VIETQR_CURRENCY_VND) +
		tlv("54", String(input.amount)) +
		tlv("58", VIETQR_COUNTRY) +
		tlv("62", tlv("08", input.purpose)) +
		"6304";
	return `${body}${crcText(body)}`;
}

export interface EmvObject {
	readonly id: string;
	readonly value: string;
}

/** Splits an EMVCo text into its data objects; null when the lengths do not add up. */
export function parseTlv(text: string): EmvObject[] | null {
	const objects: EmvObject[] = [];
	let at = 0;
	while (at < text.length) {
		const id = text.slice(at, at + 2);
		const length = Number(text.slice(at + 2, at + 4));
		if (
			!/^[0-9]{2}$/.test(id) ||
			!/^[0-9]{2}$/.test(text.slice(at + 2, at + 4))
		) {
			return null;
		}
		const value = text.slice(at + 4, at + 4 + length);
		if (value.length !== length) {
			return null;
		}
		objects.push({ id, value });
		at += 4 + length;
	}
	return objects;
}

export interface ParsedVietQr {
	readonly bankBin: string;
	readonly accountNumber: string;
	readonly amount: number | null;
	readonly purpose: string | null;
	readonly dynamic: boolean;
}

/** Reads a VietQR payload back and checks its CRC: for tests and for a provider that returns its own payload. */
export function parseVietQr(payload: string): ParsedVietQr | null {
	if (payload.length < 8 || !payload.slice(-8, -4).startsWith("6304")) {
		return null;
	}
	if (crcText(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()) {
		return null;
	}
	const objects = parseTlv(payload);
	if (objects === null) {
		return null;
	}
	const find = (list: readonly EmvObject[], id: string) =>
		list.find((object) => object.id === id)?.value ?? null;
	const merchant = find(objects, "38");
	const merchantObjects = merchant === null ? null : parseTlv(merchant);
	if (merchantObjects === null || find(merchantObjects, "00") !== VIETQR_GUID) {
		return null;
	}
	const beneficiary = find(merchantObjects, "01");
	const beneficiaryObjects =
		beneficiary === null ? null : parseTlv(beneficiary);
	const bankBin =
		beneficiaryObjects === null ? null : find(beneficiaryObjects, "00");
	const accountNumber =
		beneficiaryObjects === null ? null : find(beneficiaryObjects, "01");
	if (bankBin === null || accountNumber === null) {
		return null;
	}
	const amountText = find(objects, "54");
	const additional = find(objects, "62");
	const additionalObjects = additional === null ? null : parseTlv(additional);
	return {
		bankBin,
		accountNumber,
		amount:
			amountText !== null && /^[0-9]+$/.test(amountText)
				? Number(amountText)
				: null,
		purpose: additionalObjects === null ? null : find(additionalObjects, "08"),
		dynamic: find(objects, "01") === "12",
	};
}

/**
 * The references a transfer's text may carry for one prefix, most likely first: whole words of the text first (a
 * bank that keeps the separators), then any run inside a word (a bank that glues the content to its own prefix or
 * removes the spaces). Upper-cased, unique, at most five. Only the database decides which, if any, is an attempt.
 */
export function referenceCandidates(text: string, prefix: string): string[] {
	if (!REFERENCE_PREFIX_PATTERN.test(prefix)) {
		throw new VietQrError("a reference prefix is 2 to 4 capital letters");
	}
	const upper = text.normalize("NFKD").toUpperCase();
	const found: string[] = [];
	const add = (value: string) => {
		if (!found.includes(value) && found.length < MAX_REFERENCE_CANDIDATES) {
			found.push(value);
		}
	};
	const whole = new RegExp(`^${prefix}${REFERENCE_BODY}$`);
	for (const word of upper.split(/[^A-Z0-9]+/)) {
		if (whole.test(word)) {
			add(word);
		}
	}
	const inside = new RegExp(`${prefix}${REFERENCE_BODY}`, "g");
	const glued = upper.replace(/[^A-Z0-9]+/g, "");
	for (let at = 0; at <= glued.length - prefix.length - 8; at += 1) {
		inside.lastIndex = at;
		const match = inside.exec(glued);
		if (match === null) {
			break;
		}
		add(match[0]);
		at = match.index;
	}
	return found;
}
