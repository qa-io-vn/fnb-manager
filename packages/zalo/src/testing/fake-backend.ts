import type { MintedSession, SupabaseBackend } from "../backend.js";
import { UpstreamError } from "../http.js";
import {
	type BrandApp,
	type LegalText,
	legalTextAnswer,
	type MemberRole,
	type StaffNotice,
} from "../session.js";

export interface FakeBrandApp extends BrandApp {
	readonly brandKey: string;
}

export interface FakeMember {
	readonly userId: string;
	readonly tenantId: string;
	readonly role: MemberRole;
	readonly storeIds: readonly string[] | null;
	readonly stores: readonly string[];
	readonly brandStoreIds?: readonly string[];
	readonly email: string | null;
}

export interface FakeIdentity {
	readonly zaloAppId: string;
	readonly zaloUserId: string;
	readonly userId: string;
	readonly displayName: string | null;
}

export interface FakeRosterEntry {
	readonly id: string;
	readonly tenantId: string;
	readonly role: "staff" | "manager";
	readonly storeIds: readonly string[] | null;
	readonly stores: readonly string[];
	readonly status: "invited" | "active" | "inactive";
	readonly userId: string | null;
}

export interface FakeConsent {
	readonly tenantId: string;
	readonly userId: string;
	readonly version: string;
	readonly active: boolean;
}

export interface FakeLogin {
	readonly userId: string;
	readonly email: string;
}

export interface FakeCustomer {
	readonly customerId: string;
	readonly tenantId: string;
	readonly zaloAppId: string;
	readonly zaloUserId: string;
	readonly phone: string;
	readonly displayName: string | null;
}

export interface FakeCustomerConsent {
	readonly customerId: string;
	readonly purpose: "loyalty" | "marketing";
	readonly policyVersion: string;
	readonly screenVersion: string;
	readonly shownAt: string;
	readonly channel: "mini_app";
	readonly active: boolean;
}

export const FAKE_PAIRING_ATTEMPTS = 5;
export const FAKE_WELCOME_STAMPS = 1;
export const FAKE_PAIRING_WAIT_SECONDS = 900;

export type FakeBackendCall =
	| "rpc"
	| "userEmail"
	| "mintSession"
	| "sessionUser"
	| "createLogin"
	| "setAppMetadata"
	| "deleteLogin";

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
	publishNotice(tenantId: string, notice: StaffNotice | null): void;
	publishTexts(tenantId: string, documents: readonly LegalText[]): void;
	setContact(tenantId: string, contact: string | null): void;
	holdTexts(zaloAppId: string, retryAfter: number | null): void;
	addRosterEntry(entry: FakeRosterEntry): void;
	rosterEntry(id: string): FakeRosterEntry | undefined;
	issuePairingCode(rosterId: string, code: string): void;
	pairingCodeFailures(rosterId: string): number | undefined;
	giveConsent(tenantId: string, userId: string, version: string): void;
	withdrawConsent(tenantId: string, userId: string): void;
	consents(): readonly FakeConsent[];
	logins(): readonly FakeLogin[];
	deletedLogins(): readonly string[];
	identities(): readonly FakeIdentity[];
	minted(): readonly MintedSession[];
	calls(): readonly string[];
	failNext(call: FakeBackendCall): void;
	addCustomerStore(tenantId: string, code: string): void;
	setCustomerPolicy(tenantId: string, version: string): void;
	closeCustomerProgramme(tenantId: string): void;
	customers(): readonly FakeCustomer[];
	customerConsents(): readonly FakeCustomerConsent[];
	appMetadataOf(userId: string): Readonly<Record<string, unknown>> | undefined;
	/** The relay address zalo_relay_current answers (ADR-057), as if announced now. */
	setRelay(url: string | null): void;
	/** The last stored relay announcement. */
	relay(): { readonly url: string; readonly at: string } | null;
}

