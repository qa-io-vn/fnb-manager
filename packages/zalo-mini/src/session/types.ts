export const MEMBER_ROLES = [
	"owner",
	"manager",
	"staff",
	"viewer",
	"publisher",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const UNPAIRED_REASONS = [
	"code_refused",
	"wait",
	"notice_outdated",
] as const;

export type UnpairedReason = (typeof UNPAIRED_REASONS)[number];

export interface MemberProfile {
	readonly displayName: string;
	readonly role: MemberRole;
	readonly stores: readonly string[];
	readonly tenantId?: string;
}

export interface StaffNotice {
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
	readonly publishedAt: string;
}

export const LEGAL_DOCUMENT_KINDS = [
	"privacy_notice",
	"mini_app_terms",
] as const;

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export interface LegalDocument {
	readonly kind: LegalDocumentKind;
	readonly language: "vi" | "en";
	readonly version: string;
	readonly title: string;
	readonly bodyMarkdown: string;
	readonly publishedAt: string;
}

export interface PublishedTexts {
	readonly documents: readonly LegalDocument[];
	readonly contact: string | null;
}

export interface NoticeAcceptance {
	readonly version: string;
	readonly shownAt: number;
}

export interface StoredSession {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: number;
	readonly member: MemberProfile;
}

export type SessionFailure = "zalo" | "network" | "refused";

export type SessionState =
	| { readonly status: "new" }
	| { readonly status: "connecting" }
	| { readonly status: "signed-in"; readonly session: StoredSession }
	| {
			readonly status: "unpaired";
			readonly codeRejected: boolean;
			readonly notice?: StaffNotice;
			readonly reason?: UnpairedReason;
			readonly retryAfterSeconds?: number;
			readonly contact?: string;
	  }
	| {
			readonly status: "notice-required";
			readonly notice: StaffNotice | null;
			readonly contact?: string;
	  }
	| { readonly status: "failed"; readonly reason: SessionFailure };

export interface SessionClient {
	connect(): Promise<SessionState>;
	start(): Promise<SessionState>;
	bind(code: string): Promise<SessionState>;
	pair(code: string, acceptance: NoticeAcceptance): Promise<SessionState>;
	acceptNotice(acceptance: NoticeAcceptance): Promise<SessionState>;
	texts(): Promise<PublishedTexts | null>;
	forget(): void;
}
