import { describe, expect, it } from "vitest";
import { lintPlan } from "../../src/index.js";
import {
	analyzeLine,
	kpiValue,
	parseCitationRef,
	resolveCell,
} from "../../src/plan/citations.js";
import {
	cleanPlan,
	lintPack,
	oneStorePack,
	replacing,
	withLine,
} from "./support.js";

function written(text: string, language: "vi" | "en" = "vi") {
	return analyzeLine(text, language).citations.map((citation) => [
		citation.ref.ref,
		citation.written?.text ?? null,
	]);
}

function codesOf(text: string, pack = lintPack()): string[] {
	return lintPlan(text, pack).issues.map((issue) => issue.code);
}

const SUMMARY_ANCHOR = "## 2. Điểm mạnh và điểm yếu";

describe("parseCitationRef", () => {
	it("splits table, row and column and trims spaces", () => {
		expect(parseCitationRef("kpi:ALL/avg_ticket:w28")).toEqual({
			ref: "kpi:ALL/avg_ticket:w28",
			table: "kpi",
			row: "ALL/avg_ticket",
			column: "w28",
			wellFormed: true,
		});
		expect(parseCitationRef(" items : S1/i01 : net ").ref).toBe(
			"items:S1/i01:net",
		);
	});

	it("marks references without three valid parts as malformed", () => {
		for (const inner of [
			"kpi:ALL/avg_ticket",
			"kpi:ALL/avg_ticket:w28:x",
			"KPI:ALL/avg_ticket:w28",
			"kpi:ALL avg:w28",
			"kpi::w28",
			"",
		]) {
			expect(parseCitationRef(inner).wellFormed, inner).toBe(false);
		}
		expect(parseCitationRef(" kpi:ALL ").ref).toBe("kpi:ALL");
	});
});

describe("resolveCell", () => {
	const pack = lintPack();

	it("finds the cell and the unit of its column", () => {
		expect(resolveCell(pack, "kpi", "ALL/avg_ticket", "w28")).toEqual({
			row: "ALL/avg_ticket",
			cell: 52314.27,
			unit: "metric",
		});
		expect(resolveCell(pack, "monthly", "ALL/2026-10", "net")).toEqual({
			row: "ALL/2026-10",
			cell: 1287540.5,
			unit: "money_thousands",
		});
		expect(resolveCell(pack, "kpi", "ALL/net_revenue", "ly28")?.cell).toBe(
			null,
		);
	});

	it("refuses an unknown table, row or column", () => {
		expect(resolveCell(pack, "sales", "ALL/avg_ticket", "w28")).toBeNull();
		expect(resolveCell(pack, "kpi", "ALL/avg_tickets", "w28")).toBeNull();
		expect(resolveCell(pack, "kpi", "ALL/avg_ticket", "w29")).toBeNull();
		expect(resolveCell(pack, "kpi", "S3/avg_ticket", "w28")).toBeNull();
		expect(resolveCell(pack, "toString", "ALL", "w28")).toBeNull();
		expect(resolveCell(pack, "kpi", "constructor", "w28")).toBeNull();
	});

	it("never treats context as a table", () => {
		const withContext = {
			...pack,
			tables: { ...pack.tables, context: pack.tables.kpi },
		} as typeof pack;
		expect(
			resolveCell(withContext, "context", "ALL/avg_ticket", "w28"),
		).toBeNull();
		expect(resolveCell(withContext, "kpi", "ALL/avg_ticket", "w28")).not.toBe(
			null,
		);
	});

	it("resolves S1 to the ALL rows in a one-store pack only", () => {
		const one = oneStorePack();
		expect(resolveCell(one, "kpi", "S1/avg_ticket", "w28")).toEqual({
			row: "ALL/avg_ticket",
			cell: 52314.27,
			unit: "metric",
		});
		expect(resolveCell(one, "items", "S1/i01", "qty")?.cell).toBe(3120);
		expect(resolveCell(one, "kpi", "S2/avg_ticket", "w28")).toBeNull();
		expect(resolveCell(pack, "kpi", "S1/avg_ticket", "w28")?.cell).toBe(
			55120.4,
		);
		expect(resolveCell(pack, "kpi", "S1/net_revenue", "w28")).toBeNull();
	});

	it("reads KPI values by scope, metric and column", () => {
		expect(kpiValue(pack, "ALL", "avg_ticket", "w28")).toBe(52314.27);
		expect(kpiValue(pack, "S2", "invoices", "lo")).toBe(9600);
		expect(kpiValue(pack, "ALL", "cash_share", "w28")).toBeNull();
		expect(kpiValue(pack, "ALL", "net_revenue", "ly28")).toBeNull();
		expect(kpiValue(oneStorePack(), "S1", "invoices", "w28")).toBe(23600);
	});
});

