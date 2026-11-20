import { matchedPathSchema } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { messages } from "../i18n";
import {
	BILL_FLAG_KEYS,
	billAnomalySummary,
	flagChips,
	flagsInRows,
	levelTwoShare,
	sortedBillAnomalies,
	staffModeStoreIds,
} from "./bill-anomalies";
import { DEFAULT_STORE_KNOBS } from "./demo-loyalty-source";
import { PATH_KEYS } from "./models";
import { BILL_ANOMALY_FLAGS, type BillAnomalyRow } from "./source";

function row(overrides: Partial<BillAnomalyRow> = {}): BillAnomalyRow {
	return {
		storeId: "s1",
		businessDate: "2026-11-19",
		staffUserId: "u1",
		staffName: "Lan",
		bills: 10,
		billsTotal: 900_000,
		level0: 0,
		level2: 9,
		confirmed: 9,
		queued: 1,
		disagreements: 0,
		disputes: 0,
		timedOut: 0,
		reversals: 0,
		auditsFailed: 0,
		redemptionsConfirmed: 0,
		topMemberShare: 0.2,
		amountOutliers: 0,
		maxBillsInHour: 2,
		peerMedianBills: 9,
		flags: [],
		...overrides,
	};
}

describe("the chips of the per-staff report", () => {
	it("names and explains every flag bill_anomaly_report raises, in both languages", () => {
		expect(Object.keys(BILL_FLAG_KEYS).sort()).toEqual(
			[...BILL_ANOMALY_FLAGS].sort(),
		);
		for (const words of Object.values(BILL_FLAG_KEYS)) {
			for (const key of [words.labelKey, words.explainKey]) {
				expect(messages.vi[key], key).toBeTruthy();
				expect(messages.en[key], key).toBeTruthy();
			}
		}
	});

	// Equivalence partitions of a flag: known, unknown, repeated, blank.
	it("maps known flags to their words, keeps an unknown one under a generic label and drops repeats and blanks", () => {
		expect(flagChips(["burst", "burst", "", "next_flag", "disputes"])).toEqual([
			{
				flag: "burst",
				known: true,
				labelKey: "loyalty.billAnomalies.flag.burst",
				explainKey: "loyalty.billAnomalies.flag.burst.explain",
			},
			{
				flag: "next_flag",
				known: false,
				labelKey: "loyalty.billAnomalies.flag.other",
				explainKey: "loyalty.billAnomalies.flag.other.explain",
			},
			{
				flag: "disputes",
				known: true,
				labelKey: "loyalty.billAnomalies.flag.disputes",
				explainKey: "loyalty.billAnomalies.flag.disputes.explain",
			},
		]);
		expect(flagChips([])).toEqual([]);
	});

	it("explains the flags that appear, in the catalogue's order and then the unknown ones", () => {
		expect(
			flagsInRows([
				row({ flags: ["burst", "zz_new"] }),
				row({ flags: ["peer_outlier", "burst"] }),
				row(),
			]),
		).toEqual(["peer_outlier", "burst", "zz_new"]);
	});
});

describe("the figures of the per-staff report", () => {
	// Boundary values of the level 2 share: no bill, none confirmed, all confirmed.
	it.each([
		[0, 0, null],
		[4, 0, 0],
		[4, 4, 1],
		[4, 1, 0.25],
	])(
		"with %d bills and %d at level 2 the share is %s",
		(bills, level2, share) => {
			expect(levelTwoShare(row({ bills, level2 }))).toBe(share);
		},
	);

	it("puts rows with more signals first, then the newest day, then the most bills", () => {
		const sorted = sortedBillAnomalies([
			row({ staffName: "A", businessDate: "2026-11-18", bills: 30 }),
			row({ staffName: "B", flags: ["burst"] }),
			row({ staffName: "C", businessDate: "2026-11-19", bills: 5 }),
			row({ staffName: "D", flags: ["burst", "disputes"] }),
			row({ staffName: "E", businessDate: "2026-11-19", bills: 8 }),
		]);
		expect(sorted.map((entry) => entry.staffName)).toEqual([
			"D",
			"B",
			"E",
			"C",
			"A",
		]);
	});

	it("sums rows, flagged rows and bills", () => {
		expect(
			billAnomalySummary([row({ flags: ["burst"] }), row({ bills: 3 })]),
		).toEqual({ rows: 2, flagged: 1, bills: 13 });
		expect(billAnomalySummary([])).toEqual({ rows: 0, flagged: 0, bills: 0 });
	});

	it("keeps only the chosen stores that confirm at the counter", () => {
		const settings = [
			{ ...DEFAULT_STORE_KNOBS, storeId: "a", updatedAt: "x" },
			{
				...DEFAULT_STORE_KNOBS,
				confirmation: "staff" as const,
				storeId: "b",
				updatedAt: "x",
			},
			{
				...DEFAULT_STORE_KNOBS,
				confirmation: "staff" as const,
				storeId: "c",
				updatedAt: "x",
			},
		];
		expect(staffModeStoreIds(["a", "b"], settings)).toEqual(["b"]);
		expect(staffModeStoreIds(["a"], settings)).toEqual([]);
		expect(staffModeStoreIds([], settings)).toEqual([]);
	});
});

describe("the ledger path of a counter bill", () => {
	// Equivalence partitions of matched_path: the POS paths, the bill path E,
	// and a value the ledger check refuses.
	it("accepts path E with its label and still refuses an unknown path", () => {
		expect(matchedPathSchema.parse("E")).toBe("E");
		expect(matchedPathSchema.safeParse("F").success).toBe(false);
		expect(PATH_KEYS.E).toBe("loyalty.path.E");
		expect(messages.vi[PATH_KEYS.E]).toBe("E · Hóa đơn tại quầy");
		expect(messages.en[PATH_KEYS.E]).toBe("E · Counter bill");
	});
});
