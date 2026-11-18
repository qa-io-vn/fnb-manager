import { afterEach, describe, expect, it } from "vitest";
import {
	cleanDisplayName,
	exchangePhoneToken,
	fetchZaloUser,
	GRAPH_ME_INFO_PATH,
	GRAPH_ME_PATH,
	PHONE_TOKEN_USED,
	toInternationalPhone,
} from "../../src/graph.js";
import { UpstreamError } from "../../src/http.js";
import {
	createMockZalo,
	MOCK_PHONE_TOKEN_LIFETIME_MS,
	MOCK_ZALO_ERRORS,
	type MockZaloServer,
	startMockZalo,
} from "../../src/testing/mock-zalo.js";

const SECRET = "synthetic-app-secret";
const OTHER_SECRET = "synthetic-other-secret";
const SUBSCRIBER = "912345678";
const INTERNATIONAL = `+84${SUBSCRIBER}`;
const USER = { id: "8800000000000000001", name: "Người dùng thử" };

function graph() {
	const mock = createMockZalo();
	return {
		mock,
		options: { baseUrl: "http://127.0.0.1:9", fetch: mock.fetch },
	};
}

describe("graph me", () => {
	it("returns the per-app user id and the display name for a valid token and proof", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER);
		expect(await fetchZaloUser(options, token, SECRET)).toEqual({
			ok: true,
			value: USER,
		});
		expect(mock.requests(GRAPH_ME_PATH)[0]?.headerNames).toEqual([
			"access_token",
			"appsecret_proof",
		]);
	});

	it("reports a wrong proof, an expired token and an unknown token as Zalo errors", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER, { lifetimeMs: 1000 });
		expect(await fetchZaloUser(options, token, OTHER_SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.proofInvalid,
		});
		mock.advance(1000);
		expect(await fetchZaloUser(options, token, SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.accessTokenExpired,
		});
		expect(await fetchZaloUser(options, "unknown", SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.accessTokenInvalid,
		});
	});

	it("keeps a user without a name and refuses an answer without a usable id", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, { id: "8800000000000000002" });
		expect(await fetchZaloUser(options, token, SECRET)).toEqual({
			ok: true,
			value: { id: "8800000000000000002", name: null },
		});
		const broken = await fetchZaloUser(
			{ fetch: async () => Response.json({ id: 42, error: 0 }) },
			token,
			SECRET,
		).catch((error: unknown) => error);
		expect(broken).toBeInstanceOf(UpstreamError);
		const server = await fetchZaloUser(
			{ fetch: async () => new Response("", { status: 500 }) },
			token,
			SECRET,
		).catch((error: unknown) => error);
		expect((server as UpstreamError).failure).toBe("status");
	});

	it("cleans display names to what zalo_identities accepts", () => {
		expect(cleanDisplayName("  Lan\u0007 Anh ")).toBe("Lan Anh");
		expect(cleanDisplayName("")).toBeNull();
		expect(cleanDisplayName(7)).toBeNull();
		expect([...(cleanDisplayName("Ă".repeat(140)) ?? "")]).toHaveLength(100);
	});
});

describe("graph me/info", () => {
	it("decodes a phone token inside its life exactly once, in international form", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER);
		const phone = mock.issuePhoneToken(token, "84912345678");
		mock.advance(MOCK_PHONE_TOKEN_LIFETIME_MS - 1);
		expect(await exchangePhoneToken(options, token, phone, SECRET)).toEqual({
			ok: true,
			value: INTERNATIONAL,
		});
		expect(await exchangePhoneToken(options, token, phone, SECRET)).toEqual({
			ok: false,
			error: PHONE_TOKEN_USED,
		});
		expect(mock.requests(GRAPH_ME_INFO_PATH)[0]?.headerNames).toEqual([
			"access_token",
			"code",
			"secret_key",
		]);
	});

	it("refuses a phone token after its two minutes", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER);
		const phone = mock.issuePhoneToken(token, "84912345678");
		mock.advance(MOCK_PHONE_TOKEN_LIFETIME_MS);
		expect(await exchangePhoneToken(options, token, phone, SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.phoneTokenExpired,
		});
	});

	it("answers a standing phone token of the local loop every time, for its own user only", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER);
		const other = mock.issueAccessToken(SECRET, { id: "8800000000000000003" });
		const phone = mock.issuePhoneToken(token, "84912345678", {
			token: "synthetic-standing-phone-token",
			reusable: true,
		});
		expect(phone).toBe("synthetic-standing-phone-token");
		mock.advance(MOCK_PHONE_TOKEN_LIFETIME_MS * 10);
		for (let attempt = 0; attempt < 3; attempt += 1) {
			expect(await exchangePhoneToken(options, token, phone, SECRET)).toEqual({
				ok: true,
				value: INTERNATIONAL,
			});
		}
		expect(await exchangePhoneToken(options, other, phone, SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.phoneTokenInvalid,
		});
	});

	it("refuses a phone token of another user and a wrong App secret", async () => {
		const { mock, options } = graph();
		const token = mock.issueAccessToken(SECRET, USER);
		const other = mock.issueAccessToken(SECRET, { id: "8800000000000000003" });
		const phone = mock.issuePhoneToken(other, "84912345678");
		expect(await exchangePhoneToken(options, token, phone, SECRET)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.phoneTokenInvalid,
		});
		expect(
			await exchangePhoneToken(options, other, phone, OTHER_SECRET),
		).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.proofInvalid,
		});
	});

	it("writes numbers in international form", () => {
		expect(toInternationalPhone("84912345678")).toBe(INTERNATIONAL);
		expect(toInternationalPhone("+84 912 345 678")).toBe(INTERNATIONAL);
		expect(toInternationalPhone("0912345678")).toBe(INTERNATIONAL);
		expect(toInternationalPhone("0243 123 4567")).toBe(`+84${"2431234567"}`);
		expect(toInternationalPhone("12")).toBeNull();
		expect(toInternationalPhone("not a number")).toBeNull();
	});
});

describe("mock Zalo over HTTP", () => {
	let server: MockZaloServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	it("answers on a loopback port", async () => {
		const mock = createMockZalo();
		server = await startMockZalo(mock);
		expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const token = mock.issueAccessToken(SECRET, USER);
		expect(
			await fetchZaloUser({ baseUrl: server.baseUrl }, token, SECRET),
		).toEqual({ ok: true, value: USER });
	});

	it("can hang until the caller gives up", async () => {
		const mock = createMockZalo();
		mock.failNext(GRAPH_ME_PATH, { kind: "hang" });
		const token = mock.issueAccessToken(SECRET, USER);
		const error = await fetchZaloUser(
			{ fetch: mock.fetch, timeoutMs: 20 },
			token,
			SECRET,
		).catch((caught: unknown) => caught);
		expect((error as UpstreamError).failure).toBe("timeout");
	});
});
