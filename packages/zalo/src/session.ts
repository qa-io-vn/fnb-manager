import type { SupabaseBackend } from "./backend.js";
import { isRecord, UpstreamError } from "./http.js";
import { ZaloRefusal } from "./refusal.js";
import {
	isFixtureTenantSlug,
	ZALO_FIXTURE_SLUG_PREFIX,
	ZALO_INTEGRATION_VARIABLE,
	ZALO_TENANT_VARIABLE,
	type ZaloSettings,
} from "./settings.js";

export const BRAND_KEY_PATTERN = /^brand-[1-9][0-9]{0,2}$/;
export const BINDING_CODE_PATTERN = /^[0-9]{6}$/;
export const MEMBER_ROLES = [
	"owner",
	"manager",
	"staff",
	"viewer",
	"publisher",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface BrandApp {
	readonly tenantId: string;
	readonly tenantSlug: string;
	readonly zaloAppId: string;
	readonly secretName: string;
	readonly status: string;
}

export type SignInResult =
	| { readonly status: "unpaired" }
	| {
			readonly status: "bound";
			readonly userId: string;
			readonly tenantId: string;
			readonly role: MemberRole;
			readonly storeIds: readonly string[] | null;
			readonly stores: readonly string[];
			readonly displayName: string | null;
	  };

function text(value: unknown): string {
	if (typeof value !== "string" || value === "") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value;
}

function textList(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value;
}

export function parseBrandApps(value: unknown): BrandApp[] {
	if (!Array.isArray(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return value.map((row) => {
		if (!isRecord(row)) {
			throw new UpstreamError("supabase", "invalid_answer");
		}
		return {
			tenantId: text(row.tenant_id),
			tenantSlug: text(row.tenant_slug),
			zaloAppId: text(row.zalo_app_id),
			secretName: text(row.secret_name),
			status: text(row.status),
		};
	});
}

export async function requireBrandApp(
	backend: SupabaseBackend,
	settings: ZaloSettings,
	brandKey: string,
): Promise<BrandApp> {
	const apps = parseBrandApps(
		await backend.rpc("zalo_session_app", {
			p_brand_key: brandKey,
			p_tenant_id: settings.tenantId,
		}),
	);
	const [app] = apps;
	if (app === undefined) {
		throw new ZaloRefusal(
			404,
			"unknown_brand",
			"no Zalo App is configured for the brand",
		);
	}
	if (apps.length > 1) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			`the brand key names Zalo Apps of more than one tenant; set ${ZALO_TENANT_VARIABLE}`,
		);
	}
	if (settings.integration && !isFixtureTenantSlug(app.tenantSlug)) {
		throw new ZaloRefusal(
			500,
			"not_configured",
			`${ZALO_INTEGRATION_VARIABLE}=1 serves only ${ZALO_FIXTURE_SLUG_PREFIX} fixture tenants`,
		);
	}
	if (app.status !== "active") {
		throw new ZaloRefusal(
			403,
			"app_disabled",
			"the brand's Zalo App is disabled",
		);
	}
	return app;
}

export function parseSignIn(value: unknown): SignInResult {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (value.status === "unpaired") {
		return { status: "unpaired" };
	}
	if (value.status !== "bound") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const role = MEMBER_ROLES.find((name) => name === value.role);
	if (role === undefined) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const displayName = value.display_name;
	return {
		status: "bound",
		userId: text(value.user_id),
		tenantId: text(value.tenant_id),
		role,
		storeIds: value.store_ids === null ? null : textList(value.store_ids),
		stores: textList(value.stores),
		displayName:
			typeof displayName === "string" && displayName.trim() !== ""
				? displayName
				: null,
	};
}

export function bearerToken(header: string | null): string | null {
	if (header === null) {
		return null;
	}
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}
