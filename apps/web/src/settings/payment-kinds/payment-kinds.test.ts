import { describe, expect, it } from "vitest";
import type { PaymentMethodEntry } from "../source";
import {
	isPaymentKind,
	KIND_OPTIONS,
	kindChangesOf,
	methodEntryKeyOf,
	methodGroupsOf,
	savedKindDraftOf,
	withKindChanges,
} from "./payment-kinds";

function method(
	account: string,
	id: string,
	name: string,
	posKind: PaymentMethodEntry["posKind"],
	overrideKind: PaymentMethodEntry["overrideKind"] = null,
): PaymentMethodEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		externalId: id,
		name,
		posKind,
		overrideKind,
		kind: overrideKind ?? posKind,
		audit: null,
	};
}

const ENTRIES = [
	method("A", "CASH", "Tiền mặt", "cash"),
	method("A", "WALLET", "Ví QR", "other", "ewallet"),
	method("B", "CASH", "Tiền mặt", "cash"),
];

describe("payment kinds", () => {
	it("offer the six kinds of the database and nothing else", () => {
		expect(KIND_OPTIONS).toEqual([
			"cash",
			"ewallet",
			"bank_transfer",
			"card",
			"voucher",
			"other",
		]);
		expect(isPaymentKind("card")).toBe(true);
		expect(isPaymentKind("")).toBe(false);
	});

	it("key each method by its POS account, so the same id in two accounts stays apart", () => {
		const draft = savedKindDraftOf(ENTRIES);
		expect(Object.keys(draft)).toHaveLength(3);
		expect(draft[methodEntryKeyOf(ENTRIES[1] as PaymentMethodEntry)]).toBe(
			"ewallet",
		);
	});

	it("group the methods under their POS account in the order they come", () => {
		expect(
			methodGroupsOf(ENTRIES).map((group) => [
				group.posAccountName,
				group.entries.map((entry) => entry.externalId),
			]),
		).toEqual([
			["POS trà", ["CASH", "WALLET"]],
			["POS cà phê", ["CASH"]],
		]);
	});

	it("send only the changed methods, with As in the POS sent as a deleted override", () => {
		const draft = {
			...savedKindDraftOf(ENTRIES),
			"A|WALLET": null,
			"B|CASH": "card",
		} as const;
		expect(kindChangesOf(ENTRIES, draft)).toEqual([
			{ posAccountId: "A", paymentMethodExternalId: "WALLET", kind: null },
			{ posAccountId: "B", paymentMethodExternalId: "CASH", kind: "card" },
		]);
		expect(kindChangesOf(ENTRIES, savedKindDraftOf(ENTRIES))).toEqual([]);
	});

	it("write saved overrides into the cached list with the kind in effect", () => {
		const next = withKindChanges(ENTRIES, [
			{ posAccountId: "A", paymentMethodExternalId: "WALLET", kind: null },
			{ posAccountId: "B", paymentMethodExternalId: "CASH", kind: "card" },
		]);
		expect(
			next?.map((entry) => [entry.overrideKind, entry.kind, entry.posKind]),
		).toEqual([
			[null, "cash", "cash"],
			[null, "other", "other"],
			["card", "card", "cash"],
		]);
		expect(withKindChanges(undefined, [])).toBeUndefined();
	});
});
