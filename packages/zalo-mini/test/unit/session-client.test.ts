import { describe, expect, it } from "vitest";
import {
	authorizationHeaders,
	createSessionStore,
	isSessionFresh,
	SESSION_STORAGE_KEY,
} from "../../src/session/session-store";
import {
	createStandInSessionClient,
	STAND_IN_REJECTED_CODE,
	standInSettingsFrom,
} from "../../src/session/stand-in";
import type { StoredSession } from "../../src/session/types";
import {
	createZaloSessionClient,
	parseSessionAnswer,
} from "../../src/session/zalo-session-client";
import { createMemoryStorage } from "../../src/storage/native-storage";

const NOW_MS = Date.UTC(2026, 10, 18, 3, 0, 0);
const member = {
	display_name: "Thành viên thử",
	role: "manager",
	stores: ["Cửa hàng Mẫu 1"],
};

function boundAnswer(expiresAt: number) {
	return {
		status: "bound",
		access_token: "session-a",
		refresh_token: "refresh-a",
		expires_at: expiresAt,
		member,
	};
}

interface Recorded {
	readonly url: string;
	readonly headers: Record<string, string>;
	readonly body: Record<string, unknown>;
}

function fakeFetch(answers: readonly (unknown | Error)[]) {
	const requests: Recorded[] = [];
	let index = 0;
	const send: typeof fetch = async (input, init) => {
		requests.push({
			url: String(input),
			headers: init?.headers as Record<string, string>,
			body: JSON.parse(String(init?.body)),
		});
		const answer = answers[Math.min(index, answers.length - 1)];
		index += 1;
		if (answer instanceof Error) throw answer;
		if (typeof answer === "number")
			return new Response("{}", { status: answer });
		return new Response(JSON.stringify(answer), { status: 200 });
	};
	return { send, requests };
}

function client(answers: readonly (unknown | Error)[], nowMs = NOW_MS) {
	const storage = createMemoryStorage();
	const fetcher = fakeFetch(answers);
	let tokens = 0;
	const sessionClient = createZaloSessionClient({
		endpoint: "https://project.example.com/functions/v1/zalo-session",
		brandKey: "brand-1",
		publishableKey: "publishable-test",
		storage,
		getAccessToken: async () => {
			tokens += 1;
			return `zalo-token-${tokens}`;
		},
		fetch: fetcher.send,
		now: () => nowMs,
	});
	return { sessionClient, storage, requests: fetcher.requests };
}

