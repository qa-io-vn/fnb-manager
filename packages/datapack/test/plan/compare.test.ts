import { describe, expect, it } from "vitest";
import {
	comparePlans,
	initiativeTitleKey,
	type PlanForComparison,
	planKpiKey,
} from "../../src/plan/compare.js";
import type { StoredKpi } from "../../src/plan/record.js";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function kpi(
	storeIds: readonly string[],
	baseline: number,
	target: number,
	dueOn = "2027-02-09",
): StoredKpi {
	return {
		scope: storeIds.length === 1 ? "S1" : "ALL",
		store_ids: storeIds,
		baseline,
		target,
		lo: baseline * 0.95,
		hi: baseline * 1.05,
		initiatives: [1],
		due_on: dueOn,
		window_days: 28,
	};
}

const older: PlanForComparison = {
	id: "aaaaaaaa-0000-4000-8000-000000000001",
	createdAt: "2026-08-12T01:00:00Z",
	asOf: "2026-08-11",
	horizon: "90d",
	promptVersion: "1.0.0",
	packId: "0123456789abcdef".repeat(4),
	kpis: {
		avg_ticket: kpi([S2, S1], 90000, 95000, "2026-11-09"),
		discount_rate: kpi([S1, S2], 0.05, 0.04, "2026-11-09"),
		invoices: kpi([S1], 3000, 3300, "2026-11-09"),
	},
	initiativeTitles: [
		"Đẩy mạnh món dẫn đầu",
		"Kéo khách vào ngày vắng nhất",
		"Thanh toán nhanh hơn",
	],
};

const newer: PlanForComparison = {
	id: "bbbbbbbb-0000-4000-8000-000000000002",
	createdAt: "2026-11-12T01:00:00Z",
	asOf: "2026-11-11",
	horizon: "30d",
	promptVersion: "1.0.1",
	packId: "fedcba9876543210".repeat(4),
	kpis: {
		avg_ticket: kpi([S1, S2], 92000, 97000, "2026-12-11"),
		invoices: kpi([S1, S2], 6000, 6500, "2026-12-11"),
		size_l_share: kpi([S1, S2], 0.3, 0.33, "2026-12-11"),
	},
	initiativeTitles: [
		"  ĐẨY MẠNH   món dẫn đầu ",
		"Thanh toán nhanh hơn",
		"Mở rộng nhóm món dẫn đầu",
	],
};

const live = {
	asOf: "2026-11-20",
	current: new Map<string, number | null>([
		[planKpiKey("avg_ticket", [S1, S2]), 93000],
		[planKpiKey("invoices", [S1]), null],
	]),
};

describe("comparePlans headers", () => {
	it("gives each side its dates, horizon, prompt, pack prefix and initiative count", () => {
		const result = comparePlans(older, newer, live);
		expect(result.left).toEqual({
			id: older.id,
			createdAt: older.createdAt,
			asOf: "2026-08-11",
			horizon: "90d",
			promptVersion: "1.0.0",
			packIdPrefix: "01234567",
			initiatives: 3,
		});
		expect(result.right.packIdPrefix).toBe("fedcba98");
		expect(result.right.horizon).toBe("30d");
	});
});

describe("comparePlans KPIs", () => {
	const result = comparePlans(older, newer, live);
	const byKey = new Map(
		result.kpis.map((row) => [planKpiKey(row.metricId, row.storeIds), row]),
	);

	it("lists the union, each KPI once, by metric id and sorted store ids", () => {
		expect(
			result.kpis.map((row) => planKpiKey(row.metricId, row.storeIds)),
		).toEqual([
			planKpiKey("avg_ticket", [S1, S2]),
			planKpiKey("discount_rate", [S1, S2]),
			planKpiKey("invoices", [S1]),
			planKpiKey("invoices", [S1, S2]),
			planKpiKey("size_l_share", [S1, S2]),
		]);
	});

	it("keeps a KPI whose stores are the same set in another order", () => {
		const row = byKey.get(planKpiKey("avg_ticket", [S1, S2]));
		expect(row?.change).toBe("kept");
		expect(row?.storeIds).toEqual([S1, S2].sort());
		expect(row?.left?.baseline).toBe(90000);
		expect(row?.right?.target).toBe(97000);
		expect(row?.current).toBe(93000);
	});

	it("drops a KPI only the older plan has", () => {
		const row = byKey.get(planKpiKey("discount_rate", [S1, S2]));
		expect(row?.change).toBe("dropped");
		expect(row?.right).toBeNull();
		expect(row?.left?.dueOn).toBe("2026-11-09");
	});

	it("adds a KPI only the newer plan has", () => {
		const row = byKey.get(planKpiKey("size_l_share", [S1, S2]));
		expect(row?.change).toBe("added");
		expect(row?.left).toBeNull();
		expect(row?.current).toBeNull();
		expect(row?.right?.status).toBe("no_data");
	});

	it("treats a KPI whose scope changed as one dropped and one added", () => {
		expect(byKey.get(planKpiKey("invoices", [S1]))?.change).toBe("dropped");
		expect(byKey.get(planKpiKey("invoices", [S1, S2]))?.change).toBe("added");
	});

	it("gives each side the status of its own plan against the live value", () => {
		const row = byKey.get(planKpiKey("avg_ticket", [S1, S2]));
		expect(row?.left?.status).toBe("missed");
		expect(row?.right?.status).toBe("too_early");
	});

	it("shows no_data for a live value that is null", () => {
		expect(byKey.get(planKpiKey("invoices", [S1]))?.left?.status).toBe(
			"no_data",
		);
	});
});

describe("comparePlans initiatives", () => {
	it("labels kept, added and removed titles after NFC, case and space folding", () => {
		expect(comparePlans(older, newer, live).initiatives).toEqual([
			{ title: "  ĐẨY MẠNH   món dẫn đầu ", change: "kept" },
			{ title: "Thanh toán nhanh hơn", change: "kept" },
			{ title: "Mở rộng nhóm món dẫn đầu", change: "added" },
			{ title: "Kéo khách vào ngày vắng nhất", change: "removed" },
		]);
	});

	it("folds decomposed text to the composed form", () => {
		expect(initiativeTitleKey("Cà phê")).toBe(initiativeTitleKey("Cà phê"));
	});

	it("compares a plan with itself as all kept", () => {
		const self = comparePlans(newer, newer, live);
		expect(self.kpis.every((row) => row.change === "kept")).toBe(true);
		expect(self.initiatives.every((row) => row.change === "kept")).toBe(true);
	});

	it("lists a repeated title once", () => {
		const twice = { ...newer, initiativeTitles: ["A", "a", "B"] };
		expect(
			comparePlans(older, twice, live).initiatives.map((r) => r.title),
		).toEqual(["A", "B", ...older.initiativeTitles]);
	});
});
