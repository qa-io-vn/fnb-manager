export const MEMBER_ROLES = [
	"owner",
	"manager",
	"staff",
	"viewer",
	"publisher",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface MemberProfile {
	readonly displayName: string;
	readonly role: MemberRole;
	readonly stores: readonly string[];
}

export interface StoredSession {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAt: number;
	readonly member: MemberProfile;
}

export type SessionFailure = "zalo" | "network" | "refused";

export type SessionState =
	| { readonly status: "connecting" }
	| { readonly status: "signed-in"; readonly session: StoredSession }
	| { readonly status: "unpaired"; readonly codeRejected: boolean }
	| { readonly status: "failed"; readonly reason: SessionFailure };

export interface SessionClient {
	connect(): Promise<SessionState>;
	bind(code: string): Promise<SessionState>;
	forget(): void;
}
