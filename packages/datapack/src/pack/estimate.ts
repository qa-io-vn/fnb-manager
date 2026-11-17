export const TOKEN_LIMIT = 30000;
export const TOKEN_FLOOR = 15000;

export const TOKENS_PER_BYTES = { tokens: 5, bytes: 11 } as const;

export type PackSize = "small" | "within_budget" | "over_budget";

export function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function tokensForBytes(bytes: number): number {
	const scaled = bytes * TOKENS_PER_BYTES.tokens;
	const remainder = scaled % TOKENS_PER_BYTES.bytes;
	return (
		(scaled - remainder) / TOKENS_PER_BYTES.bytes + (remainder === 0 ? 0 : 1)
	);
}

export function estimateTokens(text: string): number {
	return tokensForBytes(utf8Length(text));
}

export function packSize(estimatedTokens: number): PackSize {
	if (estimatedTokens > TOKEN_LIMIT) return "over_budget";
	return estimatedTokens < TOKEN_FLOOR ? "small" : "within_budget";
}
