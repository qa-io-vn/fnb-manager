import type { TokenKind, TokenPair } from "./oauth.js";
import type {
	AlertSource,
	AuthorizationClaim,
	AuthorizationStart,
	TargetFilter,
	TokenFailure,
	TokenSnapshot,
	TokenStore,
	TokenTarget,
	TokenTransaction,
} from "./store.js";

export const FAKE_REFRESH_AFTER_SECONDS: Readonly<Record<TokenKind, number>> = {
	oa: 11 * 3_600,
	developer: 20 * 3_600,
};

export const FAKE_AUTHORIZATION_SECONDS = 600;

export interface FakeBrand {
	readonly tenantId: string;
	readonly tenantSlug: string;
	readonly brandId: string;
	readonly brandKey: string;
	readonly appId: string;
	readonly appSecretName: string;
	readonly oaId: string | null;
}

export interface FakeToken {
	readonly tokenId: string;
	version: number;
	accessToken: string;
	refreshToken: string;
	accessExpiresAt: Date;
	refreshExpiresAt: Date;
	refreshedAt: Date;
}

export interface FakeAlert {
	readonly brandId: string;
	readonly kind: TokenKind;
	readonly failure: TokenFailure;
	readonly source: AlertSource;
	readonly outcome: string;
}

export interface FakePending {
	readonly brandId: string;
	readonly codeVerifier: string;
	readonly expiresAt: Date;
}

export interface FakeTokenStore extends TokenStore {
	readonly tokens: Map<string, FakeToken>;
	readonly pending: Map<string, FakePending>;
	readonly alerts: FakeAlert[];
	readonly resolved: string[];
	readonly packageChecks: AlertSource[];
	addBrand(brand: FakeBrand): void;
	token(brandId: string, kind: TokenKind): FakeToken | undefined;
	seed(
		brandId: string,
		kind: TokenKind,
		values: {
			readonly accessToken: string;
			readonly refreshToken: string;
			readonly refreshedAt: Date;
			readonly accessExpiresAt: Date;
		},
	): void;
	failNextWrite(mode: "before" | "after"): void;
	openAlerts(): readonly string[];
}

function key(brandId: string, kind: TokenKind): string {
	return `${brandId}:${kind}`;
}

