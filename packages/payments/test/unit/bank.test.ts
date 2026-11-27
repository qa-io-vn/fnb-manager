import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	bankAdapterFor,
	MOCK_MAX_SKEW_MS,
	mockBankAdapter,
	mockSignature,
	type NotificationRequest,
	sepayBankAdapter,
} from "../../src/index.js";

// payments:unit/bank: the bank-notification adapters. Security cases: a forged or replayed-late signature, a missing
// header, another account, a wrong API key (and its scheme's case); equivalence classes of the bodies (money in, money
// out, malformed); the answers each service expects. The adapters never decide a payment: they only read events.

const SECRET = "synthetic-bank-secret";
const settings = { accountNumber: "0123456789", referencePrefix: "FNB" };
const NOW = Date.UTC(2026, 10, 28, 3, 0, 0);

function request(
	rawBody: string,
	headers: Record<string, string>,
	receivedAt = NOW,
): NotificationRequest {
	return { path: "", headers, rawBody, receivedAt };
}

const mockBody = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		transactions: [
			{
				id: "tx-1",
				amount: 64_000,
				content: "FNB7K2M9Q4T",
				account_number: "0123456789",
				direction: "in",
				...overrides,
			},
		],
	});

describe("the mock bank", () => {
	it("signs t.<body> with HMAC-SHA256 in x-mock-signature", async () => {
		const body = mockBody();
		const header = await mockSignature(SECRET, body, NOW);
		expect(header).toBe(
			`t=${NOW},v1=${createHmac("sha256", SECRET).update(`${NOW}.${body}`).digest("hex")}`,
		);
	});

	it("reads an incoming transfer as an event with its candidates", async () => {
		const body = mockBody();
		const result = await mockBankAdapter.verify(
			request(body, {
				"x-mock-signature": await mockSignature(SECRET, body, NOW),
			}),
			SECRET,
			settings,
		);
		expect(result).toEqual({
			ok: true,
			events: [
				{
					providerRef: "mock:tx-1",
					amount: 64_000,
					success: true,
					reason: null,
					reference: null,
					candidates: ["FNB7K2M9Q4T"],
					platformOrderId: null,
					occurredAt: null,
				},
			],
		});
	});

	it("ignores money going out", async () => {
		const body = mockBody({ direction: "out" });
		const result = await mockBankAdapter.verify(
			request(body, {
				"x-mock-signature": await mockSignature(SECRET, body, NOW),
			}),
			SECRET,
			settings,
		);
		expect(result).toEqual({ ok: true, events: [] });
	});

	it("refuses another key, a changed body and a missing header", async () => {
		const body = mockBody();
		expect(
			await mockBankAdapter.verify(
				request(body, {
					"x-mock-signature": await mockSignature("attacker", body, NOW),
				}),
				SECRET,
				settings,
			),
		).toEqual({
			ok: false,
			refusal: "signature",
		});
		const signature = await mockSignature(SECRET, body, NOW);
		expect(
			await mockBankAdapter.verify(
				request(mockBody({ amount: 99_000 }), {
					"x-mock-signature": signature,
				}),
				SECRET,
				settings,
			),
		).toEqual({
			ok: false,
			refusal: "signature",
		});
		expect(
			await mockBankAdapter.verify(request(body, {}), SECRET, settings),
		).toEqual({ ok: false, refusal: "signature" });
	});

	it("takes a signature five minutes old and refuses one a millisecond older (a replay)", async () => {
		const body = mockBody();
		const at = NOW - MOCK_MAX_SKEW_MS;
		const header = {
			"x-mock-signature": await mockSignature(SECRET, body, at),
		};
		expect(
			(await mockBankAdapter.verify(request(body, header), SECRET, settings))
				.ok,
		).toBe(true);
		expect(
			await mockBankAdapter.verify(
				request(body, header, NOW + 1),
				SECRET,
				settings,
			),
		).toEqual({ ok: false, refusal: "stale" });
	});

	it("refuses another account and malformed transactions", async () => {
		for (const [overrides, refusal] of [
			[{ account_number: "999" }, "wrong_account"],
			[{ amount: 0 }, "malformed"],
			[{ amount: 1.5 }, "malformed"],
			[{ id: "" }, "malformed"],
			[{ direction: "sideways" }, "malformed"],
		] as const) {
			const body = mockBody(overrides);
			expect(
				await mockBankAdapter.verify(
					request(body, {
						"x-mock-signature": await mockSignature(SECRET, body, NOW),
					}),
					SECRET,
					settings,
				),
			).toEqual({
				ok: false,
				refusal,
			});
		}
	});

	it("answers 200 handled, 401 refused, 500 to retry", () => {
		expect(mockBankAdapter.reply("accepted").status).toBe(200);
		expect(mockBankAdapter.reply("replayed").status).toBe(200);
		expect(mockBankAdapter.reply("refused").status).toBe(401);
		expect(mockBankAdapter.reply("error").status).toBe(500);
	});
});

