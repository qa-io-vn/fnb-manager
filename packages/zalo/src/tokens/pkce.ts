import { hex } from "../proof.js";

export const CODE_VERIFIER_BYTES = 32;
export const CODE_VERIFIER_LENGTH = 43;
export const STATE_BYTES = 24;
export const STATE_LENGTH = 32;
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export const STATE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const STATE_KEY_PATTERN = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();

export type RandomBytes = (length: number) => Uint8Array;

export const randomBytes: RandomBytes = (length) =>
	crypto.getRandomValues(new Uint8Array(length));

export function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function createCodeVerifier(random: RandomBytes = randomBytes): string {
	return base64Url(random(CODE_VERIFIER_BYTES));
}

export function createState(random: RandomBytes = randomBytes): string {
	return base64Url(random(STATE_BYTES));
}

export function isCodeVerifier(value: unknown): value is string {
	return typeof value === "string" && CODE_VERIFIER_PATTERN.test(value);
}

export function isState(value: unknown): value is string {
	return typeof value === "string" && STATE_PATTERN.test(value);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
	if (!isCodeVerifier(verifier)) {
		throw new TypeError(
			"a PKCE code verifier is 43 to 128 unreserved characters",
		);
	}
	const digest = await crypto.subtle.digest(
		"SHA-256",
		encoder.encode(verifier),
	);
	return base64Url(new Uint8Array(digest));
}

export async function stateKey(state: string): Promise<string> {
	if (!isState(state)) {
		throw new TypeError("an authorisation state is 32 base64url characters");
	}
	return hex(await crypto.subtle.digest("SHA-256", encoder.encode(state)));
}

export interface PkceStart {
	readonly codeVerifier: string;
	readonly codeChallenge: string;
	readonly state: string;
	readonly stateKey: string;
}

export async function startPkce(
	random: RandomBytes = randomBytes,
): Promise<PkceStart> {
	const codeVerifier = createCodeVerifier(random);
	const state = createState(random);
	return {
		codeVerifier,
		codeChallenge: await codeChallengeS256(codeVerifier),
		state,
		stateKey: await stateKey(state),
	};
}