export function createFakeTokenStore(): FakeTokenStore {
	const brands = new Map<string, FakeBrand>();
	const tokens = new Map<string, FakeToken>();
	const pending = new Map<string, FakePending>();
	const alerts: FakeAlert[] = [];
	const resolved: string[] = [];
	const packageChecks: AlertSource[] = [];
	const open = new Set<string>();
	const queues = new Map<string, Promise<void>>();
	let writeFault: "before" | "after" | null = null;
	let sequence = 0;

	const target = (brand: FakeBrand, kind: TokenKind): TokenTarget => ({
		tenantId: brand.tenantId,
		tenantSlug: brand.tenantSlug,
		brandId: brand.brandId,
		brandKey: brand.brandKey,
		kind,
		appId: brand.appId,
		appSecretName: brand.appSecretName,
		hasToken: tokens.has(key(brand.brandId, kind)),
	});

	const write = (stored: FakeToken, pair: TokenPair, at: Date): void => {
		stored.version += 1;
		stored.accessToken = pair.accessToken;
		stored.refreshToken = pair.refreshToken;
		stored.accessExpiresAt = pair.accessExpiresAt;
		stored.refreshExpiresAt = pair.refreshExpiresAt;
		stored.refreshedAt = at;
	};

	const store: FakeTokenStore = {
		tokens,
		pending,
		alerts,
		resolved,
		packageChecks,
		addBrand(brand) {
			brands.set(brand.brandId, brand);
		},
		token(brandId, kind) {
			return tokens.get(key(brandId, kind));
		},
		seed(brandId, kind, values) {
			sequence += 1;
			tokens.set(key(brandId, kind), {
				tokenId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
				version: 1,
				accessToken: values.accessToken,
				refreshToken: values.refreshToken,
				accessExpiresAt: values.accessExpiresAt,
				refreshExpiresAt: new Date(
					values.refreshedAt.getTime() + 30 * 86_400_000,
				),
				refreshedAt: values.refreshedAt,
			});
		},
		failNextWrite(mode) {
			writeFault = mode;
		},
		openAlerts() {
			return [...open].sort();
		},
		async targets(filter: TargetFilter) {
			return [...brands.values()]
				.filter(
					(brand) =>
						(filter.kind === "developer" || brand.oaId !== null) &&
						(filter.tenantId === null || brand.tenantId === filter.tenantId) &&
						(filter.brandKey === null || brand.brandKey === filter.brandKey),
				)
				.sort((left, right) =>
					`${left.tenantSlug}/${left.brandKey}`.localeCompare(
						`${right.tenantSlug}/${right.brandKey}`,
					),
				)
				.map((brand) => target(brand, filter.kind));
		},
		async beginAuthorization(
			brandId,
			stateKey,
			codeVerifier,
			at,
		): Promise<AuthorizationStart> {
			const brand = brands.get(brandId);
			if (brand?.oaId === null || brand?.oaId === undefined) {
				throw new Error("the brand has no OA");
			}
			for (const [stored, entry] of pending) {
				if (entry.brandId === brandId) {
					pending.delete(stored);
				}
			}
			const expiresAt = new Date(
				at.getTime() + FAKE_AUTHORIZATION_SECONDS * 1000,
			);
			pending.set(stateKey, { brandId, codeVerifier, expiresAt });
			return { expiresAt, appId: brand.appId, oaId: brand.oaId };
		},
		async claimAuthorization(stateKey, at): Promise<AuthorizationClaim> {
			const entry = pending.get(stateKey);
			if (entry === undefined) {
				return { outcome: "unknown" };
			}
			pending.delete(stateKey);
			const brand = brands.get(entry.brandId);
			if (entry.expiresAt.getTime() <= at.getTime()) {
				return { outcome: "expired" };
			}
			if (brand?.oaId === null || brand?.oaId === undefined) {
				return { outcome: "unknown" };
			}
			return {
				outcome: "claimed",
				tenantId: brand.tenantId,
				brandId: brand.brandId,
				brandKey: brand.brandKey,
				codeVerifier: entry.codeVerifier,
				appId: brand.appId,
				appSecretName: brand.appSecretName,
				oaId: brand.oaId,
			};
		},
		async saveTokens(brandId, kind, pair, at) {
			const stored = tokens.get(key(brandId, kind));
			if (stored === undefined) {
				store.seed(brandId, kind, {
					accessToken: pair.accessToken,
					refreshToken: pair.refreshToken,
					refreshedAt: at,
					accessExpiresAt: pair.accessExpiresAt,
				});
				return 1;
			}
			write(stored, pair, at);
			return stored.version;
		},
		async locked<T>(
			lockTarget: TokenTarget,
			refreshAfterSeconds: number | null,
			at: Date,
			work: (transaction: TokenTransaction) => Promise<T>,
		): Promise<T> {
			const lockKey = key(lockTarget.brandId, lockTarget.kind);
			const previous = queues.get(lockKey) ?? Promise.resolve();
			let release = () => {};
			const current = new Promise<void>((resolve) => {
				release = resolve;
			});
			queues.set(
				lockKey,
				previous.then(() => current),
			);
			await previous;
			try {
				const stored = tokens.get(lockKey);
				const threshold =
					refreshAfterSeconds ?? FAKE_REFRESH_AFTER_SECONDS[lockTarget.kind];
				const due =
					stored !== undefined &&
					stored.refreshedAt.getTime() <= at.getTime() - threshold * 1000;
				return await work({
					locked:
						stored === undefined
							? null
							: {
									tokenId: stored.tokenId,
									version: stored.version,
									refreshedAt: stored.refreshedAt,
									accessExpiresAt: stored.accessExpiresAt,
									due,
									refreshToken: due ? stored.refreshToken : null,
								},
					async write(pair, writtenAt) {
						if (stored === undefined) {
							return null;
						}
						const fault = writeFault;
						writeFault = null;
						if (fault === "before") {
							throw new Error("the database connection was lost");
						}
						write(stored, pair, writtenAt);
						if (fault === "after") {
							throw new Error("the commit answer was lost");
						}
						return stored.version;
					},
				});
			} finally {
				release();
			}
		},
		async snapshot(snapshotTarget): Promise<TokenSnapshot | null> {
			const stored = tokens.get(
				key(snapshotTarget.brandId, snapshotTarget.kind),
			);
			return stored === undefined
				? null
				: { version: stored.version, refreshedAt: stored.refreshedAt };
		},
		async raiseFailure(failureTarget, failure, source) {
			const episode = key(failureTarget.brandId, failureTarget.kind);
			const outcome = open.has(episode) ? "repeated" : "opened";
			open.add(episode);
			alerts.push({
				brandId: failureTarget.brandId,
				kind: failureTarget.kind,
				failure,
				source,
				outcome,
			});
			return outcome;
		},
		async resolveFailure(failureTarget) {
			const episode = key(failureTarget.brandId, failureTarget.kind);
			if (!open.delete(episode)) {
				return 0;
			}
			resolved.push(episode);
			return 1;
		},
		async checkPackageExpiry(_tenantId, source) {
			packageChecks.push(source);
			return 0;
		},
	};
	return store;
}
