import { constantTimeEqual, hmacSha256Hex, signatureEqual } from "./crypto.js";
import {
	isRecord,
	type NotificationOutcome,
	type NotificationReply,
	type NotificationRequest,
	type NotificationResult,
	type PaymentEvent,
} from "./types.js";
import { referenceCandidates } from "./vietqr.js";

/**
 * Bank-notification adapters for the dynamic VietQR (ADR-067). The money goes straight to the store's own account; a
 * service that watches the account posts each incoming transfer to `bank-webhook`. An adapter proves the post came
 * from that service (an HMAC signature or an API key, per service) and turns it into neutral events: a transaction id
 * of the service, the amount, and the reference-shaped words of the transfer's text. Matching a reference and the
 * exact amount to an attempt is the database's job, never the adapter's.
 *
 * - mock: for tests and local development, HMAC-SHA256 over "<t>.<raw body>" in `x-mock-signature: t=<ms>,v1=<hex>`,
 *   five minutes either way, a batch of transactions.
 * - sepay: SePay's webhook with API-key authentication (`Authorization: Apikey <key>`), one transaction per post,
 *   answered `{"success": true}` (built from SePay's public page of 2026-11; to confirm in its sandbox).
 */

export const BANK_ADAPTERS = ["mock", "sepay"] as const;
export type BankAdapterId = (typeof BANK_ADAPTERS)[number];
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const MOCK_MAX_SKEW_MS = 5 * 60_000;
export const MAX_TRANSACTIONS_PER_POST = 20;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const TEXT_MAX = 500;

export interface BankSettings {
	readonly accountNumber: string;
	readonly referencePrefix: string;
}

export interface BankAdapter {
	readonly id: BankAdapterId;
	verify(
		request: NotificationRequest,
		secret: string,
		settings: BankSettings,
	): Promise<NotificationResult>;
	reply(outcome: NotificationOutcome): NotificationReply;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function wholeAmount(value: unknown): number | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && /^[1-9][0-9]{0,14}$/.test(value)) {
		return Number(value);
	}
	return null;
}

function transactionId(value: unknown): string | null {
	const text =
		typeof value === "number" && Number.isSafeInteger(value)
			? String(value)
			: value;
	return typeof text === "string" && TRANSACTION_ID_PATTERN.test(text)
		? text
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.slice(0, TEXT_MAX) : "";
}

function isoTime(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 40) {
		return null;
	}
	const at = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
	return Number.isNaN(at) ? null : new Date(at).toISOString();
}

function incoming(
	adapter: BankAdapterId,
	id: string,
	amount: number,
	texts: readonly string[],
	prefix: string,
	occurredAt: string | null,
): PaymentEvent {
	const candidates: string[] = [];
	for (const part of texts) {
		for (const candidate of referenceCandidates(part, prefix)) {
			if (!candidates.includes(candidate) && candidates.length < 5) {
				candidates.push(candidate);
			}
		}
	}
	return {
		providerRef: `${adapter}:${id}`,
		amount,
		success: true,
		reason: null,
		reference: null,
		candidates,
		platformOrderId: null,
		occurredAt,
	};
}

/** The mock's signature header for a body at an instant: what a test or the local stand-in bank sends. */
export async function mockSignature(
	secret: string,
	rawBody: string,
	at: number,
): Promise<string> {
	return `t=${at},v1=${await hmacSha256Hex(secret, `${at}.${rawBody}`)}`;
}

export const mockBankAdapter: BankAdapter = {
	id: "mock",
	async verify(request, secret, settings) {
		const header = request.headers[MOCK_SIGNATURE_HEADER] ?? "";
		const match = /^t=([0-9]{13}),v1=([0-9a-f]{64})$/.exec(header);
		if (match === null) {
			return { ok: false, refusal: "signature" };
		}
		const at = Number(match[1]);
		const expected = await hmacSha256Hex(secret, `${at}.${request.rawBody}`);
		if (!signatureEqual(expected, match[2] ?? "")) {
			return { ok: false, refusal: "signature" };
		}
		if (Math.abs(request.receivedAt - at) > MOCK_MAX_SKEW_MS) {
			return { ok: false, refusal: "stale" };
		}
		const body = parseJson(request.rawBody);
		if (
			!isRecord(body) ||
			!Array.isArray(body.transactions) ||
			body.transactions.length === 0 ||
			body.transactions.length > MAX_TRANSACTIONS_PER_POST
		) {
			return { ok: false, refusal: "malformed" };
		}
		const events: PaymentEvent[] = [];
		for (const entry of body.transactions) {
			if (!isRecord(entry)) {
				return { ok: false, refusal: "malformed" };
			}
			const id = transactionId(entry.id);
			const amount = wholeAmount(entry.amount);
			if (
				id === null ||
				amount === null ||
				(entry.direction !== "in" && entry.direction !== "out")
			) {
				return { ok: false, refusal: "malformed" };
			}
			if (entry.account_number !== settings.accountNumber) {
				return { ok: false, refusal: "wrong_account" };
			}
			if (entry.direction === "in") {
				events.push(
					incoming(
						"mock",
						id,
						amount,
						[text(entry.content)],
						settings.referencePrefix,
						isoTime(entry.at),
					),
				);
			}
		}
		return { ok: true, events };
	},
	reply(outcome) {
		switch (outcome) {
			case "accepted":
			case "replayed":
				return { status: 200, body: { ok: true } };
			case "refused":
				return { status: 401, body: { ok: false } };
			default:
				return { status: 500, body: { ok: false } };
		}
	},
};

export const sepayBankAdapter: BankAdapter = {
	id: "sepay",
	async verify(request, secret, settings) {
		const header = request.headers.authorization ?? "";
		const match = /^apikey (.{1,256})$/i.exec(header.trim());
		if (match === null || !constantTimeEqual(match[1] ?? "", secret)) {
			return { ok: false, refusal: "signature" };
		}
		const body = parseJson(request.rawBody);
		if (!isRecord(body)) {
			return { ok: false, refusal: "malformed" };
		}
		const id = transactionId(body.id);
		const amount = wholeAmount(body.transferAmount);
		if (
			id === null ||
			amount === null ||
			(body.transferType !== "in" && body.transferType !== "out")
		) {
			return { ok: false, refusal: "malformed" };
		}
		const accounts = [body.accountNumber, body.subAccount].filter(
			(value): value is string => typeof value === "string" && value !== "",
		);
		if (!accounts.includes(settings.accountNumber)) {
			return { ok: false, refusal: "wrong_account" };
		}
		if (body.transferType !== "in") {
			return { ok: true, events: [] };
		}
		return {
			ok: true,
			events: [
				incoming(
					"sepay",
					id,
					amount,
					[text(body.code), text(body.content), text(body.description)],
					settings.referencePrefix,
					isoTime(body.transactionDate),
				),
			],
		};
	},
	reply(outcome) {
		switch (outcome) {
			case "accepted":
			case "replayed":
				return { status: 200, body: { success: true } };
			case "refused":
				return { status: 401, body: { success: false } };
			default:
				return { status: 500, body: { success: false } };
		}
	},
};

export function bankAdapterFor(id: string): BankAdapter | null {
	switch (id) {
		case "mock":
			return mockBankAdapter;
		case "sepay":
			return sepayBankAdapter;
		default:
			return null;
	}
}