const sepayBody = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		id: 92_704,
		gateway: "Synthetic Bank",
		transactionDate: "2026-11-28 10:08:33",
		accountNumber: "0123456789",
		subAccount: "",
		code: null,
		content: "FNB7K2M9Q4T chuyen tien",
		transferType: "in",
		description: "CT DEN FNB7K2M9Q4T",
		transferAmount: 64_000,
		accumulated: 1_000_000,
		referenceCode: "FT00000000001",
		...overrides,
	});

describe("SePay", () => {
	it("reads an incoming transfer behind the right API key", async () => {
		const result = await sepayBankAdapter.verify(
			request(sepayBody(), { authorization: `Apikey ${SECRET}` }),
			SECRET,
			settings,
		);
		expect(result.ok && result.events).toEqual([
			{
				providerRef: "sepay:92704",
				amount: 64_000,
				success: true,
				reason: null,
				reference: null,
				candidates: ["FNB7K2M9Q4T"],
				platformOrderId: null,
				occurredAt: new Date("2026-11-28T10:08:33").toISOString(),
			},
		]);
	});

	it("accepts the scheme in any case and a sub-account that is ours", async () => {
		expect(
			(
				await sepayBankAdapter.verify(
					request(sepayBody(), { authorization: `APIKEY ${SECRET}` }),
					SECRET,
					settings,
				)
			).ok,
		).toBe(true);
		const sub = sepayBody({ accountNumber: "555", subAccount: "0123456789" });
		expect(
			(
				await sepayBankAdapter.verify(
					request(sub, { authorization: `Apikey ${SECRET}` }),
					SECRET,
					settings,
				)
			).ok,
		).toBe(true);
	});

	it("refuses a wrong or missing key and another scheme", async () => {
		for (const authorization of [
			`Apikey ${SECRET}x`,
			`Bearer ${SECRET}`,
			"",
			`Apikey ${SECRET.toUpperCase()}`,
		]) {
			expect(
				await sepayBankAdapter.verify(
					request(sepayBody(), { authorization }),
					SECRET,
					settings,
				),
			).toEqual({ ok: false, refusal: "signature" });
		}
	});

	it("ignores money out, refuses another account and malformed bodies", async () => {
		const header = { authorization: `Apikey ${SECRET}` };
		expect(
			await sepayBankAdapter.verify(
				request(sepayBody({ transferType: "out" }), header),
				SECRET,
				settings,
			),
		).toEqual({ ok: true, events: [] });
		expect(
			await sepayBankAdapter.verify(
				request(sepayBody({ accountNumber: "555" }), header),
				SECRET,
				settings,
			),
		).toEqual({
			ok: false,
			refusal: "wrong_account",
		});
		for (const body of [
			"x",
			"[]",
			sepayBody({ transferAmount: -1 }),
			sepayBody({ id: null }),
		]) {
			expect(
				await sepayBankAdapter.verify(request(body, header), SECRET, settings),
			).toEqual({ ok: false, refusal: "malformed" });
		}
	});

	it("answers {success: true} with 200 when handled, 401 when refused", () => {
		expect(sepayBankAdapter.reply("accepted")).toEqual({
			status: 200,
			body: { success: true },
		});
		expect(sepayBankAdapter.reply("refused")).toEqual({
			status: 401,
			body: { success: false },
		});
	});

	it("is found by name, and nothing else is", () => {
		expect(bankAdapterFor("sepay")).toBe(sepayBankAdapter);
		expect(bankAdapterFor("mock")).toBe(mockBankAdapter);
		expect(bankAdapterFor("payos")).toBeNull();
	});
});