describe("the number written before a citation", () => {
	it("takes the number right before the reference with its scale, currency and percent words", () => {
		expect(
			written(
				"đạt 1,23 tỷ đồng [[kpi:ALL/net_revenue:w28]], tăng 4,6% [[kpi:ALL/net_revenue:p28_change]]",
			),
		).toEqual([
			["kpi:ALL/net_revenue:w28", "1,23 tỷ đồng"],
			["kpi:ALL/net_revenue:p28_change", "4,6%"],
		]);
		expect(
			written(
				"down 3.2 percentage points [[payments:ALL/cash:share_change]]",
				"en",
			),
		).toEqual([["payments:ALL/cash:share_change", "3.2 percentage points"]]);
	});

	it("allows at most three other words in between", () => {
		expect(written("3.120 ly trong bốn [[items:ALL/i01:qty]]")).toEqual([
			["items:ALL/i01:qty", "3.120"],
		]);
		expect(written("3.120 ly trong bốn tuần [[items:ALL/i01:qty]]")).toEqual([
			["items:ALL/i01:qty", null],
		]);
		expect(written("10.1% of revenue [[items:ALL/i01:share]]", "en")).toEqual([
			["items:ALL/i01:share", "10.1%"],
		]);
	});

	it("never reads across a line, past another citation, or after the reference", () => {
		expect(written("[[kpi:ALL/invoices:w28]] 23.600 hóa đơn")).toEqual([
			["kpi:ALL/invoices:w28", null],
		]);
		expect(
			written("52.314 đ [[kpi:ALL/avg_ticket:w28]] [[kpi:S1/avg_ticket:w28]]"),
		).toEqual([
			["kpi:ALL/avg_ticket:w28", "52.314 đ"],
			["kpi:S1/avg_ticket:w28", null],
		]);
		const result = lintPlan(
			withLine(
				cleanPlan(),
				SUMMARY_ANCHOR,
				"Giá trị 52.314 đ\n[[kpi:ALL/avg_ticket:w28]]",
			),
			lintPack(),
		);
		expect(result.plan?.citations.find((entry) => entry.line === 26)).toEqual({
			ref: "kpi:ALL/avg_ticket:w28",
			table: "kpi",
			row: "ALL/avg_ticket",
			column: "w28",
			line: 26,
			written: null,
		});
	});

	it("skips dates, store labels and window names when looking back", () => {
		expect(
			written("tuần 2026-W45 của S1 là 55.120 đ [[kpi:S1/avg_ticket:w28]]"),
		).toEqual([["kpi:S1/avg_ticket:w28", "55.120 đ"]]);
		expect(written("tháng 2026-10 [[monthly:ALL/2026-10:net]]")).toEqual([
			["monthly:ALL/2026-10:net", null],
		]);
	});
});

