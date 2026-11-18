import type { Sql, TransactionSql } from "postgres";
import type { TokenKind, TokenPair } from "./oauth.js";
import type {
	AlertSource,
	AuthorizationClaim,
	AuthorizationStart,
	LockedToken,
	TargetFilter,
	TokenFailure,
	TokenSnapshot,
	TokenStore,
	TokenTarget,
	TokenTransaction,
} from "./store.js";

interface TargetRow {
	tenant_id: string;
	tenant_slug: string;
	brand_id: string;
	brand_key: string;
	app_external_id: string;
	app_secret_name: string;
	has_token: boolean;
}

interface LockRow {
	token_id: string;
	version: string;
	refreshed_at: Date;
	access_expires_at: Date;
	due: boolean;
	refresh_token: string | null;
}

interface ClaimRow {
	outcome: string;
	tenant_id: string | null;
	brand_id: string | null;
	brand_key: string | null;
	code_verifier: string | null;
	app_external_id: string | null;
	app_secret_name: string | null;
	oa_external_id: string | null;
}

function kindOf(value: string): TokenKind {
	if (value !== "oa" && value !== "developer") {
		throw new Error("the token kind is unknown");
	}
	return value;
}

function versionOf(value: string | number | null): number | null {
	if (value === null) {
		return null;
	}
	const version = Number(value);
	if (!Number.isSafeInteger(version) || version < 1) {
		throw new Error("the token version is malformed");
	}
	return version;
}

async function storeRefresh(
	sql: TransactionSql,
	token: LockedToken,
	pair: TokenPair,
	at: Date,
): Promise<number | null> {
	const [row] = await sql<{ version: string | null }[]>`
		select app.store_zalo_token_refresh(
			${token.tokenId}::uuid,
			${token.version}::bigint,
			${pair.accessToken}::text,
			${pair.accessExpiresAt.toISOString()}::timestamptz,
			${pair.refreshToken}::text,
			${pair.refreshExpiresAt.toISOString()}::timestamptz,
			${at.toISOString()}::timestamptz
		)::text as version
	`;
	return versionOf(row?.version ?? null);
}

export class PostgresTokenStore implements TokenStore {
	private readonly sql: Sql;

	constructor(sql: Sql) {
		this.sql = sql;
	}

	async targets(filter: TargetFilter): Promise<readonly TokenTarget[]> {
		const rows = await this.sql<TargetRow[]>`
			select t.tenant_id::text as tenant_id, t.tenant_slug, t.brand_id::text as brand_id, t.brand_key,
				t.app_external_id, t.app_secret_name, t.has_token
			from app.zalo_token_targets(${filter.kind}::text, ${filter.tenantId}::uuid, ${filter.brandKey}::text) t
		`;
		return rows.map((row) => ({
			tenantId: row.tenant_id,
			tenantSlug: row.tenant_slug,
			brandId: row.brand_id,
			brandKey: row.brand_key,
			kind: filter.kind,
			appId: row.app_external_id,
			appSecretName: row.app_secret_name,
			hasToken: row.has_token,
		}));
	}

	async beginAuthorization(
		brandId: string,
		stateKey: string,
		codeVerifier: string,
		at: Date,
	): Promise<AuthorizationStart> {
		const [row] = await this.sql<
			{ expires_at: Date; app_external_id: string; oa_external_id: string }[]
		>`
			select b.expires_at, b.app_external_id, b.oa_external_id
			from app.begin_oa_authorization(
				${brandId}::uuid, ${stateKey}::text, ${codeVerifier}::text, ${at.toISOString()}::timestamptz
			) b
		`;
		if (row === undefined) {
			throw new Error("app.begin_oa_authorization answered no row");
		}
		return {
			expiresAt: row.expires_at,
			appId: row.app_external_id,
			oaId: row.oa_external_id,
		};
	}

	async claimAuthorization(
		stateKey: string,
		at: Date,
	): Promise<AuthorizationClaim> {
		const [row] = await this.sql<ClaimRow[]>`
			select c.outcome, c.tenant_id::text as tenant_id, c.brand_id::text as brand_id, c.brand_key,
				c.code_verifier, c.app_external_id, c.app_secret_name, c.oa_external_id
			from app.claim_oa_authorization(${stateKey}::text, ${at.toISOString()}::timestamptz) c
		`;
		if (row === undefined || row.outcome === "unknown") {
			return { outcome: "unknown" };
		}
		if (row.outcome === "expired") {
			return { outcome: "expired" };
		}
		if (
			row.outcome !== "claimed" ||
			row.tenant_id === null ||
			row.brand_id === null ||
			row.brand_key === null ||
			row.code_verifier === null ||
			row.app_external_id === null ||
			row.app_secret_name === null ||
			row.oa_external_id === null
		) {
			throw new Error("app.claim_oa_authorization answered an unknown row");
		}
		return {
			outcome: "claimed",
			tenantId: row.tenant_id,
			brandId: row.brand_id,
			brandKey: row.brand_key,
			codeVerifier: row.code_verifier,
			appId: row.app_external_id,
			appSecretName: row.app_secret_name,
			oaId: row.oa_external_id,
		};
	}

