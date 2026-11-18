import { describe, expect, it } from "vitest";
import { createSupabaseBackend, serviceKeyFrom } from "../../src/backend.js";
import {
	UpstreamError,
	type ZaloFetch,
	type ZaloRequestInit,
} from "../../src/http.js";
import {
	legalTextAnswer,
	noticeAnswer,
	parseSignIn,
	parseTexts,
	requireBrandApp,
	STAFF_LOGIN_DOMAIN,
	staffLoginEmail,
} from "../../src/session.js";
import { zaloSettings } from "../../src/settings.js";
import { createFakeBackend } from "../../src/testing/fake-backend.js";

const URL_BASE = "http://127.0.0.1:54321";
const SECRET_KEY = "sb_secret_test";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface Call {
	readonly url: string;
	readonly init: ZaloRequestInit;
}

function scripted(answers: readonly Response[]) {
	const calls: Call[] = [];
	let index = 0;
	const send: ZaloFetch = async (url, init) => {
		calls.push({ url, init });
		const answer = answers[index];
		index += 1;
		if (answer === undefined) {
			throw new Error("no scripted answer left");
		}
		return answer;
	};
	return { send, calls };
}

describe("the service key", () => {
	it("prefers the default secret key, then any secret key, then the legacy key", () => {
		expect(
			serviceKeyFrom({
				SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_a" }),
				SUPABASE_SERVICE_ROLE_KEY: "legacy",
			}),
		).toBe("sb_secret_a");
		expect(
			serviceKeyFrom({
				SUPABASE_SECRET_KEYS: JSON.stringify({ other: "sb_secret_b" }),
			}),
		).toBe("sb_secret_b");
		expect(serviceKeyFrom({ SUPABASE_SERVICE_ROLE_KEY: "legacy" })).toBe(
			"legacy",
		);
		expect(serviceKeyFrom({ SUPABASE_SECRET_KEYS: "not json" })).toBeNull();
		expect(serviceKeyFrom({})).toBeNull();
	});
});

