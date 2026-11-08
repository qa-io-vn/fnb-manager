import { describe, expect, it } from "vitest";
import { adjustmentKey, type CanonicalAdjustment } from "../../src/index.js";

const occurredAt = new Date("2026-11-07T02:52:00.000Z");

describe("adjustmentKey", () => {
	it("joins kind, sale, line and change time so the same change always maps to one key", () => {
		expect(
			adjustmentKey({
				kind: "line_removed",
				saleExternalId: "sale-1",
				lineExternalId: "line-9",
				occurredAt,
			}),
		).toBe(`line_removed|sale-1|line-9|${occurredAt.getTime()}`);
	});

	it("leaves the line slot empty for whole-bill adjustments and separates kinds on the same sale", () => {
		const voided = adjustmentKey({
			kind: "voided",
			saleExternalId: "sale-1",
			occurredAt,
		});
		const edited = adjustmentKey({
			kind: "edited",
			saleExternalId: "sale-1",
			occurredAt,
		});
		expect(voided).toBe(`voided|sale-1||${occurredAt.getTime()}`);
		expect(voided).not.toBe(edited);
	});

	it("ignores fields that do not identify the change", () => {
		const first: CanonicalAdjustment = {
			kind: "edited",
			saleExternalId: "s",
			relatedSaleExternalId: "o",
			occurredAt,
			amount: 1,
			raw: null,
		};
		const second: CanonicalAdjustment = {
			kind: "edited",
			saleExternalId: "s",
			occurredAt,
			amount: 2,
			reason: "changed",
			raw: { source: "other" },
		};
		expect(adjustmentKey(first)).toBe(adjustmentKey(second));
	});
});
