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
export const PAIRING_CODE_PATTERN = BINDING_CODE_PATTERN;
export const NOTICE_VERSION_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;
export const STAFF_LOGIN_DOMAIN = "zalo-staff.invalid";
export const UNPAIRED_REASONS = [
	"code_refused",
	"wait",
	"notice_outdated",
] as const;
export const LEGAL_TEXT_KINDS = ["privacy_notice", "mini_app_terms"] as const;
export const LEGAL_TEXT_LANGUAGES = ["vi", "en"] as const;
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

export type UnpairedReason = (typeof UNPAIRED_REASONS)[number];

export type LegalTextKind = (typeof LEGAL_TEXT_KINDS)[number];

export type LegalTextLanguage = (typeof LEGAL_TEXT_LANGUAGES)[number];

export interface LegalText {
	readonly kind: LegalTextKind;
	readonly language: LegalTextLanguage;
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
	readonly publishedAt: string;
}

export type TextsResult =
	| {
			readonly status: "texts";
			readonly documents: readonly LegalText[];
			readonly contact: string | null;
	  }
	| { readonly status: "wait"; readonly retryAfter: number };

export interface StaffNotice {
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
	readonly publishedAt: string;
}

export type SignInResult =
	| {
			readonly status: "unpaired";
			readonly notice?: StaffNotice;
			readonly reason?: UnpairedReason;
			readonly retryAfter?: number;
			readonly contact?: string;
	  }
	| {
			readonly status: "notice_required";
			readonly notice?: StaffNotice;
			readonly contact?: string;
	  }
	| { readonly status: "login_needed" }
	| {
			readonly status: "bound";
			readonly userId: string;
			readonly tenantId: string;
			readonly role: MemberRole;
			readonly storeIds: readonly string[] | null;
			readonly stores: readonly string[];
			readonly brandStoreIds?: readonly string[];
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

function parseNotice(value: unknown): StaffNotice | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (
		!isRecord(value) ||
		typeof value.version !== "string" ||
		!NOTICE_VERSION_PATTERN.test(value.version) ||
		typeof value.body_markdown !== "string"
	) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return {
		version: value.version,
		title: text(value.title),
		bodyMarkdown: value.body_markdown,
		publishedAt: text(value.published_at),
	};
}

function parseContact(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	return text(value);
}

function parseUnpaired(value: Readonly<Record<string, unknown>>): SignInResult {
	const notice = parseNotice(value.notice);
	const contact = parseContact(value.contact);
	const reason = UNPAIRED_REASONS.find((name) => name === value.reason);
	if (value.reason !== undefined && reason === undefined) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const retryAfter = value.retry_after;
	if (
		retryAfter !== undefined &&
		(typeof retryAfter !== "number" ||
			!Number.isInteger(retryAfter) ||
			retryAfter < 0)
	) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return {
		status: "unpaired",
		...(notice === undefined ? {} : { notice }),
		...(reason === undefined ? {} : { reason }),
		...(retryAfter === undefined ? {} : { retryAfter }),
		...(contact === undefined ? {} : { contact }),
	};
}

