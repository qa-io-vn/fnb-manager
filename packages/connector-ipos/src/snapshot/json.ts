function base64UrlText(text: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export interface SnapshotTokenClaims {
	id: string;
	cp: string;
	email: string | null;
	iat: number;
	exp: number;
}

export function snapshotToken(claims: SnapshotTokenClaims): string {
	const header = base64UrlText(JSON.stringify({ alg: "none", typ: "JWT" }));
	const payload = base64UrlText(JSON.stringify({ ...claims, ut: "user" }));
	return `${header}.${payload}.${base64UrlText("ipos-snapshot")}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
