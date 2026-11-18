const encoder = new TextEncoder();

export function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function hmacSha256Hex(
	key: string,
	message: string,
): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return hex(
		await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)),
	);
}

export function appSecretProof(
	accessToken: string,
	appSecret: string,
): Promise<string> {
	return hmacSha256Hex(appSecret, accessToken);
}
