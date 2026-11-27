/**
 * The keyed hashes every provider uses (HMAC-SHA256 for Zalo's Checkout SDK and most bank services, HMAC-SHA512 for
 * some), through WebCrypto so the same code runs in Node and in the Deno Edge Functions, and a comparison whose time
 * does not depend on where two signatures first differ.
 */

export type HmacAlgorithm = "SHA-256" | "SHA-512";

const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/** HMAC of a UTF-8 text under a UTF-8 key, as lower-case hex. A blank key is refused: it would sign anything. */
export async function hmacHex(
	algorithm: HmacAlgorithm,
	key: string,
	data: string,
): Promise<string> {
	if (key === "") {
		throw new Error("an HMAC needs a key");
	}
	const imported = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: algorithm },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		imported,
		encoder.encode(data),
	);
	return toHex(new Uint8Array(signature));
}

export function hmacSha256Hex(key: string, data: string): Promise<string> {
	return hmacHex("SHA-256", key, data);
}

export async function sha256Hex(data: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
	return toHex(new Uint8Array(digest));
}

/**
 * Whether two non-empty texts are equal, comparing every character of the longer one so the time does not reveal the
 * first difference (an API key in a header).
 */
export function constantTimeEqual(left: string, right: string): boolean {
	const length = Math.max(left.length, right.length);
	let difference = left.length ^ right.length;
	for (let index = 0; index < length; index += 1) {
		difference |=
			(left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}
	return difference === 0 && length > 0;
}

/** Whether two hex signatures are equal, in constant time and whatever the case of their letters. */
export function signatureEqual(expected: string, received: string): boolean {
	return (
		/^[0-9a-fA-F]+$/.test(received) &&
		constantTimeEqual(expected.toLowerCase(), received.toLowerCase())
	);
}