export function parseSignIn(value: unknown): SignInResult {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (value.status === "unpaired") {
		return parseUnpaired(value);
	}
	if (value.status === "notice_required") {
		const notice = parseNotice(value.notice);
		const contact = parseContact(value.contact);
		return {
			status: "notice_required",
			...(notice === undefined ? {} : { notice }),
			...(contact === undefined ? {} : { contact }),
		};
	}
	if (value.status === "login_needed") {
		return { status: "login_needed" };
	}
	if (value.status !== "bound") {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const role = MEMBER_ROLES.find((name) => name === value.role);
	if (role === undefined) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const displayName = value.display_name;
	const brandStoreIds =
		value.brand_store_ids === undefined
			? undefined
			: textList(value.brand_store_ids);
	return {
		status: "bound",
		userId: text(value.user_id),
		tenantId: text(value.tenant_id),
		role,
		storeIds: value.store_ids === null ? null : textList(value.store_ids),
		stores: textList(value.stores),
		...(brandStoreIds === undefined ? {} : { brandStoreIds }),
		displayName:
			typeof displayName === "string" && displayName.trim() !== ""
				? displayName
				: null,
	};
}

const LOGIN_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function staffLoginEmail(loginId: string): string {
	if (!LOGIN_ID_PATTERN.test(loginId)) {
		throw new Error("a staff login id is a lower-case UUID");
	}
	return `staff-${loginId}@${STAFF_LOGIN_DOMAIN}`;
}

export function noticeAnswer(notice: StaffNotice): Record<string, string> {
	return {
		version: notice.version,
		title: notice.title,
		body_markdown: notice.bodyMarkdown,
		published_at: notice.publishedAt,
	};
}

function parseLegalText(value: unknown): LegalText {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const kind = LEGAL_TEXT_KINDS.find((name) => name === value.kind);
	const language = LEGAL_TEXT_LANGUAGES.find((name) => name === value.language);
	if (
		kind === undefined ||
		language === undefined ||
		typeof value.version !== "string" ||
		!NOTICE_VERSION_PATTERN.test(value.version) ||
		typeof value.body_markdown !== "string"
	) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return {
		kind,
		language,
		version: value.version,
		title: text(value.title),
		bodyMarkdown: value.body_markdown,
		publishedAt: text(value.published_at),
	};
}

export function parseTexts(value: unknown): TextsResult {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (value.status === "wait") {
		const retryAfter = value.retry_after;
		if (
			typeof retryAfter !== "number" ||
			!Number.isInteger(retryAfter) ||
			retryAfter < 1
		) {
			throw new UpstreamError("supabase", "invalid_answer");
		}
		return { status: "wait", retryAfter };
	}
	if (value.status !== "texts" || !Array.isArray(value.documents)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return {
		status: "texts",
		documents: value.documents.map(parseLegalText),
		contact: parseContact(value.contact) ?? null,
	};
}

export function legalTextAnswer(document: LegalText): Record<string, string> {
	return {
		kind: document.kind,
		language: document.language,
		version: document.version,
		title: document.title,
		body_markdown: document.bodyMarkdown,
		published_at: document.publishedAt,
	};
}

export function bearerToken(header: string | null): string | null {
	if (header === null) {
		return null;
	}
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}

export const CUSTOMER_LOGIN_DOMAIN = "zalo-customer.invalid";
export const CUSTOMER_SESSION_KIND = "customer";
export const CUSTOMER_JOIN_REASONS = [
	"consent_required",
	"policy_outdated",
	"unknown_store",
	"phone_in_use",
] as const;

export type CustomerJoinReason = (typeof CUSTOMER_JOIN_REASONS)[number];

export type CustomerSignInResult =
	| { readonly status: "login_needed" }
	| {
			readonly status: "customer";
			readonly userId: string;
			readonly tenantId: string;
			readonly customerId: string | null;
			readonly displayName: string | null;
	  };

export type CustomerJoinResult =
	| {
			readonly status: "joined";
			readonly customerId: string;
			readonly membershipId: string;
			readonly welcomeStamps: number;
			readonly alreadyMember: boolean;
	  }
	| { readonly status: "refused"; readonly reason: CustomerJoinReason };

export function customerLoginEmail(loginId: string): string {
	if (!LOGIN_ID_PATTERN.test(loginId)) {
		throw new Error("a customer login id is a lower-case UUID");
	}
	return `customer-${loginId}@${CUSTOMER_LOGIN_DOMAIN}`;
}

export function customerAppMetadata(
	tenantId: string,
	customerId: string | null,
): Record<string, string | null> {
	return {
		kind: CUSTOMER_SESSION_KIND,
		tenant_id: tenantId,
		customer_id: customerId,
	};
}

export function parseCustomerSignIn(value: unknown): CustomerSignInResult {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (value.status === "login_needed") {
		return { status: "login_needed" };
	}
	if (value.status !== CUSTOMER_SESSION_KIND) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	const customerId = value.customer_id;
	const displayName = value.display_name;
	return {
		status: CUSTOMER_SESSION_KIND,
		userId: text(value.user_id),
		tenantId: text(value.tenant_id),
		customerId:
			customerId === null || customerId === undefined ? null : text(customerId),
		displayName:
			typeof displayName === "string" && displayName.trim() !== ""
				? displayName
				: null,
	};
}

export function parseCustomerJoin(value: unknown): CustomerJoinResult {
	if (!isRecord(value)) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	if (value.status === "refused") {
		const reason = CUSTOMER_JOIN_REASONS.find((name) => name === value.reason);
		if (reason === undefined) {
			throw new UpstreamError("supabase", "invalid_answer");
		}
		return { status: "refused", reason };
	}
	const welcome = value.welcome_stamps;
	if (
		value.status !== "joined" ||
		typeof welcome !== "number" ||
		!Number.isInteger(welcome) ||
		welcome < 0 ||
		typeof value.already_member !== "boolean"
	) {
		throw new UpstreamError("supabase", "invalid_answer");
	}
	return {
		status: "joined",
		customerId: text(value.customer_id),
		membershipId: text(value.membership_id),
		welcomeStamps: welcome,
		alreadyMember: value.already_member,
	};
}
