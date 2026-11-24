import { describe, expect, it } from "vitest";
import type { JoinRequest } from "../../src/loyalty/contract";
import {
	CUSTOMER_SESSION_STORAGE_KEY,
	createCustomerSessionStore,
	createZaloCustomerSessionClient,
	isCustomerSessionFresh,
	joinRequestProblems,
} from "../../src/session/customer-session-client";
import { createMemoryStorage } from "../../src/storage/native-storage";

const NOW_MS = Date.UTC(2026, 10, 19, 3, 0, 0);
const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";

function sessionAnswer(customerId: string | null, extra: object = {}) {
	return {
		status: "customer",
		access_token: customerId === null ? "visitor-token" : "member-token",
		refresh_token: "refresh",
		expires_at: NOW_MS / 1000 + 3600,
		customer: {
			tenant_id: TENANT,
			customer_id: customerId,
			display_name: "Khách thử",
		},
		...extra,
	};
}

const JOINED = {
	membership_id: "33333333-3333-4333-8333-333333333333",
	welcome_stamps: 1,
	already_member: false,
};

const JOIN: JoinRequest = {
	phoneToken: "phone-token",
	loyaltyConsent: true,
	marketingConsent: false,
	policyVersion: "privacy-1",
	screenVersion: "join-1",
	store: "mau-1",
	shownAt: NOW_MS - 5000,
};

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
		if (
			typeof answer === "object" &&
			answer !== null &&
			"status_code" in answer
		) {
			const { status_code, ...body } = answer as {
				status_code: number;
			} & Record<string, unknown>;
			return new Response(JSON.stringify(body), { status: status_code });
		}
		return new Response(JSON.stringify(answer), { status: 200 });
	};
	return { send, requests };
}

function client(
	answers: readonly (unknown | Error)[],
	options: { now?: () => number; token?: () => Promise<string> } = {},
) {
	const storage = createMemoryStorage();
	const fetched = fakeFetch(answers);
	return {
		storage,
		requests: fetched.requests,
		session: createZaloCustomerSessionClient({
			endpoint: "https://project.example.com/functions/v1/zalo-session",
			brandKey: "brand-1",
			publishableKey: "publishable",
			storage,
			getAccessToken: options.token ?? (async () => "zalo-access"),
			fetch: fetched.send,
			now: options.now ?? (() => NOW_MS),
		}),
	};
}