describe("Supabase calls of the sign-in functions", () => {
	it("calls an RPC with the secret key as apikey only", async () => {
		const { send, calls } = scripted([Response.json([{ ok: 1 }])]);
		const backend = createSupabaseBackend({
			url: `${URL_BASE}/`,
			key: SECRET_KEY,
			fetch: send,
		});
		expect(
			await backend.rpc("zalo_session_app", { p_brand_key: "brand-1" }),
		).toEqual([{ ok: 1 }]);
		expect(calls[0]?.url).toBe(`${URL_BASE}/rest/v1/rpc/zalo_session_app`);
		expect(calls[0]?.init.headers).toEqual({
			apikey: SECRET_KEY,
			"content-type": "application/json",
		});
		expect(JSON.parse(calls[0]?.init.body ?? "")).toEqual({
			p_brand_key: "brand-1",
		});
	});

	it("adds the bearer header for a legacy service-role key", async () => {
		const { send, calls } = scripted([Response.json({})]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: "legacy.jwt.value",
			fetch: send,
		});
		await backend.rpc("zalo_session_sign_in", {});
		expect(calls[0]?.init.headers.authorization).toBe(
			"Bearer legacy.jwt.value",
		);
	});

	it("reports an RPC error by status without the key or the body", async () => {
		const { send } = scripted([
			new Response(`{"message": "permission denied ${SECRET_KEY}"}`, {
				status: 401,
			}),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		const error = await backend
			.rpc("zalo_session_app", {})
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(UpstreamError);
		expect(String(error)).toBe(
			"UpstreamError: the Supabase API answered with an HTTP error (HTTP 401)",
		);
	});

	it("finds a login's e-mail through the Auth admin API", async () => {
		const { send, calls } = scripted([
			Response.json({ id: USER_ID, email: "member@example.com" }),
			Response.json({ id: USER_ID, email: "" }),
			Response.json({ message: "User not found" }, { status: 404 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		expect(await backend.userEmail(USER_ID)).toBe("member@example.com");
		expect(await backend.userEmail(USER_ID)).toBeNull();
		expect(await backend.userEmail(USER_ID)).toBeUndefined();
		expect(calls[0]?.url).toBe(`${URL_BASE}/auth/v1/admin/users/${USER_ID}`);
		expect(calls[0]?.init.method).toBe("GET");
	});

	it("mints a genuine session with a magic-link token the Auth server verifies", async () => {
		const { send, calls } = scripted([
			Response.json({
				id: USER_ID,
				hashed_token: "hashed-synthetic",
				verification_type: "magiclink",
			}),
			Response.json({
				access_token: "session-access",
				refresh_token: "session-refresh",
				expires_at: 1794970000,
			}),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		expect(await backend.mintSession("member@example.com")).toEqual({
			accessToken: "session-access",
			refreshToken: "session-refresh",
			expiresAt: 1794970000,
		});
		expect(
			calls.map((call) => [call.url, JSON.parse(call.init.body ?? "{}")]),
		).toEqual([
			[
				`${URL_BASE}/auth/v1/admin/generate_link`,
				{ type: "magiclink", email: "member@example.com" },
			],
			[
				`${URL_BASE}/auth/v1/verify`,
				{ type: "magiclink", token_hash: "hashed-synthetic" },
			],
		]);
	});

	it("refuses a session answer without its tokens", async () => {
		const { send } = scripted([
			Response.json({ properties: { hashed_token: "hashed-synthetic" } }),
			Response.json({ access_token: "session-access", expires_at: 1 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		await expect(
			backend.mintSession("member@example.com"),
		).rejects.toMatchObject({
			failure: "invalid_answer",
		});
	});

	it("creates a confirmed login without a password and removes it again", async () => {
		const { send, calls } = scripted([
			Response.json({ id: USER_ID, email: "staff-x@example.com" }),
			new Response("{}", { status: 200 }),
			Response.json({ message: "User not found" }, { status: 404 }),
			Response.json({ message: "denied" }, { status: 403 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		expect(await backend.createLogin("staff-x@example.com")).toBe(USER_ID);
		expect(calls[0]?.url).toBe(`${URL_BASE}/auth/v1/admin/users`);
		expect(calls[0]?.init.method).toBe("POST");
		expect(JSON.parse(calls[0]?.init.body ?? "")).toEqual({
			email: "staff-x@example.com",
			email_confirm: true,
		});
		await backend.deleteLogin(USER_ID);
		expect(calls[1]?.url).toBe(`${URL_BASE}/auth/v1/admin/users/${USER_ID}`);
		expect(calls[1]?.init.method).toBe("DELETE");
		expect(calls[1]?.init.body).toBeUndefined();
		await expect(backend.deleteLogin(USER_ID)).resolves.toBeUndefined();
		await expect(backend.deleteLogin(USER_ID)).rejects.toMatchObject({
			failure: "status",
		});
		await expect(backend.deleteLogin("not-a-uuid")).rejects.toMatchObject({
			failure: "invalid_answer",
		});
		expect(calls).toHaveLength(4);
	});

	it("refuses a created login without an id", async () => {
		const { send } = scripted([
			Response.json({ email: "staff-x@example.com" }),
			Response.json({ msg: "email exists" }, { status: 422 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		await expect(
			backend.createLogin("staff-x@example.com"),
		).rejects.toMatchObject({ failure: "invalid_answer" });
		await expect(
			backend.createLogin("staff-x@example.com"),
		).rejects.toMatchObject({ failure: "status" });
	});

	it("reads the caller of a session and treats a refused token as no session", async () => {
		const { send, calls } = scripted([
			Response.json({ id: USER_ID }),
			Response.json({ code: 403 }, { status: 403 }),
		]);
		const backend = createSupabaseBackend({
			url: URL_BASE,
			key: SECRET_KEY,
			fetch: send,
		});
		expect(await backend.sessionUser("member-session")).toBe(USER_ID);
		expect(await backend.sessionUser("forged")).toBeNull();
		expect(calls[0]?.init.headers).toEqual({
			apikey: SECRET_KEY,
			authorization: "Bearer member-session",
		});
	});
});

describe("brand resolution and sign-in answers", () => {
	const settings = zaloSettings({});

	it("refuses an unknown brand, an ambiguous key and a disabled app", async () => {
		const backend = createFakeBackend();
		await expect(
			requireBrandApp(backend, settings, "brand-1"),
		).rejects.toMatchObject({
			status: 404,
			code: "unknown_brand",
		});
		for (const tenant of [
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		]) {
			backend.addApp({
				brandKey: "brand-1",
				tenantId: tenant,
				tenantSlug: `slug-${tenant.slice(0, 2)}`,
				zaloAppId: `app-${tenant.slice(0, 2)}`,
				secretName: "ZALO_APP_SECRET_BRAND_1",
				status: "active",
			});
		}
		await expect(
			requireBrandApp(backend, settings, "brand-1"),
		).rejects.toMatchObject({
			status: 500,
			code: "not_configured",
		});
		backend.addApp({
			brandKey: "brand-2",
			tenantId: "11111111-1111-4111-8111-111111111111",
			tenantSlug: "slug",
			zaloAppId: "app-disabled",
			secretName: "ZALO_APP_SECRET_BRAND_2",
			status: "disabled",
		});
		await expect(
			requireBrandApp(backend, settings, "brand-2"),
		).rejects.toMatchObject({
			status: 403,
			code: "app_disabled",
		});
	});

	it("parses bound and unpaired answers and refuses anything else", () => {
		expect(parseSignIn({ status: "unpaired" })).toEqual({ status: "unpaired" });
		expect(
			parseSignIn({
				status: "bound",
				user_id: USER_ID,
				tenant_id: "t",
				role: "manager",
				store_ids: ["s1"],
				stores: ["Store 1"],
				display_name: " ",
			}),
		).toEqual({
			status: "bound",
			userId: USER_ID,
			tenantId: "t",
			role: "manager",
			storeIds: ["s1"],
			stores: ["Store 1"],
			displayName: null,
		});
		expect(() => parseSignIn({ status: "bound", role: "root" })).toThrow(
			UpstreamError,
		);
		expect(() => parseSignIn([])).toThrow(UpstreamError);
	});

	const notice = {
		version: "staff-notice-2026-01",
		title: "Thông báo cho nhân viên",
		body_markdown: "# Thông báo",
		published_at: "2026-11-01T00:00:00+00:00",
	};
	const parsedNotice = {
		version: "staff-notice-2026-01",
		title: "Thông báo cho nhân viên",
		bodyMarkdown: "# Thông báo",
		publishedAt: "2026-11-01T00:00:00+00:00",
	};

	it("parses the notice, the reason and the wait of an unpaired answer", () => {
		expect(parseSignIn({ status: "unpaired", notice })).toEqual({
			status: "unpaired",
			notice: parsedNotice,
		});
		expect(
			parseSignIn({
				status: "unpaired",
				reason: "wait",
				retry_after: 900,
				notice,
			}),
		).toEqual({
			status: "unpaired",
			notice: parsedNotice,
			reason: "wait",
			retryAfter: 900,
		});
		expect(parseSignIn({ status: "unpaired", reason: "code_refused" })).toEqual(
			{ status: "unpaired", reason: "code_refused" },
		);
		expect(
			parseSignIn({ status: "unpaired", reason: "notice_outdated" }),
		).toEqual({ status: "unpaired", reason: "notice_outdated" });
		for (const bad of [
			{ status: "unpaired", reason: "roster_missing" },
			{ status: "unpaired", retry_after: -1 },
			{ status: "unpaired", retry_after: 1.5 },
			{ status: "unpaired", notice: { ...notice, version: "Bad" } },
			{ status: "unpaired", notice: { ...notice, title: "" } },
			{ status: "unpaired", notice: "text" },
		]) {
			expect(() => parseSignIn(bad)).toThrow(UpstreamError);
		}
	});

	it("parses notice_required and login_needed", () => {
		expect(parseSignIn({ status: "notice_required", notice })).toEqual({
			status: "notice_required",
			notice: parsedNotice,
		});
		expect(parseSignIn({ status: "notice_required" })).toEqual({
			status: "notice_required",
		});
		expect(parseSignIn({ status: "login_needed" })).toEqual({
			status: "login_needed",
		});
		expect(noticeAnswer(parsedNotice)).toEqual(notice);
	});

	it("parses the contact instructions of unpaired and notice_required answers", () => {
		const contact = "Gặp quản lý ca tại quầy.\nGửi thư tới hr@example.com.";
		expect(
			parseSignIn({ status: "unpaired", reason: "code_refused", contact }),
		).toEqual({ status: "unpaired", reason: "code_refused", contact });
		expect(parseSignIn({ status: "notice_required", notice, contact })).toEqual(
			{ status: "notice_required", notice: parsedNotice, contact },
		);
		expect(parseSignIn({ status: "unpaired", contact: null })).toEqual({
			status: "unpaired",
		});
		for (const bad of [
			{ status: "unpaired", contact: "" },
			{ status: "unpaired", contact: 7 },
			{ status: "notice_required", contact: ["text"] },
		]) {
			expect(() => parseSignIn(bad)).toThrow(UpstreamError);
		}
	});

	it("parses the brand's store ids of a bound answer next to the names", () => {
		const bound = {
			status: "bound",
			user_id: USER_ID,
			tenant_id: "t",
			role: "staff",
			store_ids: null,
			stores: ["Store A", "Store Z"],
			brand_store_ids: ["s2", "s1"],
			display_name: "Nhân viên",
		};
		expect(parseSignIn(bound)).toEqual({
			status: "bound",
			userId: USER_ID,
			tenantId: "t",
			role: "staff",
			storeIds: null,
			stores: ["Store A", "Store Z"],
			brandStoreIds: ["s2", "s1"],
			displayName: "Nhân viên",
		});
		expect(() => parseSignIn({ ...bound, brand_store_ids: "s1" })).toThrow(
			UpstreamError,
		);
		expect(() => parseSignIn({ ...bound, brand_store_ids: [1] })).toThrow(
			UpstreamError,
		);
	});

	it("parses the published texts and the wait of the texts request", () => {
		const privacy = {
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-2026-01",
			title: "Thông báo quyền riêng tư",
			body_markdown: "# Quyền riêng tư",
			published_at: "2026-11-01T00:00:00+00:00",
		};
		const terms = {
			...privacy,
			kind: "mini_app_terms",
			language: "en",
			version: "terms-2026-01-en",
			title: "Terms of use",
		};
		const parsed = parseTexts({
			status: "texts",
			documents: [privacy, terms],
			contact: "Hỏi quản lý.",
		});
		expect(parsed).toEqual({
			status: "texts",
			documents: [
				{
					kind: "privacy_notice",
					language: "vi",
					version: "privacy-2026-01",
					title: "Thông báo quyền riêng tư",
					bodyMarkdown: "# Quyền riêng tư",
					publishedAt: "2026-11-01T00:00:00+00:00",
				},
				{
					kind: "mini_app_terms",
					language: "en",
					version: "terms-2026-01-en",
					title: "Terms of use",
					bodyMarkdown: "# Quyền riêng tư",
					publishedAt: "2026-11-01T00:00:00+00:00",
				},
			],
			contact: "Hỏi quản lý.",
		});
		expect(
			parsed.status === "texts" ? parsed.documents.map(legalTextAnswer) : [],
		).toEqual([privacy, terms]);
		expect(
			parseTexts({ status: "texts", documents: [], contact: null }),
		).toEqual({ status: "texts", documents: [], contact: null });
		expect(parseTexts({ status: "texts", documents: [] })).toEqual({
			status: "texts",
			documents: [],
			contact: null,
		});
		expect(parseTexts({ status: "wait", retry_after: 41 })).toEqual({
			status: "wait",
			retryAfter: 41,
		});
		for (const bad of [
			[],
			{ status: "texts" },
			{ status: "texts", documents: [{ ...privacy, kind: "staff_notice" }] },
			{ status: "texts", documents: [{ ...privacy, language: "fr" }] },
			{ status: "texts", documents: [{ ...privacy, version: "Bad" }] },
			{ status: "texts", documents: [{ ...privacy, title: "" }] },
			{ status: "texts", documents: [{ ...privacy, body_markdown: null }] },
			{ status: "texts", documents: [], contact: "" },
			{ status: "wait", retry_after: 0 },
			{ status: "wait", retry_after: 1.5 },
			{ status: "wait" },
			{ status: "bound" },
		]) {
			expect(() => parseTexts(bad)).toThrow(UpstreamError);
		}
	});

	it("gives a new staff login an e-mail on a reserved domain that can never receive mail", () => {
		expect(staffLoginEmail(USER_ID)).toBe(
			`staff-${USER_ID}@${STAFF_LOGIN_DOMAIN}`,
		);
		expect(STAFF_LOGIN_DOMAIN.endsWith(".invalid")).toBe(true);
		expect(() => staffLoginEmail("staff")).toThrow();
		expect(() => staffLoginEmail(USER_ID.toUpperCase())).toThrow();
	});
});
