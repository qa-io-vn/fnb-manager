import { describe, expect, it } from "vitest";
import {
	categoryLabel,
	filteredEntries,
	logEntries,
	logFiltersOf,
	logSummary,
} from "./log";
import type { HandoverRow, IncidentCategory, IncidentRow } from "./source";

const CATEGORIES: readonly IncidentCategory[] = [
	{ key: "thiet_bi", label: "Thiết bị", sortOrder: 10, active: true },
	{ key: "ve_sinh", label: "Vệ sinh", sortOrder: 20, active: true },
	{ key: "cu", label: "Danh mục cũ", sortOrder: 80, active: false },
];

function incident(
	id: string,
	overrides: Partial<IncidentRow> = {},
): IncidentRow {
	return {
		id,
		storeId: "store-1",
		businessDate: "2026-11-17",
		occurredAt: "2026-11-17T03:00:00Z",
		kind: "incident",
		categoryKey: "thiet_bi",
		description: "Máy pha bị rò nước",
		itemLabel: null,
		photoBucket: "ops-brand-1",
		photoPaths: [],
		photosRemoved: false,
		status: "open",
		reportedBy: "staff-1",
		acknowledgedBy: null,
		acknowledgedAt: null,
		resolvedBy: null,
		resolvedAt: null,
		...overrides,
	};
}

function handover(
	id: string,
	overrides: Partial<HandoverRow> = {},
): HandoverRow {
	return {
		id,
		storeId: "store-1",
		businessDate: "2026-11-17",
		fromShift: 1,
		toShift: 2,
		note: "Còn nửa thùng sữa",
		writtenBy: "staff-1",
		writtenAt: "2026-11-17T05:00:00Z",
		acknowledgedBy: null,
		acknowledgedAt: null,
		...overrides,
	};
}

describe("the incident and handover log", () => {
	const entries = logEntries(
		[
			incident("a"),
			incident("b", {
				kind: "stock_out",
				categoryKey: "ve_sinh",
				itemLabel: "Trân châu",
				occurredAt: "2026-11-17T07:00:00Z",
				status: "seen",
				acknowledgedBy: "manager-1",
				acknowledgedAt: "2026-11-17T07:30:00Z",
			}),
			incident("c", {
				occurredAt: "2026-11-16T07:00:00Z",
				status: "resolved",
				acknowledgedAt: "2026-11-16T08:00:00Z",
				resolvedAt: "2026-11-16T09:00:00Z",
			}),
		],
		[
			handover("h1"),
			handover("h2", {
				writtenAt: "2026-11-17T01:00:00Z",
				acknowledgedBy: "manager-1",
				acknowledgedAt: "2026-11-17T02:00:00Z",
			}),
		],
	);

	it("merges incidents, stock-outs and handovers newest first", () => {
		expect(entries.map((entry) => entry.key)).toEqual([
			"incident:b",
			"handover:h1",
			"incident:a",
			"handover:h2",
			"incident:c",
		]);
		expect(entries.map((entry) => entry.kind)).toEqual([
			"stock_out",
			"handover",
			"incident",
			"handover",
			"incident",
		]);
	});

	it("reads a handover as open until a manager acknowledges it, and never resolved", () => {
		const [h1, h2] = entries.filter((entry) => entry.kind === "handover");
		expect(h1).toMatchObject({
			status: "open",
			categoryKey: null,
			fromShift: 1,
		});
		expect(h2).toMatchObject({ status: "seen", seenBy: "manager-1" });
	});

	it("filters by kind, category and status together", () => {
		const filters = (params: Record<string, string>) =>
			filteredEntries(entries, logFiltersOf(params, CATEGORIES)).map(
				(entry) => entry.key,
			);
		expect(filters({ kind: "handover" })).toEqual([
			"handover:h1",
			"handover:h2",
		]);
		expect(filters({ category: "thiet_bi" })).toEqual([
			"incident:a",
			"incident:c",
		]);
		expect(filters({ status: "open" })).toEqual(["handover:h1", "incident:a"]);
		expect(filters({ kind: "incident", status: "resolved" })).toEqual([
			"incident:c",
		]);
		expect(filters({ kind: "stock_out", category: "thiet_bi" })).toEqual([]);
	});

	it("ignores a filter value it does not know", () => {
		expect(
			logFiltersOf(
				{ kind: "fire", status: "closed", category: "unknown" },
				CATEGORIES,
			),
		).toEqual({ kind: null, status: null, category: null });
		expect(logFiltersOf({ category: "ve_sinh" }, undefined).category).toBe(
			"ve_sinh",
		);
	});

	it("counts the entries by kind and status", () => {
		expect(logSummary(entries)).toEqual({
			total: 5,
			incidents: 2,
			stockOuts: 1,
			handovers: 2,
			open: 2,
			seen: 2,
			resolved: 1,
		});
	});

	it("labels a category by the tenant's list, a retired one included, and an unknown key as itself", () => {
		expect(categoryLabel(CATEGORIES, "cu")).toBe("Danh mục cũ");
		expect(categoryLabel(CATEGORIES, "khac_moi")).toBe("khac_moi");
		expect(categoryLabel(CATEGORIES, null)).toBeNull();
	});
});
