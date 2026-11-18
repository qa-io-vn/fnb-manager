import { describe, expect, it } from "vitest";
import { SAMPLE_CATEGORIES } from "../shift/sample";
import {
	activeCategories,
	canAcknowledgeHandover,
	categoryLabel,
	defaultCategory,
	incidentActions,
	type ReportDraft,
	reportProblems,
} from "./model";

const ME = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";

describe("the report form's rules", () => {
	const incident: ReportDraft = {
		kind: "incident",
		categoryKey: "thiet_bi",
		description: "Vòi nước bồn rửa ly bị rò rỉ.",
		itemLabel: "",
	};

	it("accepts an incident with a category and a description", () => {
		expect(reportProblems(incident, SAMPLE_CATEGORIES)).toEqual([]);
	});

	it("needs a description of 1 to 1,000 characters and an active category", () => {
		expect(
			reportProblems({ ...incident, description: "   " }, SAMPLE_CATEGORIES),
		).toEqual(["description-empty"]);
		expect(
			reportProblems(
				{ ...incident, description: "x".repeat(1001) },
				SAMPLE_CATEGORIES,
			),
		).toEqual(["description-long"]);
		expect(
			reportProblems(
				{ ...incident, description: `a${String.fromCharCode(0)}` },
				SAMPLE_CATEGORIES,
			),
		).toEqual(["description-control"]);
		const retired = SAMPLE_CATEGORIES.map((category) =>
			category.key === "thiet_bi" ? { ...category, active: false } : category,
		);
		expect(reportProblems(incident, retired)).toEqual(["category"]);
	});

	it("needs the item of a stock-out, on one line of at most 120 characters", () => {
		const stockOut: ReportDraft = {
			...incident,
			kind: "stock_out",
			itemLabel: "",
		};
		expect(reportProblems(stockOut, SAMPLE_CATEGORIES)).toEqual(["item-empty"]);
		expect(
			reportProblems(
				{ ...stockOut, itemLabel: "x".repeat(121) },
				SAMPLE_CATEGORIES,
			),
		).toEqual(["item-long"]);
		expect(
			reportProblems(
				{ ...stockOut, itemLabel: "Sữa\ntươi" },
				SAMPLE_CATEGORIES,
			),
		).toEqual(["item-control"]);
		expect(
			reportProblems(
				{ ...stockOut, itemLabel: "Sữa tươi 1 lít" },
				SAMPLE_CATEGORIES,
			),
		).toEqual([]);
	});

	it("starts a stock-out on Khác and an incident on the first category, and labels a key", () => {
		expect(defaultCategory("stock_out", SAMPLE_CATEGORIES)).toBe("khac");
		expect(defaultCategory("incident", SAMPLE_CATEGORIES)).toBe("thiet_bi");
		expect(defaultCategory("incident", [])).toBe("");
		expect(categoryLabel(SAMPLE_CATEGORIES, "ve_sinh")).toBe("Vệ sinh");
		expect(categoryLabel(SAMPLE_CATEGORIES, "cu")).toBe("cu");
		expect(
			activeCategories([
				...SAMPLE_CATEGORIES,
				{ key: "cu", label: "Cũ", active: false },
			]),
		).toHaveLength(5);
	});
});

describe("acknowledgement in the app", () => {
	it("lets a manager mark someone else's open report seen or resolved, and a seen one resolved", () => {
		expect(
			incidentActions({ status: "open", createdBy: OTHER }, ME, true),
		).toEqual({
			acknowledge: true,
			resolve: true,
			waitingForAnother: false,
		});
		expect(
			incidentActions({ status: "seen", createdBy: OTHER }, ME, true),
		).toEqual({
			acknowledge: false,
			resolve: true,
			waitingForAnother: false,
		});
		expect(
			incidentActions({ status: "seen", createdBy: ME }, ME, true).resolve,
		).toBe(true);
	});

	it("keeps a manager's own open report for another manager, and gives staff no action", () => {
		expect(
			incidentActions({ status: "open", createdBy: ME }, ME, true),
		).toEqual({
			acknowledge: false,
			resolve: false,
			waitingForAnother: true,
		});
		expect(
			incidentActions({ status: "open", createdBy: OTHER }, ME, false),
		).toEqual({
			acknowledge: false,
			resolve: false,
			waitingForAnother: false,
		});
		expect(
			incidentActions({ status: "resolved", createdBy: OTHER }, ME, true)
				.resolve,
		).toBe(false);
	});

	it("lets a manager acknowledge someone else's unread handover only", () => {
		expect(
			canAcknowledgeHandover(
				{ acknowledgedAt: null, createdBy: OTHER },
				ME,
				true,
			),
		).toBe(true);
		expect(
			canAcknowledgeHandover({ acknowledgedAt: null, createdBy: ME }, ME, true),
		).toBe(false);
		expect(
			canAcknowledgeHandover(
				{ acknowledgedAt: "2026-11-18T10:00:00Z", createdBy: OTHER },
				ME,
				true,
			),
		).toBe(false);
		expect(
			canAcknowledgeHandover(
				{ acknowledgedAt: null, createdBy: OTHER },
				ME,
				false,
			),
		).toBe(false);
	});
});
