import { type CanonicalValue, canonicalJson } from "./canonical.js";

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function packIdText(pack: {
	readonly [key: string]: CanonicalValue;
}): string {
	return canonicalJson({ ...pack, pack_id: "", generated_at: "" });
}

export async function packIdOf(pack: {
	readonly [key: string]: CanonicalValue;
}): Promise<string> {
	return sha256Hex(packIdText(pack));
}
