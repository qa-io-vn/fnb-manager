import {
	RestError,
	STAND_IN_LEGAL_DOCUMENTS,
	STAND_IN_NEW_NOTICE,
	type StoredSession,
} from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	createRestStaffAccount,
	createStandInStaffAccount,
	readNoticeCheck,
	sessionRefused,
	standInAccountSettingsFrom,
} from "./account";

const TENANT = "11111111-1111-4111-8111-111111111111";
const session: StoredSession = {
	accessToken: "session-a",
	refreshToken: "",
	expiresAt: 4_000_000_000,
	member: {
		displayName: "Nhân viên thử",
		role: "staff",
		stores: [],
		tenantId: TENANT,
	},
};
const notice = {
	version: "staff-notice-2",
	title: "Thông báo cho nhân viên",
	body_markdown: "Văn bản thử.",
	published_at: "2026-11-02T00:00:00+00:00",
};

interface Recorded {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: unknown;
}

function account(answers: readonly (unknown | number)[]) {
	const requests: Recorded[] = [];
	let index = 0;
	const restAccount = createRestStaffAccount({
		url: "https://project.example.com",
		publishableKey: "publishable-test",
		session,
		brand: "brand-1",
		getZaloAccessToken: async () => "zalo-token",
		fetch: async (input, init) => {
			requests.push({
				url: String(input),
				method: String(init?.method),
				headers: init?.headers as Record<string, string>,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
			});
			const answer = answers[Math.min(index, answers.length - 1)];
			index += 1;
			if (typeof answer === "number")
				return new Response("{}", { status: answer });
			return new Response(JSON.stringify(answer), { status: 200 });
		},
	});
	return { restAccount, requests };
}

