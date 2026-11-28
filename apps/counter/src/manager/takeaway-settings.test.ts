import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import { RpcError } from "../lib/rpc";
import {
	checkTakeaway,
	formOf,
	SLOT_MINUTES,
	type TakeawayForm,
	takeawayWriteError,
} from "./takeaway-settings";

// counter:unit/takeaway-settings (C17 "Mang đi hẹn giờ", ADR-072): the manager's form refuses what the table's CHECK
// constraints refuse, so a refusal is said under its field before any call.
// - boundary values of the preparation time (-1, 0, 120, 121) and of the orders per slot (0, 1, 100, 101);
// - equivalence partitions of the slot length: each of 5, 10, 15, 20, 30, 60 valid; 0, 7, 45, 90 invalid;
// - error guessing: an empty field, a decimal, spaces, letters, a negative sign, several fields wrong at once;
// - the server's refusals in words: RLS (42501, or an update that wrote no row), a bound (23514), the network.

const valid: TakeawayForm = { prep: "15", slot: "15", limit: "6" };

describe("the preparation time (BVA 0..120)", () => {
	it.each([
		["0", true],
		["120", true],
		["121", false],
		["-1", false],
	])("%s minutes is accepted: %s", (prep, ok) => {
		const check = checkTakeaway({ ...valid, prep });
		expect(check.ok).toBe(ok);
		if (!check.ok) expect(check.errors.prep).toBe("takeaway.error.prep");
	});
});

describe("the orders per slot (BVA 1..100)", () => {
	it.each([
		["0", false],
		["1", true],
		["100", true],
		["101", false],
	])("%s orders is accepted: %s", (limit, ok) => {
		const check = checkTakeaway({ ...valid, limit });
		expect(check.ok).toBe(ok);
		if (!check.ok) expect(check.errors.limit).toBe("takeaway.error.limit");
	});
});

describe("the slot length (EP: a divisor of an hour)", () => {
	it.each(SLOT_MINUTES.map((minutes) => String(minutes)))(
		"%s minutes is accepted",
		(slot) => {
			expect(checkTakeaway({ ...valid, slot }).ok).toBe(true);
		},
	);
	it.each(["0", "7", "45", "90"])("%s minutes is refused", (slot) => {
		const check = checkTakeaway({ ...valid, slot });
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.errors.slot).toBe("takeaway.error.slot");
	});
});

describe("what is typed (error guessing)", () => {
	it("refuses an empty field, a decimal, letters and a sign, and accepts spaces around a number", () => {
		for (const prep of ["", "1.5", "mười", "+5", "1e2"])
			expect(checkTakeaway({ ...valid, prep }).ok).toBe(false);
		expect(checkTakeaway({ ...valid, prep: " 20 " })).toEqual({
			ok: true,
			value: {
				prep_minutes: 20,
				takeaway_slot_minutes: 15,
				takeaway_slot_limit: 6,
			},
		});
	});

	it("names every wrong field at once", () => {
		const check = checkTakeaway({ prep: "200", slot: "7", limit: "0" });
		expect(check.ok).toBe(false);
		if (!check.ok)
			expect(Object.keys(check.errors).sort()).toEqual([
				"limit",
				"prep",
				"slot",
			]);
	});

	it("shows the store's numbers as typed text", () => {
		expect(
			formOf({
				prep_minutes: 10,
				takeaway_slot_minutes: 30,
				takeaway_slot_limit: 8,
			}),
		).toEqual({ prep: "10", slot: "30", limit: "8" });
	});
});

describe("the server's refusals in words", () => {
	it("says the person does not manage the store, a value was refused, or the network dropped", () => {
		expect(takeawayWriteError(new RpcError("42501", "no row written"))).toBe(
			"takeaway.error.scope",
		);
		expect(
			takeawayWriteError(
				new RpcError("unknown", "new row violates row-level security policy"),
			),
		).toBe("takeaway.error.scope");
		expect(takeawayWriteError(new RpcError("23514", "check"))).toBe(
			"takeaway.error.invalid",
		);
		expect(takeawayWriteError(new RpcError("network", "fetch failed"))).toBe(
			"common.network",
		);
		expect(takeawayWriteError(new Error("other"))).toBe("common.failed");
	});

	it("has every message in both languages", () => {
		const keys = [
			"takeaway.error.prep",
			"takeaway.error.slot",
			"takeaway.error.limit",
			"takeaway.error.scope",
			"takeaway.error.invalid",
		];
		for (const key of keys) {
			expect((vi as Record<string, string>)[key]).toBeTruthy();
			expect((en as Record<string, string>)[key]).toBeTruthy();
		}
	});
});
