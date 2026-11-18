import { UpstreamError, type UpstreamFailure } from "../http.js";
import {
	exchangeOaCode,
	oaPermissionUrl,
	refreshTokenPair,
	type TokenAnswer,
	type TokenKind,
	ZALO_ID_PATTERN,
	type ZaloOauthOptions,
} from "./oauth.js";
import {
	isState,
	type RandomBytes,
	randomBytes,
	startPkce,
	stateKey,
} from "./pkce.js";
import type {
	AlertSource,
	TokenFailure,
	TokenStore,
	TokenTarget,
} from "./store.js";

export const UNANSWERED_ALERT_MARGIN_SECONDS = 6 * 3_600;

export type SecretReader = (name: string) => string | null;

export interface TokenJobDependencies {
	readonly store: TokenStore;
	readonly oauth: ZaloOauthOptions;
	readonly secret: SecretReader;
	readonly clock: () => Date;
	readonly source: AlertSource;
}

export type RefreshResult =
	| {
			readonly outcome: "refreshed";
			readonly version: number;
			readonly ageSeconds: number;
	  }
	| {
			readonly outcome: "fresh";
			readonly ageSeconds: number;
			readonly version: number;
	  }
	| { readonly outcome: "missing" }
	| {
			readonly outcome: "refused";
			readonly errorCode: number;
			readonly alert: string;
	  }
	| { readonly outcome: "not_configured"; readonly alert: string }
	| {
			readonly outcome: "uncertain";
			readonly failure: UpstreamFailure | "database";
			readonly alert: string | null;
	  };

export interface RefreshOptions {
	readonly refreshAfterSeconds?: number | null;
}

type Step =
	| { readonly kind: "missing" }
	| {
			readonly kind: "fresh";
			readonly ageSeconds: number;
			readonly version: number;
	  }
	| { readonly kind: "not_configured"; readonly version: number }
	| {
			readonly kind: "refused";
			readonly errorCode: number;
			readonly version: number;
	  }
	| {
			readonly kind: "lost";
			readonly failure: UpstreamFailure;
			readonly version: number;
			readonly accessExpiresAt: Date;
	  }
	| {
			readonly kind: "refreshed";
			readonly version: number;
			readonly ageSeconds: number;
	  };

