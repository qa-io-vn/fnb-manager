import { isFixtureTenantSlug, ZaloConfigError } from "@fnb/zalo";
import {
	type AlertSource,
	beginOaAuthorization,
	PostgresTokenStore,
	type RefreshResult,
	refreshToken,
	refreshTokenPair,
	type TokenJobDependencies,
	type TokenJobSettings,
	type TokenKind,
	type TokenTarget,
	tokenJobSettings,
	UNANSWERED_ALERT_MARGIN_SECONDS,
} from "@fnb/zalo/tokens";
import type { Sql } from "postgres";
import { findTenant } from "../admin/tenants.js";
import {
	type CommandContext,
	flag,
	type OptionValues,
	requiredString,
	stringOption,
	UsageError,
} from "../context.js";
import { type CommandSpec, HELP_OPTION } from "./spec.js";
import { BRAND_KEY_PATTERN } from "./zalo-config.js";

export const ZMP_SEED_VARIABLE = "ZALO_ZMP_REFRESH_TOKEN";
export const REDIRECT_URI_VARIABLE = "ZALO_OAUTH_REDIRECT_URI";
export const CALLBACK_PATH = "/functions/v1/zalo-oauth";

const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}(\/|$)/;

const KIND_LABEL: Readonly<Record<TokenKind, string>> = {
	oa: "OA token",
	developer: "developer token",
};

export function alertSource(
	environment: Readonly<Record<string, string | undefined>>,
): AlertSource {
	return environment.GITHUB_ACTIONS ? "actions" : "cli";
}

export function formatDuration(seconds: number): string {
	const value = Math.max(0, Math.round(seconds));
	if (value < 90 * 60) {
		return `${Math.round(value / 60)} min`;
	}
	if (value < 48 * 3_600) {
		return `${Math.round(value / 3_600)} h`;
	}
	return `${Math.round(value / 86_400)} days`;
}

export function nextRefreshText(
	kind: TokenKind,
	nextRefreshAt: Date,
	now: Date,
): string {
	const left = (nextRefreshAt.getTime() - now.getTime()) / 1000;
	const action = kind === "oa" ? "refresh" : "rotation";
	return left <= 0
		? `${action} due now`
		: `next ${action} in ${formatDuration(left)}`;
}

export function brandLabel(
	ci: boolean,
	index: number,
	target: Pick<TokenTarget, "tenantSlug" | "brandKey">,
): string {
	return ci ? `brand ${index + 1}` : `${target.tenantSlug} ${target.brandKey}`;
}

export function refreshLine(
	label: string,
	kind: TokenKind,
	result: RefreshResult,
): string {
	const token = KIND_LABEL[kind];
	switch (result.outcome) {
		case "refreshed":
			return `${label}: ${token} refreshed (version ${result.version}; it was ${formatDuration(result.ageSeconds)} old)`;
		case "fresh":
			return `${label}: ${token} fresh (${formatDuration(result.ageSeconds)} old, version ${result.version}); nothing to do`;
		case "missing":
			return kind === "oa"
				? `${label}: no OA token stored yet; run fnb zalo oa authorize`
				: `${label}: no developer token stored yet; run fnb zalo zmp seed`;
		case "refused":
			return `${label}: Zalo refused the ${token} refresh (error ${result.errorCode}); zalo_token_failed ${result.alert}`;
		case "not_configured":
			return `${label}: the brand's App secret is not set in this environment; zalo_token_failed ${result.alert}`;
		case "uncertain":
			return `${label}: no usable answer for the ${token} refresh (${result.failure}); not retried, the next run reads the row again${result.alert === null ? "" : `; zalo_token_failed ${result.alert}`}`;
	}
}

function failed(result: RefreshResult): boolean {
	return (
		result.outcome === "refused" ||
		result.outcome === "not_configured" ||
		result.outcome === "uncertain"
	);
}

function jobSettings(context: CommandContext): TokenJobSettings {
	try {
		return tokenJobSettings(context.env);
	} catch (error) {
		if (error instanceof ZaloConfigError) {
			throw new UsageError(error.message);
		}
		throw error;
	}
}

function brandOption(values: OptionValues): string | null {
	const brand = stringOption(values, "brand");
	if (brand !== undefined && !BRAND_KEY_PATTERN.test(brand)) {
		throw new UsageError("--brand must be a neutral key such as brand-1");
	}
	return brand ?? null;
}