describe("the citation checks of the lint", () => {
	it("accepts the clean plans with every citation valid", () => {
		for (const language of ["vi", "en"] as const) {
			const result = lintPlan(cleanPlan(language), lintPack());
			expect(result.issues).toEqual([]);
			expect(result.summary.citations).toBe(19);
			expect(result.summary.validCitations).toBe(19);
		}
	});

	it("names an unknown table, row, column, a malformed reference and the context", () => {
		for (const [ref, code] of [
			["sales:ALL/x:net", "citation_unknown:sales:ALL/x:net"],
			["kpi:ALL/net_sales:w28", "citation_unknown:kpi:ALL/net_sales:w28"],
			["kpi:ALL/avg_ticket:w29", "citation_unknown:kpi:ALL/avg_ticket:w29"],
			["kpi:ALL/avg_ticket", "citation_unknown:kpi:ALL/avg_ticket"],
			[
				"context:benchmarks:avg_ticket",
				"citation_unknown:context:benchmarks:avg_ticket",
			],
		] as const) {
			const text = replacing(
				cleanPlan(),
				"[[kpi:ALL/avg_ticket:w28]] trên",
				`[[${ref}]] trên`,
			);
			expect(codesOf(text)).toEqual([code]);
		}
	});

	it("names a written number that the cited cell does not hold", () => {
		const text = replacing(
			cleanPlan(),
			"52.314 đ [[kpi:ALL",
			"53.314 đ [[kpi:ALL",
		);
		const result = lintPlan(text, lintPack());
		expect(result.issues).toEqual([
			{
				code: "citation_mismatch:kpi:ALL/avg_ticket:w28",
				level: "error",
				line: 23,
				detail: "53.314 đ",
			},
		]);
		expect(result.summary.validCitations).toBe(18);
	});

	it("refuses a number written for an empty cell", () => {
		const text = withLine(
			cleanPlan(),
			SUMMARY_ANCHOR,
			"Cùng kỳ năm trước đạt 1,1 tỷ đồng [[kpi:ALL/net_revenue:ly28]].",
		);
		expect(codesOf(text)).toEqual([
			"citation_mismatch:kpi:ALL/net_revenue:ly28",
		]);
	});

	it("compares a money_thousands cell as written and times a thousand", () => {
		for (const number of [
			"1,29 tỷ đồng",
			"1.287.540,5 nghìn đồng",
			"1.287.541",
		]) {
			const text = replacing(
				cleanPlan(),
				"1,29 tỷ đồng [[monthly",
				`${number} [[monthly`,
			);
			expect(codesOf(text), number).toEqual([]);
		}
		const wrong = replacing(
			cleanPlan(),
			"1,29 tỷ đồng [[monthly",
			"1,39 tỷ đồng [[monthly",
		);
		expect(codesOf(wrong)).toEqual([
			"citation_mismatch:monthly:ALL/2026-10:net",
		]);
	});

	it("does not compare a number with a text, date or class cell", () => {
		const text = withLine(
			cleanPlan(),
			SUMMARY_ANCHOR,
			"Top 1 là [[items:ALL/i01:name]], nhóm 1 [[items:ALL/i01:class]], mở từ 2024 [[stores:S1:opened_on]].",
		);
		const result = lintPlan(text, lintPack());
		expect(result.issues.filter((issue) => issue.level === "error")).toEqual(
			[],
		);
		expect(result.summary.validCitations).toBe(22);
	});

	it("resolves S1 to ALL in a one-store pack", () => {
		const one = oneStorePack();
		const text = withLine(
			cleanPlan(),
			SUMMARY_ANCHOR,
			"Cửa hàng có 23.600 hóa đơn [[kpi:S1/invoices:w28]].",
		);
		const codes = codesOf(text, one);
		expect(codes).not.toContain("citation_unknown:kpi:S1/invoices:w28");
		expect(codes).not.toContain("citation_mismatch:kpi:S1/invoices:w28");
	});
});

describe("initiative_uncited", () => {
	const evidence =
		"- **Căn cứ:** Tỷ lệ giảm giá bốn tuần qua là 4,25% [[kpi:ALL/discount_rate:w28]], cao hơn mức 3,98% [[kpi:ALL/discount_rate:p28]] của bốn tuần trước.";

	it("needs a valid citation of a number inside the initiative", () => {
		for (const line of [
			"- **Căn cứ:** Tỷ lệ giảm giá đang cao [[kpi:ALL/discount_rate:w28]].",
			"- **Căn cứ:** Tỷ lệ giảm giá là 4,25% [[kpi:ALL/discount_rate:w29]].",
			"- **Căn cứ:** Món bán chạy là [[items:ALL/i01:name]].",
		]) {
			const codes = codesOf(replacing(cleanPlan(), evidence, line));
			expect(codes, line).toContain("initiative_uncited:3");
		}
	});

	it("does not count a citation that the number contradicts", () => {
		const codes = codesOf(
			replacing(
				cleanPlan(),
				evidence,
				"- **Căn cứ:** Tỷ lệ giảm giá là 5,25% [[kpi:ALL/discount_rate:w28]].",
			),
		);
		expect(codes).toEqual([
			"initiative_uncited:3",
			"citation_mismatch:kpi:ALL/discount_rate:w28",
		]);
	});

	it("accepts a cited number in any field of the initiative", () => {
		const text = replacing(
			replacing(
				cleanPlan(),
				evidence,
				"- **Căn cứ:** Tỷ lệ giảm giá đang cao.",
			),
			"- **Hành động:** Chỉ quản lý được duyệt giảm giá ngoài chương trình.",
			"- **Hành động:** Đưa tỷ lệ 4,25% [[kpi:ALL/discount_rate:w28]] xuống.",
		);
		const result = lintPlan(text, lintPack());
		expect(result.issues).toEqual([]);
		expect(result.summary.citedInitiatives).toBe(5);
	});
});
