import { describe, expect, it } from "vitest";
import {
	createSessionStore,
	SESSION_STORAGE_KEY,
} from "../../src/session/session-store";
import {
	createStandInSessionClient,
	STAND_IN_CONTACT,
	STAND_IN_LEGAL_DOCUMENTS,
	STAND_IN_NEW_NOTICE,
	STAND_IN_NOTICE,
	standInSettingsFrom,
} from "../../src/session/stand-in";
import {
	CONTACT_MAX_LENGTH,
	createZaloSessionClient,
	parseSessionAnswer,
	parseTextsAnswer,
} from "../../src/session/zalo-session-client";
import { createMemoryStorage } from "../../src/storage/native-storage";

const NOW_MS = Date.UTC(2026, 10, 18, 3, 0, 0);
const ENDPOINT = "https://project.example.com/functions/v1/zalo-session";
const notice = {
	version: "staff-notice-1",
	title: "Thông báo cho nhân viên",
	body_markdown: "Văn bản thử.",
	published_at: "2026-11-01T00:00:00+00:00",
};
const privacy = {
	kind: "privacy_notice",
	language: "vi",
	version: "privacy-1",
	title: "Chính sách quyền riêng tư",
	body_markdown: "Văn bản thử.",
	published_at: "2026-11-01T00:00:00+00:00",
};

interface Recorded {
	readonly headers: Record<string, string>;
	readonly body: Record<string, unknown>;
}

function entryClient(
	answers: readonly unknown[],
	options: {
		readonly onboarding?: boolean;
		readonly storage?: ReturnType<typeof createMemoryStorage>;
	} = {},
) {
	const requests: Recorded[] = [];
	let tokenCalls = 0;
	let index = 0;
	const storage = options.storage ?? createMemoryStorage();
	const sessionClient = createZaloSessionClient({
		endpoint: ENDPOINT,
		brandKey: "brand-1",
		publishableKey: "publishable-test",
		storage,
		getAccessToken: async () => {
			tokenCalls += 1;
			return "zalo-token";
		},
		fetch: async (_input, init) => {
			requests.push({
				headers: init?.headers as Record<string, string>,
				body: JSON.parse(String(init?.body)),
			});
			const answer = answers[Math.min(index, answers.length - 1)];
			index += 1;
			if (answer instanceof Error) throw answer;
			if (typeof answer === "number")
				return new Response("{}", { status: answer });
			return new Response(JSON.stringify(answer), { status: 200 });
		},
		now: () => NOW_MS,
		...(options.onboarding === undefined
			? {}
			: { onboarding: options.onboarding }),
	});
	return { sessionClient, requests, storage, tokenCalls: () => tokenCalls };
}