async function tenantFilter(
	context: CommandContext,
	sql: Sql,
	settings: TokenJobSettings,
	slug: string | undefined,
): Promise<string | null> {
	const tenant = slug === undefined ? null : await findTenant(sql, slug.trim());
	if (slug !== undefined && tenant === null) {
		throw new UsageError(
			context.output.ci
				? "no tenant with that slug"
				: `no tenant with slug "${slug}"`,
		);
	}
	if (
		settings.integration &&
		(tenant === null ||
			tenant.id !== settings.tenantId ||
			!isFixtureTenantSlug(tenant.slug))
	) {
		throw new UsageError(
			"with ZALO_INTEGRATION=1 the token jobs touch only the zalo-it- fixture tenant named by both --tenant and ZALO_TENANT_ID",
		);
	}
	return tenant?.id ?? null;
}

function secretReader(
	context: CommandContext,
): (name: string) => string | null {
	return (name) => {
		const value = context.env[name]?.trim();
		return value === undefined || value === "" ? null : value;
	};
}

function dependencies(
	context: CommandContext,
	store: PostgresTokenStore,
	settings: TokenJobSettings,
): TokenJobDependencies {
	return {
		store,
		oauth: { baseUrl: settings.oauthBaseUrl },
		secret: secretReader(context),
		clock: context.now,
		source: alertSource(context.env),
	};
}

async function runRefresh(
	context: CommandContext,
	values: OptionValues,
	kind: TokenKind,
): Promise<number> {
	const settings = jobSettings(context);
	const brandKey = brandOption(values);
	const { sql } = context.services.db();
	const tenantId = await tenantFilter(
		context,
		sql,
		settings,
		stringOption(values, "tenant"),
	);
	const store = new PostgresTokenStore(sql);
	const targets = await store.targets({ kind, tenantId, brandKey });
	if (targets.length === 0) {
		context.output.line(
			kind === "oa"
				? "no brand with an active Zalo App and an OA; nothing to refresh"
				: "no brand with an active Zalo App; nothing to rotate",
		);
	}
	const force = kind === "developer" && flag(values, "force");
	let failures = 0;
	for (const [index, target] of targets.entries()) {
		const result = await refreshToken(
			dependencies(context, store, settings),
			target,
			force ? { refreshAfterSeconds: 0 } : {},
		);
		if (failed(result)) {
			failures += 1;
		}
		context.output.line(
			refreshLine(brandLabel(context.output.ci, index, target), kind, result),
		);
	}
	if (kind === "oa") {
		const notices = await store.checkPackageExpiry(
			tenantId,
			alertSource(context.env),
			context.now(),
		);
		if (notices > 0) {
			context.output.line(
				`${notices} OA package expiry notice(s) raised (oa_package_expiring)`,
			);
		}
	}
	return failures === 0 ? 0 : 1;
}

export function redirectUri(
	values: OptionValues,
	environment: Readonly<Record<string, string | undefined>>,
): string {
	const explicit =
		stringOption(values, "redirect-uri") ??
		environment[REDIRECT_URI_VARIABLE]?.trim();
	const base = environment.SUPABASE_URL?.trim().replace(/\/+$/, "");
	const value =
		explicit !== undefined && explicit !== ""
			? explicit
			: base === undefined || base === ""
				? undefined
				: `${base}${CALLBACK_PATH}`;
	if (value === undefined) {
		throw new UsageError(
			`give --redirect-uri, ${REDIRECT_URI_VARIABLE} or SUPABASE_URL: the callback URL registered for the Zalo App, ending in ${CALLBACK_PATH}`,
		);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new UsageError("the redirect URI is not a URL");
	}
	if (
		url.username !== "" ||
		url.password !== "" ||
		url.hash !== "" ||
		(url.protocol !== "https:" && !LOOPBACK_URL.test(value))
	) {
		throw new UsageError(
			"the redirect URI must be an https URL without credentials or fragment (http only on 127.0.0.1 or localhost)",
		);
	}
	return url.toString();
}