describe("the member's staff notice and consent through the Data API", () => {
	it("reads my_staff_notice for the member's tenant", async () => {
		const { restAccount, requests } = account([
			{ consent: "outdated", notice },
		]);
		expect(await restAccount.noticeCheck()).toEqual({
			consent: "outdated",
			notice: {
				version: "staff-notice-2",
				title: "Thông báo cho nhân viên",
				bodyMarkdown: "Văn bản thử.",
				publishedAt: "2026-11-02T00:00:00+00:00",
			},
		});
		expect(requests).toEqual([
			{
				url: "https://project.example.com/rest/v1/rpc/my_staff_notice",
				method: "POST",
				headers: {
					apikey: "publishable-test",
					Authorization: "Bearer session-a",
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: { p_tenant_id: TENANT },
			},
		]);
	});

	it("accepts the notice with its version and showing time, and withdraws", async () => {
		const { restAccount, requests } = account(["consent-id", true]);
		await restAccount.acceptNotice({
			version: "staff-notice-2",
			shownAt: Date.UTC(2026, 10, 18, 5, 0, 0),
		});
		await restAccount.withdraw();
		expect(requests.map((request) => [request.url, request.body])).toEqual([
			[
				"https://project.example.com/rest/v1/rpc/accept_staff_notice",
				{
					p_tenant_id: TENANT,
					p_notice_version: "staff-notice-2",
					p_notice_shown_at: "2026-11-18T05:00:00.000Z",
				},
			],
			[
				"https://project.example.com/rest/v1/rpc/withdraw_staff_ops_consent",
				{ p_tenant_id: TENANT },
			],
		]);
	});

	it("decodes the phone token with zalo-phone, then links it with link_my_phone", async () => {
		const { restAccount, requests } = account([
			{ phone_number: "+10000000789" },
			"…789",
		]);
		expect(await restAccount.linkPhone("phone-token")).toBe("…789");
		expect(requests[0]).toEqual({
			url: "https://project.example.com/functions/v1/zalo-phone",
			method: "POST",
			headers: {
				"content-type": "application/json",
				apikey: "publishable-test",
				Authorization: "Bearer session-a",
			},
			body: {
				brand: "brand-1",
				access_token: "zalo-token",
				phone_token: "phone-token",
			},
		});
		expect(requests[1]?.url).toBe(
			"https://project.example.com/rest/v1/rpc/link_my_phone",
		);
		expect(requests[1]?.body).toEqual({
			p_tenant_id: TENANT,
			p_phone: "+10000000789",
		});
	});

	it("links nothing when zalo-phone refuses the token", async () => {
		const { restAccount, requests } = account([422]);
		await expect(restAccount.linkPhone("phone-token")).rejects.toEqual(
			new RestError(422),
		);
		expect(requests).toHaveLength(1);
	});

	it("reads the published Privacy and Terms of the member's tenant under RLS", async () => {
		const { restAccount, requests } = account([
			[
				{
					kind: "privacy_notice",
					language: "vi",
					version: "privacy-1",
					title: "Chính sách quyền riêng tư",
					body_markdown: "Văn bản thử.",
					published_at: "2026-11-01T00:00:00+00:00",
				},
				{ kind: "privacy_notice", language: "vi" },
			],
		]);
		expect(await restAccount.legalDocuments()).toEqual([
			{
				kind: "privacy_notice",
				language: "vi",
				version: "privacy-1",
				title: "Chính sách quyền riêng tư",
				bodyMarkdown: "Văn bản thử.",
				publishedAt: "2026-11-01T00:00:00+00:00",
			},
		]);
		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/rest/v1/legal_documents");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			select: "kind,language,version,title,body_markdown,published_at",
			tenant_id: `eq.${TENANT}`,
			status: "eq.published",
			kind: "in.(privacy_notice,mini_app_terms)",
			order: "kind.asc,language.asc",
		});
	});

	it("needs the member's tenant and refuses unreadable answers", async () => {
		const withoutTenant = createRestStaffAccount({
			url: "https://project.example.com",
			publishableKey: "publishable-test",
			session: {
				...session,
				member: { displayName: "Nhân viên thử", role: "staff", stores: [] },
			},
			brand: "brand-1",
			getZaloAccessToken: async () => "zalo-token",
			fetch: async () => new Response("{}"),
		});
		await expect(withoutTenant.noticeCheck()).rejects.toBeInstanceOf(RestError);
		const { restAccount } = account([{ consent: "maybe" }]);
		await expect(restAccount.noticeCheck()).rejects.toBeInstanceOf(RestError);
		expect(readNoticeCheck({ consent: "not_required", notice: null })).toEqual({
			consent: "not_required",
			notice: null,
		});
		expect(
			readNoticeCheck({ consent: "current", notice: { version: "" } }),
		).toBeNull();
	});

	it("treats 401 and 403 as a refused session", () => {
		expect(sessionRefused(new RestError(401))).toBe(true);
		expect(sessionRefused(new RestError(403))).toBe(true);
		expect(sessionRefused(new RestError(500))).toBe(false);
		expect(sessionRefused(new Error("other"))).toBe(false);
	});
});

describe("the stand-in account", () => {
	it("reads the consent state and delay from the address, owners off the roster", () => {
		expect(standInAccountSettingsFrom("")).toEqual({
			consent: "current",
			delayMs: 0,
		});
		expect(
			standInAccountSettingsFrom("?consent=outdated&dataDelay=300"),
		).toEqual({
			consent: "outdated",
			delayMs: 300,
		});
		expect(standInAccountSettingsFrom("?role=owner").consent).toBe(
			"not_required",
		);
	});

	it("asks for the new notice until it is accepted, and serves the stand-in texts", async () => {
		const standIn = createStandInStaffAccount({
			consent: "outdated",
			delayMs: 0,
		});
		expect(await standIn.noticeCheck()).toEqual({
			consent: "outdated",
			notice: STAND_IN_NEW_NOTICE,
		});
		await standIn.acceptNotice({
			version: STAND_IN_NEW_NOTICE.version,
			shownAt: 0,
		});
		expect((await standIn.noticeCheck()).consent).toBe("current");
		expect(await standIn.legalDocuments()).toBe(STAND_IN_LEGAL_DOCUMENTS);
		expect(await standIn.linkPhone("token")).toBe("…789");
	});
});
