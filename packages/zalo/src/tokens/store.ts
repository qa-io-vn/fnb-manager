import type { TokenKind, TokenPair } from "./oauth.js";

export const ALERT_SOURCES = ["cli", "actions", "scheduler"] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];

export const FAILURE_REASONS = [
	"refused",
	"not_configured",
	"unanswered",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface TokenFailure {
	readonly reason: FailureReason;
	readonly errorCode: number | null;
}

export interface TargetFilter {
	readonly kind: TokenKind;
	readonly tenantId: string | null;
	readonly brandKey: string | null;
}

export interface TokenTarget {
	readonly tenantId: string;
	readonly tenantSlug: string;
	readonly brandId: string;
	readonly brandKey: string;
	readonly kind: TokenKind;
	readonly appId: string;
	readonly appSecretName: string;
	readonly hasToken: boolean;
}

export interface LockedToken {
	readonly tokenId: string;
	readonly version: number;
	readonly refreshedAt: Date;
	readonly accessExpiresAt: Date;
	readonly due: boolean;
	readonly refreshToken: string | null;
}

export interface TokenSnapshot {
	readonly version: number;
	readonly refreshedAt: Date;
}

export interface TokenTransaction {
	readonly locked: LockedToken | null;
	write(pair: TokenPair, at: Date): Promise<number | null>;
}

export interface AuthorizationStart {
	readonly expiresAt: Date;
	readonly appId: string;
	readonly oaId: string;
}

export type AuthorizationClaim =
	| {
			readonly outcome: "claimed";
			readonly tenantId: string;
			readonly brandId: string;
			readonly brandKey: string;
			readonly codeVerifier: string;
			readonly appId: string;
			readonly appSecretName: string;
			readonly oaId: string;
	  }
	| { readonly outcome: "expired" | "unknown" };

export interface TokenStore {
	targets(filter: TargetFilter): Promise<readonly TokenTarget[]>;
	beginAuthorization(
		brandId: string,
		stateKey: string,
		codeVerifier: string,
		at: Date,
	): Promise<AuthorizationStart>;
	claimAuthorization(stateKey: string, at: Date): Promise<AuthorizationClaim>;
	saveTokens(
		brandId: string,
		kind: TokenKind,
		pair: TokenPair,
		at: Date,
	): Promise<number>;
	locked<T>(
		target: TokenTarget,
		refreshAfterSeconds: number | null,
		at: Date,
		work: (transaction: TokenTransaction) => Promise<T>,
	): Promise<T>;
	snapshot(target: TokenTarget): Promise<TokenSnapshot | null>;
	raiseFailure(
		target: TokenTarget,
		failure: TokenFailure,
		source: AlertSource,
		at: Date,
	): Promise<string>;
	resolveFailure(target: TokenTarget, at: Date): Promise<number>;
	checkPackageExpiry(
		tenantId: string | null,
		source: AlertSource,
		at: Date,
	): Promise<number>;
}