async function authorize(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	if (context.output.ci) {
		throw new UsageError(
			"fnb zalo oa authorize prints a one-time permission link; run it on the owner's machine, not in CI",
		);
	}
	const settings = jobSettings(context);
	const slug = requiredString(values, "tenant");
	const brandKey = brandOption(values);
	if (brandKey === null) {
		throw new UsageError("--brand is required");
	}
	const callback = redirectUri(values, context.env);
	const { sql } = context.services.db();
	const tenantId = await tenantFilter(context, sql, settings, slug);
	const store = new PostgresTokenStore(sql);
	const [target] = await store.targets({ kind: "oa", tenantId, brandKey });
	if (target === undefined) {
		throw new UsageError(
			`${brandKey} has no active Zalo App with an OA in this tenant; add them with fnb zalo config set`,
		);
	}
	const link = await beginOaAuthorization(
		{ store, oauthBaseUrl: settings.oauthBaseUrl, clock: context.now },
		target,
		callback,
	);
	context.output.line(
		`Open this link as an admin of the ${brandKey} OA before ${link.expiresAt.toISOString()} (10 minutes) and grant the permissions:`,
	);
	context.output.raw(link.url);
	context.output.line(
		`Zalo then sends the browser to ${callback}, which exchanges the code once and stores the token pair; the page answers {"ok": true}. Check with fnb zalo status. A new run replaces this link.`,
	);
	return 0;
}

async function seedDeveloper(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const settings = jobSettings(context);
	const slug = requiredString(values, "tenant");
	const brandKey = brandOption(values);
	if (brandKey === null) {
		throw new UsageError("--brand is required");
	}
	const refresh = context.env[ZMP_SEED_VARIABLE]?.trim() ?? "";
	if (refresh === "") {
		throw new UsageError(
			`set ${ZMP_SEED_VARIABLE} to the developer refresh token for this one run; it is never taken as a flag`,
		);
	}
	const { sql } = context.services.db();
	const tenantId = await tenantFilter(context, sql, settings, slug);
	const store = new PostgresTokenStore(sql);
	const [target] = await store.targets({
		kind: "developer",
		tenantId,
		brandKey,
	});
	if (target === undefined) {
		throw new UsageError(
			`${brandKey} has no active Zalo App in this tenant; add it with fnb zalo config set`,
		);
	}
	const secret = secretReader(context)(target.appSecretName);
	if (secret === null) {
		context.output.error(
			"the brand's App secret is not set in this environment; nothing was stored",
		);
		return 1;
	}
	const answer = await refreshTokenPair(
		{ baseUrl: settings.oauthBaseUrl },
		"developer",
		{ appId: target.appId, appSecret: secret, refreshToken: refresh },
		context.now(),
	);
	if (!answer.ok) {
		context.output.error(
			`Zalo refused the developer refresh token (error ${answer.error}); nothing was stored`,
		);
		return 1;
	}
	const version = await store.saveTokens(
		target.brandId,
		"developer",
		answer.pair,
		context.now(),
	);
	await store.resolveFailure(target, context.now());
	context.output.line(
		`${brandKey}: developer token rotated and stored (version ${version}); ${ZMP_SEED_VARIABLE} is now spent, remove it from the environment. fnb zalo zmp rotate keeps it alive.`,
	);
	return 0;
}

export interface TokenState {
	readonly refreshedAt: Date;
	readonly nextRefreshAt: Date;
	readonly version: number;
	readonly accessExpiresAt: Date;
}

export interface BrandTokenStatus {
	readonly tenantSlug: string;
	readonly brandKey: string;
	readonly appStatus: string | null;
	readonly packageTier: string | null;
	readonly packageExpiresOn: string | null;
	readonly packageDaysLeft: number | null;
	readonly webhookMode: string | null;
	readonly oa: TokenState | null;
	readonly developer: TokenState | null;
	readonly openAlerts: number;
}

function tokenText(
	kind: TokenKind,
	state: TokenState | null,
	now: Date,
): string {
	if (state === null) {
		return `${KIND_LABEL[kind]} not stored`;
	}
	const age = (now.getTime() - state.refreshedAt.getTime()) / 1000;
	const accessLeft = (state.accessExpiresAt.getTime() - now.getTime()) / 1000;
	const refreshes = state.version - 1;
	return `${KIND_LABEL[kind]} ${formatDuration(age)} old, ${refreshes} ${kind === "oa" ? "refresh(es)" : "rotation(s)"} since stored, ${nextRefreshText(kind, state.nextRefreshAt, now)}, access ${accessLeft > 0 ? `valid ${formatDuration(accessLeft)}` : "expired"}`;
}

export function statusLines(
	brands: readonly BrandTokenStatus[],
	ci: boolean,
	now: Date,
): string[] {
	if (brands.length === 0) {
		return ["no brand is configured; add one with fnb zalo config set"];
	}
	return brands.map((brand, index) => {
		const label = brandLabel(ci, index, brand);
		const oaPart =
			brand.packageTier === null
				? "no OA"
				: `${tokenText("oa", brand.oa, now)}; package ${brand.packageTier}${brand.packageExpiresOn === null ? " without expiry date" : ` until ${brand.packageExpiresOn} (${brand.packageDaysLeft} days)`}; webhook ${brand.webhookMode}`;
		return `${label}: Zalo App ${brand.appStatus ?? "missing"}; ${oaPart}; ${tokenText("developer", brand.developer, now)}; ${brand.openAlerts} open zalo_token_failed episode(s)`;
	});
}

