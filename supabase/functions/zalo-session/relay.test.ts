import { importRelayKey, newRelayKey, sealAnnouncement } from "@fnb/zalo";
import {
	createFakeBackend,
	createMockZalo,
	createRelayNetwork,
	type FakeBackend,
	type MockZalo,
	type RelayNetwork,
	SYNTHETIC_RELAY_URL,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { handleZaloSession } from "./handler.ts";

// ADR-057: the Zalo Graph refuses servers outside Vietnam, so with a relay key the function sends its Graph calls
// through the relay its database names, and accepts the relay's sealed address announcements.

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const APP_SECRET = "synthetic-app-secret-brand-1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const APP = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const ZALO_USER = "8800000000000000001";
const NOW = Date.parse("2026-11-25T04:00:00Z");
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly network: RelayNetwork;
	readonly lines: string[];
	readonly token: string;
	readonly key: CryptoKey;
	readonly keyText: string;
	send(
		body: unknown,
		environment?: FunctionEnvironment,
		now?: number,
	): Promise<Response>;
}

async function harness(): Promise<Harness> {
	const zalo = createMockZalo();
	const backend = createFakeBackend();
	backend.addApp({
		brandKey: "brand-1",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: APP,
		secretName: "ZALO_APP_SECRET_BRAND_1",
		status: "active",
	});
	backend.addMember({
		userId: MANAGER,
		tenantId: TENANT,
		role: "manager",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1"],
		email: "zalo-relay-manager@example.com",
	});
	backend.bind(APP, ZALO_USER, MANAGER, null);
	const keyText = newRelayKey();
	const key = await importRelayKey(keyText);
	const network = createRelayNetwork(key, zalo.fetch);
	const lines: string[] = [];
	const token = zalo.issueAccessToken(APP_SECRET, { id: ZALO_USER });
	return {
		zalo,
		backend,
		network,
		lines,
		token,
		key,
		keyText,
		send(body, environment, now) {
			return handleZaloSession(
				new Request(FUNCTION_URL, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: "sb_publishable_synthetic",
					},
					body: JSON.stringify(body),
				}),
				environment ?? {
					ZALO_APP_SECRET_BRAND_1: APP_SECRET,
					ZALO_RELAY_KEY: keyText,
				},
				{
					fetch: network.fetch,
					backend,
					log: (line) => lines.push(line),
					requestId: () => "request-1",
					now: () => now ?? NOW,
				},
			);
		},
	};
}

Deno.test("with a relay key and an announced relay, the Graph is asked only through the relay", async () => {
	const test = await harness();
	test.backend.setRelay(SYNTHETIC_RELAY_URL);
	const response = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 200, "status");
	assertEquals((await response.json()).status, "bound", "signed in");
	assert(test.network.relayed() >= 1, "the Graph call went through the relay");
	assertEquals(test.network.direct(), 0, "no direct Graph call");
	assertEquals(
		test.backend.calls().filter((call) => call === "rpc zalo_relay_current")
			.length,
		1,
		"the relay address is asked once per request",
	);
	for (const body of test.network.wire()) {
		assert(
			!body.includes(test.token),
			"the token never crosses the tunnel in clear text",
		);
		assert(
			!body.includes(APP_SECRET),
			"the App secret never crosses the tunnel",
		);
	}
	for (const line of test.lines) {
		assert(
			!line.includes(test.keyText),
			`a log line names the relay key: ${line}`,
		);
	}
});

Deno.test("with a relay key but no relay announced, the Graph is asked directly", async () => {
	const test = await harness();
	const response = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 200, "status");
	assertEquals(test.network.relayed(), 0, "nothing relayed");
	assert(test.network.direct() >= 1, "asked directly");
});

Deno.test("without a relay key the relay is never consulted", async () => {
	const test = await harness();
	test.backend.setRelay(SYNTHETIC_RELAY_URL);
	const response = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ ZALO_APP_SECRET_BRAND_1: APP_SECRET },
	);
	assertEquals(response.status, 200, "status");
	assertEquals(test.network.relayed(), 0, "nothing relayed");
	assert(
		!test.backend.calls().includes("rpc zalo_relay_current"),
		"the database was not asked for a relay",
	);
});