describe("the customer session client", () => {
	it("asks zalo-session for a customer session with the Zalo access token and keeps it in Native Storage", async () => {
		const { session, requests, storage } = client([sessionAnswer(null)]);
		const state = await session.connect();
		expect(state).toEqual({
			status: "ready",
			session: {
				accessToken: "visitor-token",
				refreshToken: "refresh",
				expiresAt: NOW_MS / 1000 + 3600,
				customer: {
					tenantId: TENANT,
					customerId: null,
					displayName: "Khách thử",
				},
			},
		});
		expect(requests).toEqual([
			{
				url: "https://project.example.com/functions/v1/zalo-session",
				headers: { "content-type": "application/json", apikey: "publishable" },
				body: {
					kind: "customer",
					access_token: "zalo-access",
					brand: "brand-1",
				},
			},
		]);
		expect(
			JSON.parse(storage.getItem(CUSTOMER_SESSION_STORAGE_KEY) ?? "{}")
				.accessToken,
		).toBe("visitor-token");
		await session.connect();
		expect(requests).toHaveLength(1);
	});

	it("mints again after the stored session expires, and once for concurrent callers", async () => {
		let now = NOW_MS;
		const { session, requests } = client(
			[sessionAnswer(null), sessionAnswer(null)],
			{
				now: () => now,
			},
		);
		await Promise.all([session.connect(), session.connect()]);
		expect(requests).toHaveLength(1);
		now += 3_600_000;
		await session.connect();
		expect(requests).toHaveLength(2);
		await session.refresh();
		expect(requests).toHaveLength(3);
	});

	it("reports Zalo, network and refused failures with a short technical detail and keeps nothing", async () => {
		const zalo = client([sessionAnswer(null)], {
			token: async () => {
				throw new Error("no token");
			},
		});
		expect(await zalo.session.connect()).toEqual({
			status: "failed",
			reason: "zalo",
			detail: "zalo-sdk error",
		});
		expect(zalo.requests).toHaveLength(0);
		const coded = client([sessionAnswer(null)], {
			token: async () => {
				throw Object.assign(new Error("denied"), { code: -1401 });
			},
		});
		expect(await coded.session.connect()).toEqual({
			status: "failed",
			reason: "zalo",
			detail: "zalo-sdk -1401",
		});
		const empty = client([sessionAnswer(null)], { token: async () => "" });
		expect(await empty.session.connect()).toEqual({
			status: "failed",
			reason: "zalo",
			detail: "zalo-sdk no-token",
		});
		expect(empty.requests).toHaveLength(0);
		const lost = client([new TypeError("offline")]);
		expect(await lost.session.connect()).toEqual({
			status: "failed",
			reason: "network",
			detail: "session fetch",
		});
		const refused = client([{ status_code: 403, error: "app_disabled" }]);
		expect(await refused.session.connect()).toEqual({
			status: "failed",
			reason: "refused",
			detail: "session 403 app_disabled",
		});
		// a code that is not a plain snake-case name is not echoed (it could carry anything)
		const odd = client([{ status_code: 401, error: "Bearer abc.def" }]);
		expect(await odd.session.connect()).toEqual({
			status: "failed",
			reason: "refused",
			detail: "session 401",
		});
		const malformed = client([{ status: "bound" }]);
		expect(await malformed.session.connect()).toEqual({
			status: "failed",
			reason: "refused",
			detail: "session answer",
		});
		expect(malformed.storage.getItem(CUSTOMER_SESSION_STORAGE_KEY)).toBeNull();
	});

	it("joins through zalo-session with the phone token and both consents, and keeps the member session", async () => {
		const { session, requests, storage } = client([
			sessionAnswer(null),
			sessionAnswer(CUSTOMER, { joined: JOINED }),
		]);
		await session.connect();
		const result = await session.join(JOIN);
		expect(result).toEqual({
			ok: true,
			session: expect.objectContaining({
				accessToken: "member-token",
				customer: {
					tenantId: TENANT,
					customerId: CUSTOMER,
					displayName: "Khách thử",
				},
			}),
			joined: {
				membershipId: JOINED.membership_id,
				welcomeStamps: 1,
				alreadyMember: false,
			},
		});
		expect(requests[1]?.body).toEqual({
			kind: "customer",
			access_token: "zalo-access",
			brand: "brand-1",
			join: {
				phone_token: "phone-token",
				loyalty_consent: true,
				marketing_consent: false,
				policy_version: "privacy-1",
				screen_version: "join-1",
				store: "mau-1",
				shown_at: new Date(NOW_MS - 5000).toISOString(),
			},
		});
		expect(
			JSON.parse(storage.getItem(CUSTOMER_SESSION_STORAGE_KEY) ?? "{}").customer
				.customerId,
		).toBe(CUSTOMER);
	});

	it("names each refusal of a join and keeps the visitor session", async () => {
		for (const [status, error] of [
			[400, "loyalty_consent_required"],
			[409, "policy_outdated"],
			[409, "phone_token_used"],
			[422, "phone_token_refused"],
			[404, "unknown_store"],
			[409, "phone_in_use"],
			[502, "zalo_unavailable"],
		] as const) {
			const { session, storage } = client([
				sessionAnswer(null),
				{ status_code: status, error, request_id: "r" },
			]);
			await session.connect();
			expect(await session.join(JOIN)).toEqual({ ok: false, failure: error });
			expect(
				JSON.parse(storage.getItem(CUSTOMER_SESSION_STORAGE_KEY) ?? "{}")
					.customer.customerId,
			).toBeNull();
		}
		const odd = client([{ status_code: 500, error: "internal" }]);
		expect(await odd.session.join(JOIN)).toEqual({
			ok: false,
			failure: "refused",
		});
		const visitorAnswer = client([sessionAnswer(null)]);
		expect(await visitorAnswer.session.join(JOIN)).toEqual({
			ok: false,
			failure: "refused",
		});
	});

	it("never sends a join without the loyalty consent or with a malformed field", async () => {
		const { session, requests } = client([
			sessionAnswer(CUSTOMER, { joined: JOINED }),
		]);
		const refused = [
			{ ...JOIN, loyaltyConsent: false as unknown as true },
			{ ...JOIN, phoneToken: " " },
			{ ...JOIN, policyVersion: "Privacy 1" },
			{ ...JOIN, store: "../mau" },
			{ ...JOIN, shownAt: Number.NaN },
		];
		for (const request of refused) {
			expect(await session.join(request)).toEqual({
				ok: false,
				failure: "refused",
			});
		}
		expect(requests).toHaveLength(0);
		expect(joinRequestProblems(JOIN)).toEqual([]);
		expect(joinRequestProblems({ ...JOIN, store: null })).toEqual([]);
	});
});

describe("the customer session store", () => {
	it("drops what it cannot read and knows when a session is fresh", () => {
		const storage = createMemoryStorage();
		const store = createCustomerSessionStore(storage);
		storage.setItem(CUSTOMER_SESSION_STORAGE_KEY, "{not json");
		expect(store.read()).toBeNull();
		expect(storage.getItem(CUSTOMER_SESSION_STORAGE_KEY)).toBeNull();
		storage.setItem(
			CUSTOMER_SESSION_STORAGE_KEY,
			JSON.stringify({ accessToken: "a", refreshToken: "b", expiresAt: 1 }),
		);
		expect(store.read()).toBeNull();
		const session = {
			accessToken: "a",
			refreshToken: "b",
			expiresAt: NOW_MS / 1000 + 120,
			customer: { tenantId: TENANT, customerId: null, displayName: null },
		};
		store.write(session);
		expect(store.read()).toEqual(session);
		expect(isCustomerSessionFresh(session, NOW_MS)).toBe(true);
		expect(isCustomerSessionFresh(session, NOW_MS + 61_000)).toBe(false);
	});
});