interface StatusRow {
	tenant_slug: string;
	brand_key: string;
	app_status: string | null;
	package_tier: string | null;
	package_expires_on: string | null;
	package_days_left: number | null;
	webhook_mode: string | null;
	oa_refreshed_at: Date | null;
	oa_next_refresh_at: Date | null;
	oa_version: string | null;
	oa_access_expires_at: Date | null;
	developer_refreshed_at: Date | null;
	developer_next_refresh_at: Date | null;
	developer_version: string | null;
	developer_access_expires_at: Date | null;
	open_alerts: number;
}

function tokenState(
	refreshedAt: Date | null,
	nextRefreshAt: Date | null,
	version: string | null,
	accessExpiresAt: Date | null,
): TokenState | null {
	if (
		refreshedAt === null ||
		nextRefreshAt === null ||
		version === null ||
		accessExpiresAt === null
	) {
		return null;
	}
	return {
		refreshedAt,
		nextRefreshAt,
		version: Number(version),
		accessExpiresAt,
	};
}

export async function brandTokenStatus(
	sql: Sql,
	tenantId: string | null,
	now: Date,
): Promise<BrandTokenStatus[]> {
	const rows = await sql<StatusRow[]>`
		select t.slug as tenant_slug, b.brand_key, z.status as app_status, o.package_tier,
			to_char(o.package_expires_on, 'YYYY-MM-DD') as package_expires_on,
			(o.package_expires_on - (${now.toISOString()}::timestamptz at time zone t.timezone)::date)::integer as package_days_left,
			o.webhook_mode,
			oa.refreshed_at as oa_refreshed_at, oa.refreshed_at + app.zalo_token_refresh_after('oa') as oa_next_refresh_at,
			oa.version::text as oa_version, oa.access_expires_at as oa_access_expires_at,
			dev.refreshed_at as developer_refreshed_at, dev.refreshed_at + app.zalo_token_refresh_after('developer') as developer_next_refresh_at,
			dev.version::text as developer_version, dev.access_expires_at as developer_access_expires_at,
			(
				select count(*)::integer
				from public.alert_events e
				where e.tenant_id = b.tenant_id
					and e.state = 'open'
					and e.dedupe_key in ('zalo_token_failed:oa:' || b.id::text, 'zalo_token_failed:developer:' || b.id::text)
			) as open_alerts
		from public.brands b
		join public.tenants t on t.id = b.tenant_id
		left join public.zalo_apps z on z.brand_id = b.id
		left join public.oas o on o.brand_id = b.id
		left join public.zalo_tokens oa on oa.brand_id = b.id and oa.kind = 'oa'
		left join public.zalo_tokens dev on dev.brand_id = b.id and dev.kind = 'developer'
		where ${tenantId}::uuid is null or b.tenant_id = ${tenantId}::uuid
		order by t.slug, b.brand_key
	`;
	return rows.map((row) => ({
		tenantSlug: row.tenant_slug,
		brandKey: row.brand_key,
		appStatus: row.app_status,
		packageTier: row.package_tier,
		packageExpiresOn: row.package_expires_on,
		packageDaysLeft: row.package_days_left,
		webhookMode: row.webhook_mode,
		oa: tokenState(
			row.oa_refreshed_at,
			row.oa_next_refresh_at,
			row.oa_version,
			row.oa_access_expires_at,
		),
		developer: tokenState(
			row.developer_refreshed_at,
			row.developer_next_refresh_at,
			row.developer_version,
			row.developer_access_expires_at,
		),
		openAlerts: row.open_alerts,
	}));
}

async function status(
	context: CommandContext,
	values: OptionValues,
): Promise<number> {
	const settings = jobSettings(context);
	const { sql } = context.services.db();
	const tenantId = await tenantFilter(
		context,
		sql,
		{ ...settings, integration: false },
		stringOption(values, "tenant"),
	);
	const now = context.now();
	for (const line of statusLines(
		await brandTokenStatus(sql, tenantId, now),
		context.output.ci,
		now,
	)) {
		context.output.line(line);
	}
	return 0;
}

const TARGET_OPTIONS = {
	tenant: { type: "string" },
	brand: { type: "string" },
} as const;