	async saveTokens(
		brandId: string,
		kind: TokenKind,
		pair: TokenPair,
		at: Date,
	): Promise<number> {
		const [row] = await this.sql<{ version: string }[]>`
			select app.save_zalo_tokens(
				${brandId}::uuid,
				${kind}::text,
				${pair.accessToken}::text,
				${pair.accessExpiresAt.toISOString()}::timestamptz,
				${pair.refreshToken}::text,
				${pair.refreshExpiresAt.toISOString()}::timestamptz,
				${at.toISOString()}::timestamptz
			)::text as version
		`;
		const version = versionOf(row?.version ?? null);
		if (version === null) {
			throw new Error("app.save_zalo_tokens answered no version");
		}
		return version;
	}

	async locked<T>(
		target: TokenTarget,
		refreshAfterSeconds: number | null,
		at: Date,
		work: (transaction: TokenTransaction) => Promise<T>,
	): Promise<T> {
		const result = await this.sql.begin(async (sql) => {
			const [row] = await sql<LockRow[]>`
				select l.token_id::text as token_id, l.version::text as version, l.refreshed_at,
					l.access_expires_at, l.due, l.refresh_token
				from app.lock_zalo_token(
					${target.brandId}::uuid,
					${kindOf(target.kind)}::text,
					${refreshAfterSeconds === null ? null : `${Math.max(0, Math.floor(refreshAfterSeconds))} seconds`}::interval,
					${at.toISOString()}::timestamptz
				) l
			`;
			const locked: LockedToken | null =
				row === undefined
					? null
					: {
							tokenId: row.token_id,
							version: versionOf(row.version) ?? 1,
							refreshedAt: row.refreshed_at,
							accessExpiresAt: row.access_expires_at,
							due: row.due,
							refreshToken: row.refresh_token,
						};
			return {
				value: await work({
					locked,
					write: (pair, writtenAt) =>
						locked === null
							? Promise.resolve(null)
							: storeRefresh(sql, locked, pair, writtenAt),
				}),
			};
		});
		return result.value as T;
	}

	async snapshot(target: TokenTarget): Promise<TokenSnapshot | null> {
		const [row] = await this.sql<{ version: string; refreshed_at: Date }[]>`
			select version::text as version, refreshed_at
			from public.zalo_tokens
			where brand_id = ${target.brandId}::uuid and kind = ${kindOf(target.kind)}::text
		`;
		if (row === undefined) {
			return null;
		}
		return {
			version: versionOf(row.version) ?? 1,
			refreshedAt: row.refreshed_at,
		};
	}

	async raiseFailure(
		target: TokenTarget,
		failure: TokenFailure,
		source: AlertSource,
		at: Date,
	): Promise<string> {
		const [row] = await this.sql<{ outcome: string | null }[]>`
			select app.raise_zalo_token_alert(
				${target.brandId}::uuid,
				${kindOf(target.kind)}::text,
				${failure.reason}::text,
				${failure.errorCode}::integer,
				${source}::text,
				${at.toISOString()}::timestamptz
			) as outcome
		`;
		return row?.outcome ?? "none";
	}

	async resolveFailure(target: TokenTarget, at: Date): Promise<number> {
		const [row] = await this.sql<{ resolved: number }[]>`
			select app.resolve_zalo_token_alert(
				${target.brandId}::uuid, ${kindOf(target.kind)}::text, ${at.toISOString()}::timestamptz
			) as resolved
		`;
		return row?.resolved ?? 0;
	}

	async checkPackageExpiry(
		tenantId: string | null,
		source: AlertSource,
		at: Date,
	): Promise<number> {
		const [row] = await this.sql<{ raised: number }[]>`
			select app.check_oa_package_expiry(
				${at.toISOString()}::timestamptz, ${tenantId}::uuid, ${source}::text
			) as raised
		`;
		return row?.raised ?? 0;
	}
}
