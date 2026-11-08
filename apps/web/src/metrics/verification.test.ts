import { describe, expect, it } from "vitest";
import { verificationOf } from "./verification";

const storeDays = [
	{ storeId: "A", date: "2026-11-07" },
	{ storeId: "B", date: "2026-11-07" },
];

const check = (storeId: string, isMatched: boolean) => ({
	storeId,
	businessDate: "2026-11-07",
	isMatched,
});

describe("verificationOf", () => {
	it("is verified when every shown store-day has a matched check", () => {
		expect(
			verificationOf(
				{ kind: "checked", checks: [check("A", true), check("B", true)] },
				storeDays,
			),
		).toBe("verified");
	});

	it("is unverified when one store-day is unmatched", () => {
		expect(
			verificationOf(
				{ kind: "checked", checks: [check("A", true), check("B", false)] },
				storeDays,
			),
		).toBe("unverified");
	});

	it("is unverified when one store-day has no check yet", () => {
		expect(
			verificationOf(
				{ kind: "checked", checks: [check("A", true)] },
				storeDays,
			),
		).toBe("unverified");
	});

	it("ignores checks of other days", () => {
		expect(
			verificationOf(
				{
					kind: "checked",
					checks: [
						check("A", true),
						{ storeId: "B", businessDate: "2026-11-06", isMatched: true },
					],
				},
				storeDays,
			),
		).toBe("unverified");
	});

	it("is unverified when no store-day is shown", () => {
		expect(verificationOf({ kind: "checked", checks: [] }, [])).toBe(
			"unverified",
		);
	});

	it("marks sample rows as sample data", () => {
		expect(verificationOf({ kind: "sample" }, storeDays)).toBe("sample");
	});
});