describe("the first open with onboarding", () => {
	it("answers new without asking Zalo for an identity until the person continues", async () => {
		const { sessionClient, requests, tokenCalls } = entryClient(
			[{ status: "unpaired", notice }],
			{ onboarding: true },
		);
		expect(await sessionClient.connect()).toEqual({ status: "new" });
		expect(await sessionClient.connect()).toEqual({ status: "new" });
		expect(tokenCalls()).toBe(0);
		expect(requests).toEqual([]);
		expect(await sessionClient.start()).toMatchObject({
			status: "unpaired",
			notice: { version: "staff-notice-1" },
		});
		expect(tokenCalls()).toBe(1);
		expect((await sessionClient.connect()).status).toBe("unpaired");
		expect(tokenCalls()).toBe(2);
	});

	it("skips onboarding for a person with a stored session, even an expired one", async () => {
		const storage = createMemoryStorage();
		createSessionStore(storage).write({
			accessToken: "old",
			refreshToken: "",
			expiresAt: NOW_MS / 1000 - 3600,
			member: { displayName: "Thành viên thử", role: "staff", stores: [] },
		});
		const { sessionClient, tokenCalls } = entryClient(
			[{ status: "unpaired", notice }],
			{ onboarding: true, storage },
		);
		expect((await sessionClient.connect()).status).toBe("unpaired");
		expect(tokenCalls()).toBe(1);
		expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it("connects at once when onboarding is off, as the customer app does", async () => {
		const { sessionClient, tokenCalls } = entryClient([
			{ status: "unpaired", notice },
		]);
		expect((await sessionClient.connect()).status).toBe("unpaired");
		expect(tokenCalls()).toBe(1);
	});
});

describe("the published texts and the contact instructions", () => {
	it("asks zalo-session for the texts with the brand only, without a Zalo identity", async () => {
		const { sessionClient, requests, tokenCalls } = entryClient([
			{
				status: "texts",
				documents: [privacy, { ...privacy, kind: "loyalty_consent_text" }],
				contact: "  Hỏi quản lý tại quầy.  ",
			},
		]);
		expect(await sessionClient.texts()).toEqual({
			documents: [
				{
					kind: "privacy_notice",
					language: "vi",
					version: "privacy-1",
					title: "Chính sách quyền riêng tư",
					bodyMarkdown: "Văn bản thử.",
					publishedAt: "2026-11-01T00:00:00+00:00",
				},
			],
			contact: "Hỏi quản lý tại quầy.",
		});
		expect(requests).toEqual([
			{
				headers: {
					"content-type": "application/json",
					apikey: "publishable-test",
				},
				body: { brand: "brand-1", texts: true },
			},
		]);
		expect(tokenCalls()).toBe(0);
	});

	it("gives no texts for a refusal, a lost network or a malformed answer", async () => {
		for (const answer of [
			400,
			new TypeError("offline"),
			{ status: "unpaired" },
			{ status: "texts", documents: [{ ...privacy, language: "fr" }] },
			{ status: "texts", documents: [], contact: 7 },
		]) {
			const { sessionClient } = entryClient([answer]);
			expect(await sessionClient.texts()).toBeNull();
		}
		expect(parseTextsAnswer({ status: "texts", documents: [] })).toEqual({
			documents: [],
			contact: null,
		});
	});

	it("keeps the contact instructions of an unpaired or notice answer as plain text", async () => {
		const { sessionClient } = entryClient([
			{ status: "unpaired", notice, contact: "Hỏi quản lý." },
		]);
		expect(await sessionClient.connect()).toEqual({
			status: "unpaired",
			codeRejected: false,
			notice: {
				version: "staff-notice-1",
				title: "Thông báo cho nhân viên",
				bodyMarkdown: "Văn bản thử.",
				publishedAt: "2026-11-01T00:00:00+00:00",
			},
			contact: "Hỏi quản lý.",
		});
		expect(
			parseSessionAnswer({
				status: "notice_required",
				notice: null,
				contact: "Hỏi quản lý.",
			}),
		).toEqual({
			status: "notice-required",
			notice: null,
			contact: "Hỏi quản lý.",
		});
		expect(parseSessionAnswer({ status: "unpaired", contact: "   " })).toEqual({
			status: "unpaired",
		});
		expect(
			parseSessionAnswer({
				status: "unpaired",
				contact: "x".repeat(CONTACT_MAX_LENGTH + 1),
			}),
		).toBeNull();
	});
});

describe("the stand-in entry", () => {
	const member = {
		displayName: "Nhân viên thử",
		role: "staff" as const,
		stores: ["Cửa hàng Mẫu 1"],
	};

	function standIn(
		scenario: "bound" | "unpaired",
		extra: { readonly noticeChange?: boolean } = {},
	) {
		return createStandInSessionClient({
			settings: { scenario, delayMs: 0, ...extra },
			member,
			storage: createMemoryStorage(),
			getAccessToken: async () => "mock-token",
			now: () => NOW_MS,
			onboarding: true,
		});
	}

	it("reads a changed notice from the address", () => {
		expect(standInSettingsFrom("?session=unpaired&notice=changed")).toEqual({
			scenario: "unpaired",
			delayMs: 0,
			noticeChange: true,
		});
	});

	it("shows onboarding only on the first open of an unpaired person", async () => {
		expect(await standIn("unpaired").connect()).toEqual({ status: "new" });
		expect((await standIn("bound").connect()).status).toBe("signed-in");
	});

	it("answers the stand-in texts and contact", async () => {
		expect(await standIn("unpaired").texts()).toEqual({
			documents: STAND_IN_LEGAL_DOCUMENTS,
			contact: STAND_IN_CONTACT,
		});
	});

	it("publishes a newer notice while the person pairs when asked to", async () => {
		const client = standIn("unpaired", { noticeChange: true });
		await client.start();
		const first = { version: STAND_IN_NOTICE.version, shownAt: NOW_MS };
		expect(await client.pair("123456", first)).toMatchObject({
			status: "unpaired",
			reason: "notice_outdated",
			notice: STAND_IN_NEW_NOTICE,
		});
		const paired = await client.pair("123456", {
			version: STAND_IN_NEW_NOTICE.version,
			shownAt: NOW_MS,
		});
		expect(paired.status).toBe("signed-in");
	});

	it("is unpaired again after the session is forgotten, as after a withdrawal", async () => {
		const client = standIn("bound");
		expect((await client.connect()).status).toBe("signed-in");
		client.forget();
		expect(await client.start()).toMatchObject({
			status: "unpaired",
			notice: STAND_IN_NOTICE,
		});
	});
});
