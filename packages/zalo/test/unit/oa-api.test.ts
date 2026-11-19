import { describe, expect, it } from "vitest";
import { UpstreamError } from "../../src/http.js";
import {
	OA_API_ERRORS,
	OA_MENU_PATH,
	OA_MESSAGE_CS_PATH,
	sendConsultation,
	updateOaMenu,
	ZALO_OA_API_BASE_URL,
} from "../../src/oa/api.js";
import { DEFAULT_OA_MENU, zaloButtons } from "../../src/oa/menu.js";
import { textMessage, userInfoRequest } from "../../src/oa/messages.js";
import { oaApiSettings } from "../../src/oa/settings.js";
import { ZaloConfigError } from "../../src/settings.js";
import {
	createMockZalo,
	MOCK_OA_WINDOW_MS,
	MOCK_ZALO_ERRORS,
	startMockZalo,
} from "../../src/testing/mock-zalo.js";

const APP_ID = "synthetic-app-1";
const USER = "synthetic-oa-user-1";
const IMAGE = "https://example.com/brand-logo.png";
const BUTTONS = zaloButtons(DEFAULT_OA_MENU.buttons, "synthetic-mini-app-1");

function oa() {
	const mock = createMockZalo();
	const { accessToken } = mock.issueTokens(APP_ID, "oa");
	return {
		mock,
		accessToken,
		options: { baseUrl: "http://127.0.0.1:9", fetch: mock.fetch },
	};
}

describe("OA consultation messages against the mock", () => {
	it("sends inside the window and records the message once", async () => {
		const { mock, accessToken, options } = oa();
		mock.oaInteraction(APP_ID, USER);
		const sent = await sendConsultation(
			options,
			accessToken,
			textMessage(USER, "Xin chào", BUTTONS),
		);
		expect(sent.ok).toBe(true);
		const messages = mock.oaMessages(APP_ID);
		expect(messages).toHaveLength(1);
		expect(sent).toEqual({
			ok: true,
			value: { messageId: messages[0]?.messageId },
		});
		expect(mock.requests(OA_MESSAGE_CS_PATH)[0]?.headerNames).toEqual([
			"access_token",
			"content-type",
		]);
	});

	it("answers the window error after 7 days without an interaction and with none at all", async () => {
		const { mock, accessToken, options } = oa();
		const message = textMessage(USER, "Xin chào", []);
		expect(await sendConsultation(options, accessToken, message)).toEqual({
			ok: false,
			error: OA_API_ERRORS.outsideWindow,
		});
		mock.oaInteraction(APP_ID, USER);
		mock.advance(MOCK_OA_WINDOW_MS + 1);
		const fresh = mock.issueTokens(APP_ID, "oa").accessToken;
		expect(await sendConsultation(options, fresh, message)).toEqual({
			ok: false,
			error: OA_API_ERRORS.outsideWindow,
		});
		expect(mock.oaMessages()).toHaveLength(0);
	});

	it("accepts the request_user_info form and refuses a developer token", async () => {
		const { mock, accessToken, options } = oa();
		mock.oaInteraction(APP_ID, USER);
		const form = userInfoRequest(USER, {
			title: "Tham gia",
			subtitle: "Chia sẻ tên và số điện thoại",
			imageUrl: IMAGE,
		});
		expect((await sendConsultation(options, accessToken, form)).ok).toBe(true);
		const developer = mock.issueTokens(APP_ID, "developer").accessToken;
		expect(await sendConsultation(options, developer, form)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.oaAccessTokenInvalid,
		});
	});

	it("turns a non-JSON or failed answer into an upstream error", async () => {
		const { mock, accessToken, options } = oa();
		mock.failNext(OA_MESSAGE_CS_PATH, { kind: "status", status: 502 });
		await expect(
			sendConsultation(options, accessToken, textMessage(USER, "Xin chào", [])),
		).rejects.toBeInstanceOf(UpstreamError);
	});
});

describe("OA menu update against the mock", () => {
	it("stores exactly the buttons sent", async () => {
		const { mock, accessToken, options } = oa();
		expect(await updateOaMenu(options, accessToken, BUTTONS)).toEqual({
			ok: true,
			value: null,
		});
		expect(mock.oaMenu(APP_ID)).toEqual(BUTTONS);
		expect(mock.requests(OA_MENU_PATH)).toHaveLength(1);
	});

	it("reaches the mock through a loopback server too", async () => {
		const mock = createMockZalo();
		const { accessToken } = mock.issueTokens(APP_ID, "oa");
		const server = await startMockZalo(mock);
		try {
			expect(
				await updateOaMenu({ baseUrl: server.baseUrl }, accessToken, BUTTONS),
			).toEqual({ ok: true, value: null });
		} finally {
			await server.close();
		}
		expect(mock.oaMenu(APP_ID)).toEqual(BUTTONS);
	});
});

describe("OA API settings", () => {
	const local = {
		SUPABASE_URL: "http://127.0.0.1:54321",
		SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
		ZALO_TENANT_ID: "11111111-1111-4111-8111-111111111111",
	};

	it("talks to Zalo with sending off unless ZALO_OA_MESSAGES=1", () => {
		expect(oaApiSettings({})).toMatchObject({
			baseUrl: ZALO_OA_API_BASE_URL,
			messages: false,
			real: true,
		});
		expect(oaApiSettings({ ZALO_OA_MESSAGES: "1" }).messages).toBe(true);
		expect(() => oaApiSettings({ ZALO_OA_MESSAGES: "yes" })).toThrow(
			ZaloConfigError,
		);
	});

	it("takes a loopback mock only on the local stack or in the integration suite, and needs it there", () => {
		expect(
			oaApiSettings({
				...local,
				ZALO_LOCAL_DEV: "1",
				ZALO_OA_API_BASE_URL: "http://127.0.0.1:8788",
			}),
		).toMatchObject({
			baseUrl: "http://127.0.0.1:8788",
			real: false,
			local: true,
		});
		expect(() =>
			oaApiSettings({ ZALO_OA_API_BASE_URL: "http://127.0.0.1:8788" }),
		).toThrow(/accepted only/);
		expect(() =>
			oaApiSettings({
				...local,
				ZALO_LOCAL_DEV: "1",
				ZALO_OA_API_BASE_URL: "https://openapi.example.com",
			}),
		).toThrow(/loopback/);
		expect(() => oaApiSettings({ ...local, ZALO_LOCAL_DEV: "1" })).toThrow(
			/mock OA API/,
		);
	});
});
