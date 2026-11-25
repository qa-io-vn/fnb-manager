import { importRelayKey, newRelayKey } from "@fnb/zalo";
import {
	createFakeBackend,
	createMockZalo,
	createRelayNetwork,
	SYNTHETIC_RELAY_URL,
} from "@fnb/zalo/testing";
import { handleZaloPhone } from "./handler.ts";

// ADR-057: with a relay key the phone exchange (which carries the App secret) goes through the relay, sealed.

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

const APP_SECRET = "synthetic-app-secret-brand-1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const APP = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const MEMBER_EMAIL = "zalo-phone-relay@example.com";
const NUMBER = "84912345678";

Deno.test("the phone exchange goes through the relay and the App secret never crosses the tunnel in clear text", async () => {
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
		userId: MEMBER,
		tenantId: TENANT,
		role: "owner",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1"],
		email: MEMBER_EMAIL,
	});
	backend.setRelay(SYNTHETIC_RELAY_URL);
	const session = (await backend.mintSession(MEMBER_EMAIL)).accessToken;
	const keyText = newRelayKey();
	const network = createRelayNetwork(await importRelayKey(keyText), zalo.fetch);
	const accessToken = zalo.issueAccessToken(APP_SECRET, {
		id: "8800000000000000001",
	});
	const phoneToken = zalo.issuePhoneToken(accessToken, NUMBER);
	const lines: string[] = [];
	const response = await handleZaloPhone(
		new Request("http://127.0.0.1:54321/functions/v1/zalo-phone", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${session}`,
			},
			body: JSON.stringify({
				brand: "brand-1",
				access_token: accessToken,
				phone_token: phoneToken,
			}),
		}),
		{ ZALO_APP_SECRET_BRAND_1: APP_SECRET, ZALO_RELAY_KEY: keyText },
		{
			fetch: network.fetch,
			backend,
			log: (line) => lines.push(line),
			requestId: () => "request-1",
		},
	);
	assert(response.status === 200, `status ${response.status}`);
	const answer = await response.json();
	assert(
		answer.phone_number === `+84${NUMBER.slice(2)}`,
		"the number is decoded",
	);
	assert(
		network.relayed() === 1 && network.direct() === 0,
		"exactly one relayed Graph call, none direct",
	);
	for (const body of network.wire()) {
		assert(!body.includes(APP_SECRET), "the App secret is sealed on the wire");
		assert(!body.includes(phoneToken), "the phone token is sealed on the wire");
	}
	for (const line of lines) {
		assert(
			!line.includes(keyText) && !line.includes(NUMBER),
			`a log line leaks: ${line}`,
		);
	}
});
