import type { CanonicalDailyTotal } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	detectChangedDays,
	type LocalDayTotal,
	type SyncCheckRow,
} from "../../src/index.js";

const DATES = ["2026-11-03", "2026-11-04", "2026-11-05"];

function pos(
	businessDate: string,
	invoiceCount: number,
	netAmount: number,
): CanonicalDailyTotal {
	return { businessDate, invoiceCount, netAmount, raw: null };
}

function check(
	businessDate: string,
	count: number,
	net: string,
	overrides: Partial<SyncCheckRow> = {},
): SyncCheckRow {
	return {
		tenant_id: "tenant-1",
		store_id: "store-1",
		business_date: businessDate,
		source_invoice_count: count,
		source_net_amount: net,
		local_invoice_count: count,
		local_net_amount: net,
		is_matched: true,
		...overrides,
	};
}

function local(
	businessDate: string,
	invoiceCount: number,
	netAmount: string,
): LocalDayTotal {
	return {
		business_date: businessDate,
		invoice_count: invoiceCount,
		net_amount: netAmount,
	};
}

describe("change detection", () => {
	it("skips a day whose POS totals equal its matched check and the stored sales", () => {
		const decisions = detectChangedDays({
			dates: DATES,
			controlTotals: [
				pos("2026-11-03", 2, 90_000),
				pos("2026-11-04", 1, 45_000),
				pos("2026-11-05", 3, 135_000),
			],
			storedChecks: [
				check("2026-11-03", 2, "90000.00"),
				check("2026-11-04", 1, "45000.00"),
				check("2026-11-05", 3, "135000.00"),
			],
			localTotals: [
				local("2026-11-03", 2, "90000.00"),
				local("2026-11-04", 1, "45000.00"),
				local("2026-11-05", 3, "135000.00"),
			],
		});
		expect(decisions).toEqual([
			{
				date: "2026-11-03",
				reason: "unchanged",
				pull: false,
				posInvoiceCount: 2,
			},
			{
				date: "2026-11-04",
				reason: "unchanged",
				pull: false,
				posInvoiceCount: 1,
			},
			{
				date: "2026-11-05",
				reason: "unchanged",
				pull: false,
				posInvoiceCount: 3,
			},
		]);
	});

	it("pulls a day that was never checked, even an empty one", () => {
		const decisions = detectChangedDays({
			dates: DATES,
			controlTotals: [pos("2026-11-05", 1, 45_000)],
			storedChecks: [
				check("2026-11-03", 0, "0.00"),
				check("2026-11-05", 1, "45000.00"),
			],
			localTotals: [local("2026-11-05", 1, "45000.00")],
		});
		expect(decisions.map((day) => [day.date, day.reason, day.pull])).toEqual([
			["2026-11-03", "unchanged", false],
			["2026-11-04", "unchecked", true],
			["2026-11-05", "unchanged", false],
		]);
	});

	it("pulls a day whose last check did not match", () => {
		const [day] = detectChangedDays({
			dates: ["2026-11-05"],
			controlTotals: [pos("2026-11-05", 3, 135_000)],
			storedChecks: [
				check("2026-11-05", 3, "135000.00", {
					local_invoice_count: 2,
					local_net_amount: "90000.00",
					is_matched: false,
				}),
			],
			localTotals: [local("2026-11-05", 2, "90000.00")],
		});
		expect(day).toMatchObject({ reason: "unmatched", pull: true });
	});

	it("pulls a day when the POS count or net moved since the check, by any amount", () => {
		const decisions = detectChangedDays({
			dates: ["2026-11-04", "2026-11-05"],
			controlTotals: [
				pos("2026-11-04", 2, 90_000),
				pos("2026-11-05", 3, 135_000.01),
			],
			storedChecks: [
				check("2026-11-04", 1, "45000.00"),
				check("2026-11-05", 3, "135000.00"),
			],
			localTotals: [
				local("2026-11-04", 1, "45000.00"),
				local("2026-11-05", 3, "135000.00"),
			],
		});
		expect(decisions.map((day) => [day.reason, day.posInvoiceCount])).toEqual([
			["pos_changed", 2],
			["pos_changed", 3],
		]);
	});

	it("pulls a day whose stored sales no longer match the POS", () => {
		const [day] = detectChangedDays({
			dates: ["2026-11-05"],
			controlTotals: [pos("2026-11-05", 3, 135_000)],
			storedChecks: [check("2026-11-05", 3, "135000.00")],
			localTotals: [local("2026-11-05", 2, "90000.00")],
		});
		expect(day).toMatchObject({ reason: "local_changed", pull: true });
	});

	it("applies the check tolerance to the stored sales but compares the POS exactly", () => {
		const within = detectChangedDays({
			dates: ["2026-11-05"],
			controlTotals: [pos("2026-11-05", 3, 135_000)],
			storedChecks: [check("2026-11-05", 3, "135000.00")],
			localTotals: [local("2026-11-05", 3, "134500.00")],
		});
		expect(within[0]?.reason).toBe("unchanged");
		const strict = detectChangedDays({
			dates: ["2026-11-05"],
			controlTotals: [pos("2026-11-05", 3, 135_000)],
			storedChecks: [check("2026-11-05", 3, "135000.00")],
			localTotals: [local("2026-11-05", 3, "134500.00")],
			tolerance: { absolute: 100, relative: 0 },
		});
		expect(strict[0]?.reason).toBe("local_changed");
	});

	it("adds several POS rows of one date before comparing", () => {
		const [day] = detectChangedDays({
			dates: ["2026-11-05"],
			controlTotals: [
				pos("2026-11-05", 1, 45_000),
				pos("2026-11-05", 2, 90_000),
			],
			storedChecks: [check("2026-11-05", 3, "135000.00")],
			localTotals: [local("2026-11-05", 3, "135000.00")],
		});
		expect(day).toEqual({
			date: "2026-11-05",
			reason: "unchanged",
			pull: false,
			posInvoiceCount: 3,
		});
	});
});