Deno.test("a relay that cannot be reached answers 502 zalo_unavailable, not a refusal", async () => {
	const test = await harness();
	test.backend.setRelay(SYNTHETIC_RELAY_URL);
	test.network.setDown(true);
	const response = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 502, "status");
	assertEquals((await response.json()).error, "zalo_unavailable", "error");
});

Deno.test("a relay key that is not 32 bytes answers 500 not_configured", async () => {
	const test = await harness();
	test.backend.setRelay(SYNTHETIC_RELAY_URL);
	const response = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ ZALO_APP_SECRET_BRAND_1: APP_SECRET, ZALO_RELAY_KEY: "c2hvcnQ=" },
	);
	assertEquals(response.status, 500, "status");
	assertEquals((await response.json()).error, "not_configured", "error");
});

Deno.test("a sealed, fresh announcement stores the relay address", async () => {
	const test = await harness();
	const relay = await sealAnnouncement(test.key, {
		url: SYNTHETIC_RELAY_URL,
		at: NOW - 1000,
	});
	const response = await test.send({ relay });
	assertEquals(response.status, 200, "status");
	assertEquals(await response.json(), { status: "relay_announced" }, "answer");
	assertEquals(test.backend.relay()?.url, SYNTHETIC_RELAY_URL, "stored");
	assertEquals(test.lines, ["zalo-session request-1: relay announced"], "log");
});

Deno.test("an announcement under another key, stale, for a bad address or with extra fields is refused before the database", async () => {
	const test = await harness();
	const other = await importRelayKey(newRelayKey());
	const cases: Array<{
		body: unknown;
		status: number;
		error: string;
		label: string;
		now?: number;
	}> = [
		{
			body: {
				relay: await sealAnnouncement(other, {
					url: SYNTHETIC_RELAY_URL,
					at: NOW,
				}),
			},
			status: 401,
			error: "relay_refused",
			label: "another key",
		},
		{
			body: {
				relay: await sealAnnouncement(test.key, {
					url: SYNTHETIC_RELAY_URL,
					at: NOW - 120_001,
				}),
			},
			status: 401,
			error: "relay_refused",
			label: "older than two minutes",
		},
		{
			body: {
				relay: await sealAnnouncement(test.key, {
					url: "https://127.0.0.1",
					at: NOW,
				}),
			},
			status: 401,
			error: "relay_refused",
			label: "an IP address",
		},
		{
			body: { relay: "not sealed" },
			status: 401,
			error: "relay_refused",
			label: "junk",
		},
		{
			body: { relay: 42 },
			status: 400,
			error: "invalid_relay",
			label: "not a string",
		},
		{
			body: {
				relay: await sealAnnouncement(test.key, {
					url: SYNTHETIC_RELAY_URL,
					at: NOW,
				}),
				brand: "brand-1",
			},
			status: 400,
			error: "invalid_relay",
			label: "an extra field",
		},
	];
	for (const item of cases) {
		const response = await test.send(item.body);
		assertEquals(response.status, item.status, `${item.label}: status`);
		assertEquals(
			(await response.json()).error,
			item.error,
			`${item.label}: error`,
		);
	}
	assertEquals(test.backend.relay(), null, "nothing stored");
	assert(
		!test.backend.calls().includes("rpc zalo_relay_announce"),
		"the database was never asked",
	);
});

Deno.test("an announcement to a function without a relay key answers 404 relay_not_configured", async () => {
	const test = await harness();
	const relay = await sealAnnouncement(test.key, {
		url: SYNTHETIC_RELAY_URL,
		at: NOW,
	});
	const response = await test.send(
		{ relay },
		{ ZALO_APP_SECRET_BRAND_1: APP_SECRET },
	);
	assertEquals(response.status, 404, "status");
	assertEquals((await response.json()).error, "relay_not_configured", "error");
});
