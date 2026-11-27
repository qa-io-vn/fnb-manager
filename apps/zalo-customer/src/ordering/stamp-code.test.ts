import type { Order } from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { exportText, plainValue } from "./data-export";
import { readyLine } from "./order-view";
import { cancellableRequest } from "./requests-screen";
import { codePhase, countdown, minutesUntil } from "./stamp-code";

// Unit tests of the customer app's phase-1 rules (native-till.md 16.4 to 16.8):
// - C20 the member code's phases (BVA at the refresh time and the expiry: each boundary belongs to the next phase),
//   the countdown at 10:00, 09:48, 00:01, 0 and past (never negative), the minutes left offline;
// - C06/C14 the ready line (EP: no estimate, a future one, exactly now, a past one, a state without one, a malformed
//   one);
// - the requests a customer may cancel (EP by status);
// - C19 the export's plain values and its copy as JSON text.

const ISSUED = Date.parse("2026-11-28T05:00:00Z");
const CODE = {
	refreshAt: new Date(ISSUED + 9 * 60_000).toISOString(),
	expiresAt: new Date(ISSUED + 10 * 60_000).toISOString(),
};

describe("the member code's phase (BVA)", () => {
	it("is fresh before the refresh time, refreshing from it, expired from the expiry", () => {
		expect(codePhase(CODE, ISSUED)).toBe("fresh");
		expect(codePhase(CODE, ISSUED + 9 * 60_000 - 1)).toBe("fresh");
		expect(codePhase(CODE, ISSUED + 9 * 60_000)).toBe("refreshing");
		expect(codePhase(CODE, ISSUED + 10 * 60_000 - 1)).toBe("refreshing");
		expect(codePhase(CODE, ISSUED + 10 * 60_000)).toBe("expired");
		expect(codePhase(CODE, ISSUED + 60 * 60_000)).toBe("expired");
	});
});

describe("the countdown (BVA)", () => {
	const refresh = CODE.refreshAt;
	const at = (msBefore: number) => Date.parse(refresh) - msBefore;
	it("counts minutes and seconds down to 00:00, never below", () => {
		expect(countdown(refresh, ISSUED)).toBe("09:00");
		expect(countdown(refresh, at(9 * 60_000 + 1))).toBe("09:01");
		expect(countdown(refresh, at(588_000))).toBe("09:48");
		expect(countdown(refresh, at(1000))).toBe("00:01");
		expect(countdown(refresh, at(1))).toBe("00:01");
		expect(countdown(refresh, at(0))).toBe("00:00");
		expect(countdown(refresh, at(-5000))).toBe("00:00");
		expect(countdown(new Date(ISSUED + 600_000).toISOString(), ISSUED)).toBe(
			"10:00",
		);
	});

	it("says the whole minutes left offline, rounded up, never below 0", () => {
		expect(minutesUntil(CODE.expiresAt, ISSUED)).toBe(10);
		expect(minutesUntil(CODE.expiresAt, ISSUED + 3 * 60_000 + 1)).toBe(7);
		expect(minutesUntil(CODE.expiresAt, ISSUED + 10 * 60_000)).toBe(0);
		expect(minutesUntil(CODE.expiresAt, ISSUED + 11 * 60_000)).toBe(0);
	});
});

describe("the ready line (EP)", () => {
	const order = (
		status: Order["status"],
		readyEstimateAt: string | null,
	): Pick<Order, "status" | "readyEstimateAt"> => ({ status, readyEstimateAt });
	const now = Date.parse("2026-11-28T05:00:00Z");
	it("says when an accepted or preparing order should be ready, then that it is nearly done", () => {
		expect(readyLine(order("accepted", "2026-11-28T05:10:00Z"), now)).toEqual({
			kind: "at",
			at: "2026-11-28T05:10:00Z",
		});
		expect(readyLine(order("preparing", "2026-11-28T05:00:01Z"), now)).toEqual({
			kind: "at",
			at: "2026-11-28T05:00:01Z",
		});
		expect(readyLine(order("preparing", "2026-11-28T05:00:00Z"), now)).toEqual({
			kind: "soon",
		});
		expect(readyLine(order("accepted", "2026-11-28T04:50:00Z"), now)).toEqual({
			kind: "soon",
		});
	});

	it("says nothing without an estimate, in another state or for a malformed time", () => {
		expect(readyLine(order("accepted", null), now)).toBeNull();
		for (const status of [
			"awaiting_payment",
			"ready",
			"serving",
			"completed",
			"cancelled",
		] as const)
			expect(
				readyLine(order(status, "2026-11-28T05:10:00Z"), now),
				status,
			).toBeNull();
		expect(readyLine(order("accepted", "soon"), now)).toBeNull();
	});
});

describe("the requests a customer may cancel (EP)", () => {
	it("are the new, proposed and confirmed ones", () => {
		expect(cancellableRequest({ status: "new" })).toBe(true);
		expect(cancellableRequest({ status: "proposed" })).toBe(true);
		expect(cancellableRequest({ status: "confirmed" })).toBe(true);
		expect(cancellableRequest({ status: "declined" })).toBe(false);
		expect(cancellableRequest({ status: "cancelled" })).toBe(false);
	});
});

describe("the export's values", () => {
	it("are plain text for single values, a dash for null or empty, nothing for lists and records", () => {
		expect(plainValue("Trà <b>đào</b>")).toBe("Trà <b>đào</b>");
		expect(plainValue(29000)).toBe("29000");
		expect(plainValue(true)).toBe("✓");
		expect(plainValue(false)).toBe("✗");
		expect(plainValue(null)).toBe("—");
		expect(plainValue("")).toBe("—");
		expect(plainValue([])).toBeNull();
		expect(plainValue({})).toBeNull();
	});

	it("copy as one indented JSON text of the whole answer", () => {
		const raw = { generated_at: "2026-11-28T05:00:00Z", login: { a: 1 } };
		expect(
			JSON.parse(
				exportText({
					generatedAt: raw.generated_at,
					sections: [{ key: "login", value: raw.login }],
					raw,
				}),
			),
		).toEqual(raw);
	});
});