function secondsBetween(from: Date, to: Date): number {
	return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

async function raise(
	dependencies: TokenJobDependencies,
	target: TokenTarget,
	failure: TokenFailure,
): Promise<string> {
	return dependencies.store.raiseFailure(
		target,
		failure,
		dependencies.source,
		dependencies.clock(),
	);
}

function alertsWhenUnanswered(
	target: TokenTarget,
	accessExpiresAt: Date,
	at: Date,
): boolean {
	return (
		target.kind === "developer" ||
		accessExpiresAt.getTime() - at.getTime() <=
			UNANSWERED_ALERT_MARGIN_SECONDS * 1000
	);
}

export async function refreshToken(
	dependencies: TokenJobDependencies,
	target: TokenTarget,
	options: RefreshOptions = {},
): Promise<RefreshResult> {
	const at = dependencies.clock();
	let writing: { readonly version: number } | null = null;
	let step: Step;
	try {
		step = await dependencies.store.locked(
			target,
			options.refreshAfterSeconds ?? null,
			at,
			async (transaction): Promise<Step> => {
				const locked = transaction.locked;
				if (locked === null) {
					return { kind: "missing" };
				}
				const ageSeconds = secondsBetween(locked.refreshedAt, at);
				if (!locked.due || locked.refreshToken === null) {
					return { kind: "fresh", ageSeconds, version: locked.version };
				}
				const appSecret = dependencies.secret(target.appSecretName);
				if (appSecret === null) {
					return { kind: "not_configured", version: locked.version };
				}
				let answer: TokenAnswer;
				try {
					answer = await refreshTokenPair(
						dependencies.oauth,
						target.kind,
						{
							appId: target.appId,
							appSecret,
							refreshToken: locked.refreshToken,
						},
						dependencies.clock(),
					);
				} catch (error) {
					if (error instanceof UpstreamError) {
						return {
							kind: "lost",
							failure: error.failure,
							version: locked.version,
							accessExpiresAt: locked.accessExpiresAt,
						};
					}
					throw error;
				}
				if (!answer.ok) {
					return {
						kind: "refused",
						errorCode: answer.error,
						version: locked.version,
					};
				}
				writing = { version: locked.version };
				const version = await transaction.write(answer.pair, at);
				if (version === null) {
					throw new Error("the token row moved on while it was locked");
				}
				return { kind: "refreshed", version, ageSeconds };
			},
		);
	} catch (error) {
		const pending = writing as { readonly version: number } | null;
		if (pending === null) {
			throw error;
		}
		const after = await dependencies.store.snapshot(target).catch(() => null);
		if (
			after !== null &&
			after.version === pending.version + 1 &&
			after.refreshedAt.getTime() === at.getTime()
		) {
			step = { kind: "refreshed", version: after.version, ageSeconds: 0 };
		} else {
			return {
				outcome: "uncertain",
				failure: "database",
				alert: await raise(dependencies, target, {
					reason: "unanswered",
					errorCode: null,
				}).catch(() => null),
			};
		}
	}
	switch (step.kind) {
		case "missing":
			return { outcome: "missing" };
		case "fresh":
			return {
				outcome: "fresh",
				ageSeconds: step.ageSeconds,
				version: step.version,
			};
		case "refreshed":
			await dependencies.store
				.resolveFailure(target, dependencies.clock())
				.catch(() => 0);
			return {
				outcome: "refreshed",
				version: step.version,
				ageSeconds: step.ageSeconds,
			};
		case "not_configured":
			return {
				outcome: "not_configured",
				alert: await raise(dependencies, target, {
					reason: "not_configured",
					errorCode: null,
				}),
			};
		case "refused":
			return {
				outcome: "refused",
				errorCode: step.errorCode,
				alert: await raise(dependencies, target, {
					reason: "refused",
					errorCode: step.errorCode,
				}),
			};
		case "lost": {
			const after = await dependencies.store.snapshot(target);
			if (after !== null && after.version !== step.version) {
				return {
					outcome: "fresh",
					ageSeconds: secondsBetween(after.refreshedAt, dependencies.clock()),
					version: after.version,
				};
			}
			return {
				outcome: "uncertain",
				failure: step.failure,
				alert: alertsWhenUnanswered(target, step.accessExpiresAt, at)
					? await raise(dependencies, target, {
							reason: "unanswered",
							errorCode: null,
						})
					: null,
			};
		}
	}
}

export interface AuthorizationDependencies {
	readonly store: TokenStore;
	readonly oauthBaseUrl: string;
	readonly clock: () => Date;
	readonly random?: RandomBytes;
}

export interface AuthorizationLink {
	readonly url: string;
	readonly expiresAt: Date;
}

export async function beginOaAuthorization(
	dependencies: AuthorizationDependencies,
	target: TokenTarget,
	redirectUri: string,
): Promise<AuthorizationLink> {
	if (target.kind !== "oa") {
		throw new TypeError("only an OA token is authorised through OAuth");
	}
	const pkce = await startPkce(dependencies.random ?? randomBytes);
	const start = await dependencies.store.beginAuthorization(
		target.brandId,
		pkce.stateKey,
		pkce.codeVerifier,
		dependencies.clock(),
	);
	return {
		url: oaPermissionUrl({
			baseUrl: dependencies.oauthBaseUrl,
			appId: start.appId,
			redirectUri,
			codeChallenge: pkce.codeChallenge,
			state: pkce.state,
		}),
		expiresAt: start.expiresAt,
	};
}

export interface CallbackInput {
	readonly state: string | null;
	readonly code: string | null;
	readonly oaId: string | null;
}

export type AuthorizationResult =
	| {
			readonly outcome: "authorized";
			readonly brandKey: string;
			readonly version: number;
	  }
	| {
			readonly outcome:
				| "invalid_state"
				| "expired_state"
				| "invalid_code"
				| "wrong_oa"
				| "not_configured"
				| "unanswered";
	  }
	| { readonly outcome: "refused"; readonly errorCode: number };

const CALLBACK_CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;

export async function completeOaAuthorization(
	dependencies: TokenJobDependencies,
	input: CallbackInput,
): Promise<AuthorizationResult> {
	if (!isState(input.state)) {
		return { outcome: "invalid_state" };
	}
	const at = dependencies.clock();
	const claim = await dependencies.store.claimAuthorization(
		await stateKey(input.state),
		at,
	);
	if (claim.outcome !== "claimed") {
		return {
			outcome: claim.outcome === "expired" ? "expired_state" : "invalid_state",
		};
	}
	if (input.code === null || !CALLBACK_CODE_PATTERN.test(input.code)) {
		return { outcome: "invalid_code" };
	}
	if (
		input.oaId !== null &&
		(!ZALO_ID_PATTERN.test(input.oaId) || input.oaId !== claim.oaId)
	) {
		return { outcome: "wrong_oa" };
	}
	const appSecret = dependencies.secret(claim.appSecretName);
	if (appSecret === null) {
		return { outcome: "not_configured" };
	}
	let answer: TokenAnswer;
	try {
		answer = await exchangeOaCode(
			dependencies.oauth,
			{
				appId: claim.appId,
				appSecret,
				code: input.code,
				codeVerifier: claim.codeVerifier,
			},
			dependencies.clock(),
		);
	} catch (error) {
		if (error instanceof UpstreamError) {
			return { outcome: "unanswered" };
		}
		throw error;
	}
	if (!answer.ok) {
		return { outcome: "refused", errorCode: answer.error };
	}
	const version = await dependencies.store.saveTokens(
		claim.brandId,
		"oa",
		answer.pair,
		at,
	);
	const target: TokenTarget = {
		tenantId: claim.tenantId,
		tenantSlug: "",
		brandId: claim.brandId,
		brandKey: claim.brandKey,
		kind: "oa",
		appId: claim.appId,
		appSecretName: claim.appSecretName,
		hasToken: true,
	};
	await dependencies.store
		.resolveFailure(target, dependencies.clock())
		.catch(() => 0);
	return { outcome: "authorized", brandKey: claim.brandKey, version };
}

export function tokenKindLabel(kind: TokenKind): string {
	return kind === "oa" ? "OA token" : "developer token";
}