const SAFETY_DETAIL =
	"Tokens and secrets are never printed. On GitHub Actions every ZALO_ secret value of the environment is registered with ::add-mask:: first; with CI set brands are numbered.";

export const zaloTokenCommands: CommandSpec[] = [
	{
		path: ["zalo", "oa", "authorize"],
		summary: "Start the OA authorisation (OAuth v4 with PKCE) of a brand",
		usage:
			"fnb zalo oa authorize --tenant <slug> --brand <key> [--redirect-uri <zalo-oauth URL>]",
		options: {
			...HELP_OPTION,
			...TARGET_OPTIONS,
			"redirect-uri": { type: "string" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL), and SUPABASE_URL unless --redirect-uri or ZALO_OAUTH_REDIRECT_URI names the callback. Refused in CI.",
			"Creates a PKCE verifier, its S256 challenge and a state, keeps the verifier and the state's SHA-256 in a pending row closed to every API role for 10 minutes, and prints the OA permission URL.",
			"The callback, the zalo-oauth Edge Function, checks the state, exchanges the code once with the verifier and the App secret (ZALO_APP_SECRET_<BRAND>, a function secret) and stores the pair in zalo_tokens. A wrong, used or expired state is refused.",
			SAFETY_DETAIL,
		],
		run: authorize,
	},
	{
		path: ["zalo", "oa", "refresh"],
		summary: "Refresh every OA token older than 11 hours, one run at a time",
		usage: "fnb zalo oa refresh [--tenant <slug>] [--brand <key>]",
		options: { ...HELP_OPTION, ...TARGET_OPTIONS },
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL) and the App secret of each brand in its ZALO_APP_SECRET_<BRAND> variable.",
			"Each pair is refreshed under its single-row lock with the age checked again after the lock, so a second run at the same time reports the token fresh and exits 0. The new pair is written before anything else; after a lost answer the row is read again and the spent refresh token is never retried.",
			`A refusal by Zalo (such as -216, -220 or -224), a missing App secret, or no answer within ${UNANSWERED_ALERT_MARGIN_SECONDS / 3_600} hours of the access token's expiry raises zalo_token_failed; the run also raises oa_package_expiring 30 and 7 days before an OA package ends. Exit 1 when a brand failed.`,
			SAFETY_DETAIL,
		],
		run: (context, values) => runRefresh(context, values, "oa"),
	},
	{
		path: ["zalo", "zmp", "rotate"],
		summary: "Rotate every Mini App developer token older than 20 hours",
		usage: "fnb zalo zmp rotate [--tenant <slug>] [--brand <key>] [--force]",
		options: {
			...HELP_OPTION,
			...TARGET_OPTIONS,
			force: { type: "boolean" },
		},
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL) and each brand's ZALO_APP_SECRET_<BRAND>.",
			"The developer refresh token lives one month and changes at each use, so a daily rotation keeps it alive; --force rotates now whatever the age. Any failed rotation raises zalo_token_failed. Exit 1 when a brand failed.",
			SAFETY_DETAIL,
		],
		run: (context, values) => runRefresh(context, values, "developer"),
	},
	{
		path: ["zalo", "zmp", "seed"],
		summary: "Store a brand's first Mini App developer token pair",
		usage: `${ZMP_SEED_VARIABLE}=<refresh token> fnb zalo zmp seed --tenant <slug> --brand <key>`,
		options: { ...HELP_OPTION, ...TARGET_OPTIONS },
		details: [
			`Needs DATABASE_URL (or SUPABASE_DB_URL), the brand's ZALO_APP_SECRET_<BRAND> and ${ZMP_SEED_VARIABLE}, the developer refresh token, set for this one run only.`,
			"Rotates that refresh token once and stores the new pair, so the token given is spent and never kept; nothing is stored when Zalo refuses it.",
			SAFETY_DETAIL,
		],
		run: seedDeveloper,
	},
	{
		path: ["zalo", "status"],
		summary:
			"Show the token ages, next refreshes, OA packages and webhook modes",
		usage: "fnb zalo status [--tenant <slug>]",
		options: { ...HELP_OPTION, tenant: { type: "string" } },
		details: [
			"Needs DATABASE_URL (or SUPABASE_DB_URL).",
			"Per brand: the Zalo App state, the OA token's age, refreshes since it was stored, next refresh and access validity, the package and its expiry, the webhook mode, the developer token, and the open zalo_token_failed episodes.",
			"With CI set brands are numbered and only states are printed: no slug, id or secret name.",
		],
		run: status,
	},
];
