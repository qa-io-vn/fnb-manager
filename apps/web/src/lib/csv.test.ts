import { describe, expect, it } from "vitest";
import { buildCsv, neutralisedText, UTF8_BOM } from "./csv";

describe("buildCsv", () => {
	it("keeps text typed at the POS from running as a spreadsheet formula", () => {
		expect(
			["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tTab", "\rReturn"].map(
				neutralisedText,
			),
		).toEqual([
			"'=HYPERLINK(1)",
			"'+1",
			"'-1",
			"'@SUM(A1)",
			"'\tTab",
			"'\rReturn",
		]);
		expect(neutralisedText("Ca sáng")).toBe("Ca sáng");
		const csv = buildCsv(
			[
				{ key: "name", label: "Khuyến mãi" },
				{ key: "amount", label: "Số tiền" },
			],
			[
				{ name: '=cmd|"/c calc"!A1', amount: -20_000 },
				{ name: "Giảm 20k", amount: 5 },
			],
		);
		expect(csv).toBe(
			`${UTF8_BOM}Khuyến mãi,Số tiền\r\n"'=cmd|""/c calc""!A1",-20000\r\nGiảm 20k,5\r\n`,
		);
	});
});