describe("session client", () => {
	it("mints a session with the Zalo access token and the brand, and keeps it in Native Storage", async () => {
		const { sessionClient, storage, requests } = client([
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		const state = await sessionClient.connect();
		expect(state.status).toBe("signed-in");
		expect(requests).toEqual([
			{
				url: "https://project.example.com/functions/v1/zalo-session",
				headers: {
					"content-type": "application/json",
					apikey: "publishable-test",
				},
				body: { access_token: "zalo-token-1", brand: "brand-1" },
			},
		]);
		expect(JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? "null")).toEqual({
			accessToken: "session-a",
			refreshToken: "refresh-a",
			expiresAt: NOW_MS / 1000 + 3600,
			member: {
				displayName: "Thành viên thử",
				role: "manager",
				stores: ["Cửa hàng Mẫu 1"],
			},
		});
	});

	it("reuses a fresh stored session without calling zalo-session", async () => {
		const { sessionClient, requests } = client([
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		await sessionClient.connect();
		const again = await sessionClient.connect();
		expect(again.status).toBe("signed-in");
		expect(requests).toHaveLength(1);
	});

	it("shares one sign-in between connects that overlap, as React's StrictMode effects do", async () => {
		const { sessionClient, requests } = client([
			boundAnswer(NOW_MS / 1000 + 30),
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		const [first, second] = await Promise.all([
			sessionClient.connect(),
			sessionClient.connect(),
		]);
		expect(requests).toHaveLength(1);
		expect(second).toBe(first);
		await sessionClient.connect();
		expect(requests).toHaveLength(2);
	});

	it("mints again when the stored session is about to expire", async () => {
		const { sessionClient, requests } = client([
			boundAnswer(NOW_MS / 1000 + 30),
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		await sessionClient.connect();
		const refreshed = await sessionClient.connect();
		expect(requests.map((request) => request.body.access_token)).toEqual([
			"zalo-token-1",
			"zalo-token-2",
		]);
		expect(
			refreshed.status === "signed-in" && refreshed.session.expiresAt,
		).toBe(NOW_MS / 1000 + 3600);
	});

	it("answers unpaired and forgets any stored session", async () => {
		const { sessionClient, storage } = client([{ status: "unpaired" }]);
		storage.setItem(SESSION_STORAGE_KEY, "not json");
		expect(await sessionClient.connect()).toEqual({
			status: "unpaired",
			codeRejected: false,
		});
		expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it("sends a binding code once and reports a rejected one", async () => {
		const { sessionClient, requests } = client([
			{ status: "unpaired" },
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		expect(await sessionClient.bind("123456")).toEqual({
			status: "unpaired",
			codeRejected: true,
		});
		expect((await sessionClient.bind("654321")).status).toBe("signed-in");
		expect(requests.map((request) => request.body.binding_code)).toEqual([
			"123456",
			"654321",
		]);
	});

	it("refuses a malformed binding code without a request", async () => {
		const { sessionClient, requests } = client([]);
		expect(await sessionClient.bind("12345")).toEqual({
			status: "unpaired",
			codeRejected: true,
		});
		expect(requests).toEqual([]);
	});

	it("maps a network error, a refusal and a malformed answer to failures", async () => {
		expect(
			await client([new TypeError("offline")]).sessionClient.connect(),
		).toEqual({ status: "failed", reason: "network" });
		expect(await client([401]).sessionClient.connect()).toEqual({
			status: "failed",
			reason: "refused",
		});
		expect(
			await client([
				{ status: "bound", access_token: "x" },
			]).sessionClient.connect(),
		).toEqual({ status: "failed", reason: "refused" });
	});

	it("maps a failing Zalo access token to a failure", async () => {
		const sessionClient = createZaloSessionClient({
			endpoint: "https://project.example.com/functions/v1/zalo-session",
			brandKey: "brand-1",
			publishableKey: "publishable-test",
			storage: createMemoryStorage(),
			getAccessToken: async () => {
				throw new Error("no bridge");
			},
		});
		expect(await sessionClient.connect()).toEqual({
			status: "failed",
			reason: "zalo",
		});
	});

	it("forgets the session on request", async () => {
		const { sessionClient, storage } = client([
			boundAnswer(NOW_MS / 1000 + 3600),
		]);
		await sessionClient.connect();
		sessionClient.forget();
		expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});
});

describe("session helpers", () => {
	const session: StoredSession = {
		accessToken: "session-a",
		refreshToken: "refresh-a",
		expiresAt: NOW_MS / 1000 + 120,
		member: { displayName: "A", role: "staff", stores: [] },
	};

	it("treats a session as fresh until a minute before it expires", () => {
		expect(isSessionFresh(session, NOW_MS)).toBe(true);
		expect(isSessionFresh(session, NOW_MS + 59_000)).toBe(true);
		expect(isSessionFresh(session, NOW_MS + 60_000)).toBe(false);
	});

	it("sends the session in the Authorization header", () => {
		expect(authorizationHeaders(session)).toEqual({
			Authorization: "Bearer session-a",
		});
	});

	it("drops a stored session with an unknown role", () => {
		const storage = createMemoryStorage();
		storage.setItem(
			SESSION_STORAGE_KEY,
			JSON.stringify({
				...session,
				member: { ...session.member, role: "root" },
			}),
		);
		expect(createSessionStore(storage).read()).toBeNull();
		expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
	});

	it("parses only well-formed answers", () => {
		expect(parseSessionAnswer({ status: "unpaired" })).toEqual({
			status: "unpaired",
		});
		expect(parseSessionAnswer(boundAnswer(1))?.status).toBe("bound");
		expect(parseSessionAnswer({ status: "bound" })).toBeNull();
		expect(parseSessionAnswer([])).toBeNull();
	});
});

describe("stand-in session", () => {
	const standInMember = {
		displayName: "Thành viên thử",
		role: "manager" as const,
		stores: ["Cửa hàng Mẫu 1"],
	};

	it("reads the scenario and delay from the address", () => {
		expect(standInSettingsFrom("")).toEqual({ scenario: "bound", delayMs: 0 });
		expect(standInSettingsFrom("?session=unpaired&delay=500")).toEqual({
			scenario: "unpaired",
			delayMs: 500,
		});
		expect(standInSettingsFrom("?session=other&delay=-4")).toEqual({
			scenario: "bound",
			delayMs: 0,
		});
		expect(standInSettingsFrom("?delay=99999").delayMs).toBe(10_000);
	});

	it("runs the real client against a local answer", async () => {
		const standIn = createStandInSessionClient({
			settings: { scenario: "unpaired", delayMs: 0 },
			member: standInMember,
			storage: createMemoryStorage(),
			getAccessToken: async () => "mock-token",
		});
		expect(await standIn.connect()).toEqual({
			status: "unpaired",
			codeRejected: false,
		});
		expect(await standIn.bind(STAND_IN_REJECTED_CODE)).toEqual({
			status: "unpaired",
			codeRejected: true,
		});
		const bound = await standIn.bind("123456");
		expect(bound.status === "signed-in" && bound.session.member).toEqual(
			standInMember,
		);
	});

	it("fails like a lost network in the failed scenario", async () => {
		const standIn = createStandInSessionClient({
			settings: { scenario: "failed", delayMs: 0 },
			member: standInMember,
			storage: createMemoryStorage(),
			getAccessToken: async () => "mock-token",
		});
		expect(await standIn.connect()).toEqual({
			status: "failed",
			reason: "network",
		});
	});
});