interface PairingCode {
	readonly tenantId: string;
	readonly rosterId: string;
	failures: number;
}

function identityKey(zaloAppId: string, zaloUserId: string): string {
	return `${zaloAppId}/${zaloUserId}`;
}

function textArg(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

export function createFakeBackend(): FakeBackend {
	let relay: { url: string; at: string } | null = null;
	const apps: FakeBrandApp[] = [];
	const members = new Map<string, FakeMember>();
	const identities = new Map<string, FakeIdentity>();
	const codes = new Map<string, { zaloAppId: string; userId: string }>();
	const notices = new Map<string, StaffNotice>();
	const texts = new Map<string, readonly LegalText[]>();
	const contacts = new Map<string, string>();
	const heldTexts = new Map<string, number>();
	const roster = new Map<string, FakeRosterEntry>();
	const pairingCodes = new Map<string, PairingCode>();
	const attempts = new Map<string, number>();
	const consents: FakeConsent[] = [];
	const logins = new Map<string, FakeLogin>();
	const deleted: string[] = [];
	const sessions = new Map<
		string,
		{ session: MintedSession; userId: string }
	>();
	const log: string[] = [];
	const failures = new Set<FakeBackendCall>();
	const customerLogins = new Map<
		string,
		{ userId: string; displayName: string | null }
	>();
	const customers = new Map<string, FakeCustomer>();
	const customerConsents: FakeCustomerConsent[] = [];
	const customerStores = new Map<string, Set<string>>();
	const customerPolicies = new Map<string, string>();
	const closedProgrammes = new Set<string>();
	const metadata = new Map<string, Readonly<Record<string, unknown>>>();
	let customerCounter = 0;
	let counter = 0;
	let loginCounter = 0;

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
			brand_store_ids: [...(member.brandStoreIds ?? member.storeIds ?? [])],
			display_name: identity.displayName,
		};
	};

	const noticeOf = (tenantId: string): Record<string, unknown> => {
		const notice = notices.get(tenantId);
		return notice === undefined
			? {}
			: {
					notice: {
						version: notice.version,
						title: notice.title,
						body_markdown: notice.bodyMarkdown,
						published_at: notice.publishedAt,
					},
				};
	};

	const contactOf = (tenantId: string): Record<string, unknown> => {
		const contact = contacts.get(tenantId);
		return contact === undefined ? {} : { contact };
	};

	const unpaired = (
		tenantId: string,
		reason?: string,
		retryAfter?: number,
	): Record<string, unknown> => ({
		status: "unpaired",
		...(reason === undefined ? {} : { reason }),
		...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
		...noticeOf(tenantId),
		...contactOf(tenantId),
	});

	const textsOf = (args: Readonly<Record<string, unknown>>): unknown => {
		const app = appOf(String(args.p_zalo_app_id));
		if (app.status !== "active") {
			throw new UpstreamError("supabase", "status", 400);
		}
		const held = heldTexts.get(app.zaloAppId);
		if (held !== undefined) {
			return { status: "wait", retry_after: held };
		}
		return {
			status: "texts",
			documents: (texts.get(app.tenantId) ?? []).map(legalTextAnswer),
			contact: contacts.get(app.tenantId) ?? null,
		};
	};

	const activeConsent = (tenantId: string, userId: string) =>
		consents.find(
			(consent) =>
				consent.active &&
				consent.tenantId === tenantId &&
				consent.userId === userId,
		);

	const acceptanceValid = (
		tenantId: string,
		version: string | null,
		shownAt: string | null,
	): boolean =>
		version !== null &&
		shownAt !== null &&
		notices.get(tenantId)?.version === version;

	const recordConsent = (
		tenantId: string,
		userId: string,
		version: string,
	): void => {
		const active = activeConsent(tenantId, userId);
		if (active?.version === version) {
			return;
		}
		if (active !== undefined) {
			consents.splice(consents.indexOf(active), 1, {
				...active,
				active: false,
			});
		}
		consents.push({ tenantId, userId, version, active: true });
	};

	const gate = (
		tenantId: string,
		userId: string,
		version: string | null,
		shownAt: string | null,
	): Record<string, unknown> | null => {
		const onRoster = [...roster.values()].some(
			(entry) => entry.tenantId === tenantId && entry.userId === userId,
		);
		if (!onRoster) {
			return null;
		}
		const active = activeConsent(tenantId, userId);
		const published = notices.get(tenantId);
		if (
			active !== undefined &&
			(published === undefined || published.version === active.version)
		) {
			return null;
		}
		if (version !== null && acceptanceValid(tenantId, version, shownAt)) {
			recordConsent(tenantId, userId, version);
			return null;
		}
		return {
			status: "notice_required",
			...noticeOf(tenantId),
			...contactOf(tenantId),
		};
	};

	const boundIdentity = (
		key: string,
		displayName: string | null,
		tenantId: string,
		version: string | null,
		shownAt: string | null,
	): Record<string, unknown> | null => {
		const known = identities.get(key);
		if (known === undefined) {
			return null;
		}
		const updated = {
			...known,
			displayName: displayName ?? known.displayName,
		};
		const answer = profile(updated);
		if (answer === null) {
			return null;
		}
		identities.set(key, updated);
		return gate(tenantId, updated.userId, version, shownAt) ?? answer;
	};

	const appOf = (zaloAppId: string): FakeBrandApp => {
		const app = apps.find((entry) => entry.zaloAppId === zaloAppId);
		if (app === undefined) {
			throw new UpstreamError("supabase", "status", 400);
		}
		return app;
	};

	const signIn = (args: Readonly<Record<string, unknown>>): unknown => {
		const zaloAppId = String(args.p_zalo_app_id);
		const zaloUserId = String(args.p_zalo_user_id);
		const displayName = textArg(args.p_display_name);
		const code = textArg(args.p_binding_code);
		const app = appOf(zaloAppId);
		const key = identityKey(zaloAppId, zaloUserId);
		const known = boundIdentity(key, displayName, app.tenantId, null, null);
		if (known !== null) {
			return known;
		}
		const issued =
			code === null ? undefined : codes.get(`${zaloAppId}/${code}`);
		if (code === null || issued === undefined) {
			return unpaired(app.tenantId);
		}
		codes.delete(`${zaloAppId}/${code}`);
		const bound = { zaloAppId, zaloUserId, userId: issued.userId, displayName };
		identities.set(key, bound);
		const answer = profile(bound);
		if (answer === null) {
			return unpaired(app.tenantId);
		}
		return gate(app.tenantId, bound.userId, null, null) ?? answer;
	};

	const pair = (args: Readonly<Record<string, unknown>>): unknown => {
		const zaloAppId = String(args.p_zalo_app_id);
		const zaloUserId = String(args.p_zalo_user_id);
		const displayName = textArg(args.p_display_name);
		const code = textArg(args.p_code);
		const version = textArg(args.p_notice_version);
		const shownAt = textArg(args.p_notice_shown_at);
		const newUserId = textArg(args.p_new_user_id);
		const app = appOf(zaloAppId);
		const tenantId = app.tenantId;
		const key = identityKey(zaloAppId, zaloUserId);
		const known = boundIdentity(key, displayName, tenantId, version, shownAt);
		if (known !== null) {
			return known;
		}
		if (code === null) {
			return unpaired(tenantId);
		}
		if ((attempts.get(key) ?? 0) >= FAKE_PAIRING_ATTEMPTS) {
			return unpaired(tenantId, "wait", FAKE_PAIRING_WAIT_SECONDS);
		}
		if (!acceptanceValid(tenantId, version, shownAt) || version === null) {
			return unpaired(tenantId, "notice_outdated");
		}
		const codeKey = `${tenantId}/${code}`;
		const pairing = pairingCodes.get(codeKey);
		const entry =
			pairing === undefined ? undefined : roster.get(pairing.rosterId);
		const current =
			entry?.userId === null || entry === undefined
				? undefined
				: members.get(entry.userId);
		if (
			pairing !== undefined &&
			(entry === undefined ||
				entry.status === "inactive" ||
				(current !== undefined &&
					current.tenantId === tenantId &&
					current.role !== "staff" &&
					current.role !== "manager"))
		) {
			pairingCodes.delete(codeKey);
		} else if (pairing !== undefined && entry !== undefined) {
			let userId = entry.userId;
			if (userId === null) {
				if (newUserId === null) {
					return { status: "login_needed" };
				}
				const fresh =
					logins.has(newUserId) &&
					!members.has(newUserId) &&
					![...roster.values()].some((row) => row.userId === newUserId);
				if (!fresh) {
					throw new UpstreamError("supabase", "status", 400);
				}
				userId = newUserId;
			}
			recordConsent(tenantId, userId, version);
			members.set(userId, {
				userId,
				tenantId,
				role: entry.role,
				storeIds: entry.storeIds,
				stores: entry.stores,
				email: logins.get(userId)?.email ?? members.get(userId)?.email ?? null,
			});
			const bound = { zaloAppId, zaloUserId, userId, displayName };
			identities.set(key, bound);
			roster.set(entry.id, { ...entry, userId, status: "active" });
			pairingCodes.delete(codeKey);
			attempts.delete(key);
			return profile(bound);
		}
		const issued = codes.get(`${zaloAppId}/${code}`);
		if (issued !== undefined) {
			codes.delete(`${zaloAppId}/${code}`);
			const bound = {
				zaloAppId,
				zaloUserId,
				userId: issued.userId,
				displayName,
			};
			identities.set(key, bound);
			attempts.delete(key);
			const answer = profile(bound);
			if (answer === null) {
				return unpaired(tenantId);
			}
			return gate(tenantId, bound.userId, version, shownAt) ?? answer;
		}
		for (const [live, value] of pairingCodes) {
			if (value.tenantId !== tenantId) {
				continue;
			}
			if (value.failures >= FAKE_PAIRING_ATTEMPTS) {
				pairingCodes.delete(live);
			} else {
				value.failures += 1;
			}
		}
		const failed = (attempts.get(key) ?? 0) + 1;
		attempts.set(key, failed);
		return failed >= FAKE_PAIRING_ATTEMPTS
			? unpaired(tenantId, "wait", FAKE_PAIRING_WAIT_SECONDS)
			: unpaired(tenantId, "code_refused");
	};

	const customerOf = (userId: string): FakeCustomer | undefined =>
		[...customers.values()].find(
			(customer) =>
				customerLogins.get(identityKey(customer.zaloAppId, customer.zaloUserId))
					?.userId === userId,
		);

	const customerAnswer = (
		tenantId: string,
		userId: string,
		displayName: string | null,
	): Record<string, unknown> => ({
		status: "customer",
		user_id: userId,
		tenant_id: tenantId,
		customer_id: customerOf(userId)?.customerId ?? null,
		display_name: displayName,
	});

	const customerSignIn = (args: Readonly<Record<string, unknown>>): unknown => {
		const app = appOf(String(args.p_zalo_app_id));
		const key = identityKey(app.zaloAppId, String(args.p_zalo_user_id));
		const displayName = textArg(args.p_display_name);
		const known = customerLogins.get(key);
		if (known !== undefined) {
			const updated = {
				...known,
				displayName: displayName ?? known.displayName,
			};
			customerLogins.set(key, updated);
			return customerAnswer(app.tenantId, updated.userId, updated.displayName);
		}
		const newUserId = textArg(args.p_new_user_id);
		if (newUserId === null) {
			return { status: "login_needed" };
		}
		if (!logins.has(newUserId) || members.has(newUserId)) {
			throw new UpstreamError("supabase", "status", 400);
		}
		customerLogins.set(key, { userId: newUserId, displayName });
		return customerAnswer(app.tenantId, newUserId, displayName);
	};

	const customerJoin = (args: Readonly<Record<string, unknown>>): unknown => {
		const app = appOf(String(args.p_zalo_app_id));
		const zaloUserId = String(args.p_zalo_user_id);
		const key = identityKey(app.zaloAppId, zaloUserId);
		const login = customerLogins.get(key);
		if (login === undefined || login.userId !== args.p_user_id) {
			throw new UpstreamError("supabase", "status", 400);
		}
		if (args.p_loyalty_consent !== true) {
			return { status: "refused", reason: "consent_required" };
		}
		const policy = customerPolicies.get(app.tenantId);
		if (policy === undefined || args.p_policy_version !== policy) {
			return { status: "refused", reason: "policy_outdated" };
		}
		const store = textArg(args.p_store_code);
		if (
			store !== null &&
			!(customerStores.get(app.tenantId)?.has(store) ?? false)
		) {
			return { status: "refused", reason: "unknown_store" };
		}
		if (closedProgrammes.has(app.tenantId)) {
			return { status: "refused", reason: "no_programme" };
		}
		const phone = String(args.p_phone);
		const holder = [...customers.values()].find(
			(customer) =>
				customer.tenantId === app.tenantId && customer.phone === phone,
		);
		if (holder !== undefined && holder.zaloUserId !== zaloUserId) {
			return { status: "refused", reason: "phone_in_use" };
		}
		const already = holder ?? customerOf(login.userId);
		customerCounter += already === undefined ? 1 : 0;
		const customerId =
			already?.customerId ??
			`00000000-0000-4000-9000-${String(customerCounter).padStart(12, "0")}`;
		customers.set(customerId, {
			customerId,
			tenantId: app.tenantId,
			zaloAppId: app.zaloAppId,
			zaloUserId,
			phone,
			displayName: textArg(args.p_display_name),
		});
		if (already === undefined) {
			const evidence = {
				customerId,
				policyVersion: String(args.p_policy_version),
				screenVersion: String(args.p_screen_version),
				shownAt: String(args.p_shown_at),
				channel: "mini_app" as const,
				active: true,
			};
			customerConsents.push({ ...evidence, purpose: "loyalty" });
			if (args.p_marketing_consent === true) {
				customerConsents.push({ ...evidence, purpose: "marketing" });
			}
		}
		return {
			status: "joined",
			customer_id: customerId,
			membership_id: customerId.replace("-9000-", "-a000-"),
			welcome_stamps: already === undefined ? FAKE_WELCOME_STAMPS : 0,
			already_member: already !== undefined,
		};
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
			if (name === "zalo_session_pair") {
				return pair(args);
			}
			if (name === "zalo_session_texts") {
				return textsOf(args);
			}
			if (name === "zalo_customer_sign_in") {
				return customerSignIn(args);
			}
			if (name === "customer_join") {
				return customerJoin(args);
			}
			if (name === "zalo_relay_current") {
				return relay?.url ?? null;
			}
			if (name === "zalo_relay_announce") {
				const url = textArg(args.p_url);
				const at = textArg(args.p_at);
				if (url === null || at === null) {
					throw new UpstreamError("supabase", "status", 400);
				}
				if (relay !== null && Date.parse(relay.at) >= Date.parse(at)) {
					return false;
				}
				relay = { url, at };
				return true;
			}
			throw new UpstreamError("supabase", "status", 404);
		},
		async userEmail(userId) {
			log.push("userEmail");
			maybeFail("userEmail");
			const member = members.get(userId);
			if (member !== undefined) {
				return member.email;
			}
			return logins.get(userId)?.email;
		},
		async mintSession(email) {
			log.push("mintSession");
			maybeFail("mintSession");
			const member =
				[...members.values()].find((entry) => entry.email === email) ??
				[...logins.values()].find((entry) => entry.email === email);
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
		async createLogin(email, appMetadata) {
			log.push("createLogin");
			maybeFail("createLogin");
			loginCounter += 1;
			const userId = `00000000-0000-4000-8000-${String(loginCounter).padStart(12, "0")}`;
			logins.set(userId, { userId, email });
			if (appMetadata !== undefined) {
				metadata.set(userId, { ...appMetadata });
			}
			return userId;
		},
		async setAppMetadata(userId, appMetadata) {
			log.push("setAppMetadata");
			maybeFail("setAppMetadata");
			if (!logins.has(userId) && !members.has(userId)) {
				throw new UpstreamError("supabase", "status", 404);
			}
			metadata.set(userId, { ...metadata.get(userId), ...appMetadata });
		},
		async deleteLogin(userId) {
			log.push("deleteLogin");
			maybeFail("deleteLogin");
			logins.delete(userId);
			deleted.push(userId);
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
		publishNotice(tenantId, notice) {
			if (notice === null) {
				notices.delete(tenantId);
			} else {
				notices.set(tenantId, notice);
			}
		},
		publishTexts(tenantId, documents) {
			texts.set(tenantId, [...documents]);
		},
		setContact(tenantId, contact) {
			if (contact === null) {
				contacts.delete(tenantId);
			} else {
				contacts.set(tenantId, contact);
			}
		},
		holdTexts(zaloAppId, retryAfter) {
			if (retryAfter === null) {
				heldTexts.delete(zaloAppId);
			} else {
				heldTexts.set(zaloAppId, retryAfter);
			}
		},
		addRosterEntry(entry) {
			roster.set(entry.id, entry);
		},
		rosterEntry(id) {
			return roster.get(id);
		},
		issuePairingCode(rosterId, code) {
			const entry = roster.get(rosterId);
			if (entry === undefined) {
				throw new Error("no such roster entry");
			}
			for (const [live, value] of pairingCodes) {
				if (value.rosterId === rosterId) {
					pairingCodes.delete(live);
				}
			}
			pairingCodes.set(`${entry.tenantId}/${code}`, {
				tenantId: entry.tenantId,
				rosterId,
				failures: 0,
			});
		},
		pairingCodeFailures(rosterId) {
			return [...pairingCodes.values()].find(
				(value) => value.rosterId === rosterId,
			)?.failures;
		},
		giveConsent(tenantId, userId, version) {
			recordConsent(tenantId, userId, version);
		},
		withdrawConsent(tenantId, userId) {
			const active = activeConsent(tenantId, userId);
			if (active !== undefined) {
				consents.splice(consents.indexOf(active), 1, {
					...active,
					active: false,
				});
			}
			for (const [key, identity] of identities) {
				const app = apps.find(
					(entry) => entry.zaloAppId === identity.zaloAppId,
				);
				if (identity.userId === userId && app?.tenantId === tenantId) {
					identities.delete(key);
				}
			}
		},
		consents() {
			return [...consents];
		},
		logins() {
			return [...logins.values()];
		},
		deletedLogins() {
			return [...deleted];
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
		addCustomerStore(tenantId, code) {
			const stores = customerStores.get(tenantId) ?? new Set<string>();
			stores.add(code);
			customerStores.set(tenantId, stores);
		},
		setCustomerPolicy(tenantId, version) {
			customerPolicies.set(tenantId, version);
		},
		closeCustomerProgramme(tenantId) {
			closedProgrammes.add(tenantId);
		},
		customers() {
			return [...customers.values()];
		},
		customerConsents() {
			return [...customerConsents];
		},
		appMetadataOf(userId) {
			return metadata.get(userId);
		},
		setRelay(url) {
			relay = url === null ? null : { url, at: new Date().toISOString() };
		},
		relay() {
			return relay;
		},
	};
}
