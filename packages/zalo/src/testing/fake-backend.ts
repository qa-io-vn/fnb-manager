import type { MintedSession, SupabaseBackend } from "../backend.js";
import { UpstreamError } from "../http.js";
import type { BrandApp, MemberRole } from "../session.js";

export interface FakeBrandApp extends BrandApp {
	readonly brandKey: string;
}

export interface FakeMember {
	readonly userId: string;
	readonly tenantId: string;
	readonly role: MemberRole;
	readonly storeIds: readonly string[] | null;
	readonly stores: readonly string[];
	readonly email: string | null;
}

export interface FakeIdentity {
	readonly zaloAppId: string;
	readonly zaloUserId: string;
	readonly userId: string;
	readonly displayName: string | null;
}

export type FakeBackendCall =
	| "rpc"
	| "userEmail"
	| "mintSession"
	| "sessionUser";

export interface FakeBackend extends SupabaseBackend {
	addApp(app: FakeBrandApp): void;
	addMember(member: FakeMember): void;
	removeMember(userId: string): void;
	bind(
		zaloAppId: string,
		zaloUserId: string,
		userId: string,
		displayName?: string | null,
	): void;
	issueCode(zaloAppId: string, userId: string, code: string): void;
	identities(): readonly FakeIdentity[];
	minted(): readonly MintedSession[];
	calls(): readonly string[];
	failNext(call: FakeBackendCall): void;
}

function identityKey(zaloAppId: string, zaloUserId: string): string {
	return `${zaloAppId}/${zaloUserId}`;
}

export function createFakeBackend(): FakeBackend {
	const apps: FakeBrandApp[] = [];
	const members = new Map<string, FakeMember>();
	const identities = new Map<string, FakeIdentity>();
	const codes = new Map<string, { zaloAppId: string; userId: string }>();
	const sessions = new Map<
		string,
		{ session: MintedSession; userId: string }
	>();
	const log: string[] = [];
	const failures = new Set<FakeBackendCall>();
	let counter = 0;

	const maybeFail = (call: FakeBackendCall): void => {
		if (failures.delete(call)) {
			throw new UpstreamError("supabase", "status", 503);
		}
	};

	const profile = (identity: FakeIdentity): Record<string, unknown> | null => {
		const member = members.get(identity.userId);
		const app = apps.find((entry) => entry.zaloAppId === identity.zaloAppId);
		if (
			member === undefined ||
			app === undefined ||
			member.tenantId !== app.tenantId
		) {
			return null;
		}
		return {
			status: "bound",
			user_id: member.userId,
			tenant_id: member.tenantId,
			role: member.role,
			store_ids: member.storeIds === null ? null : [...member.storeIds],
			stores: [...member.stores],
			display_name: identity.displayName,
		};
	};

	const signIn = (args: Readonly<Record<string, unknown>>): unknown => {
		const zaloAppId = String(args.p_zalo_app_id);
		const zaloUserId = String(args.p_zalo_user_id);
		const displayName =
			typeof args.p_display_name === "string" ? args.p_display_name : null;
		const code =
			typeof args.p_binding_code === "string" ? args.p_binding_code : null;
		const key = identityKey(zaloAppId, zaloUserId);
		const known = identities.get(key);
		if (known !== undefined) {
			const updated = {
				...known,
				displayName: displayName ?? known.displayName,
			};
			const answer = profile(updated);
			if (answer !== null) {
				identities.set(key, updated);
				return answer;
			}
		}
		const issued =
			code === null ? undefined : codes.get(`${zaloAppId}/${code}`);
		if (code === null || issued === undefined) {
			return { status: "unpaired" };
		}
		codes.delete(`${zaloAppId}/${code}`);
		const bound = { zaloAppId, zaloUserId, userId: issued.userId, displayName };
		identities.set(key, bound);
		return profile(bound) ?? { status: "unpaired" };
	};

	return {
		async rpc(name, args) {
			log.push(`rpc ${name}`);
			maybeFail("rpc");
			if (name === "zalo_session_app") {
				return apps
					.filter(
						(app) =>
							app.brandKey === args.p_brand_key &&
							(args.p_tenant_id === null || app.tenantId === args.p_tenant_id),
					)
					.slice(0, 2)
					.map((app) => ({
						tenant_id: app.tenantId,
						tenant_slug: app.tenantSlug,
						zalo_app_id: app.zaloAppId,
						secret_name: app.secretName,
						status: app.status,
					}));
			}
			if (name === "zalo_session_sign_in") {
				return signIn(args);
			}
			throw new UpstreamError("supabase", "status", 404);
		},
		async userEmail(userId) {
			log.push("userEmail");
			maybeFail("userEmail");
			const member = members.get(userId);
			return member === undefined ? undefined : member.email;
		},
		async mintSession(email) {
			log.push("mintSession");
			maybeFail("mintSession");
			const member = [...members.values()].find(
				(entry) => entry.email === email,
			);
			if (member === undefined) {
				throw new UpstreamError("supabase", "status", 404);
			}
			counter += 1;
			const session: MintedSession = {
				accessToken: `fake-session-access-${counter}`,
				refreshToken: `fake-session-refresh-${counter}`,
				expiresAt: 1_794_970_000 + counter,
			};
			sessions.set(session.accessToken, { session, userId: member.userId });
			return session;
		},
		async sessionUser(accessToken) {
			log.push("sessionUser");
			maybeFail("sessionUser");
			return sessions.get(accessToken)?.userId ?? null;
		},
		addApp(app) {
			apps.push(app);
		},
		addMember(member) {
			members.set(member.userId, member);
		},
		removeMember(userId) {
			members.delete(userId);
		},
		bind(zaloAppId, zaloUserId, userId, displayName = null) {
			identities.set(identityKey(zaloAppId, zaloUserId), {
				zaloAppId,
				zaloUserId,
				userId,
				displayName,
			});
		},
		issueCode(zaloAppId, userId, code) {
			codes.set(`${zaloAppId}/${code}`, { zaloAppId, userId });
		},
		identities() {
			return [...identities.values()];
		},
		minted() {
			return [...sessions.values()].map((entry) => entry.session);
		},
		calls() {
			return [...log];
		},
		failNext(call) {
			failures.add(call);
		},
	};
}
