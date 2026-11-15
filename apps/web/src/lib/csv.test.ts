import { describe, expect, it } from "vitest";
import { buildCsv, isCsvDialect, neutralisedText, UTF8_BOM } from "./csv";

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

const COLUMNS = [
	{ key: "item", label: "Món" },
	{ key: "net", label: "Doanh thu thuần" },
	{ key: "share", label: "Tỷ trọng (%)" },
	{ key: "note", label: "Ghi chú" },
];

const ROWS = [
	{
		item: "Trà sữa trân châu",
		net: 1_234_567.5,
		share: 12.5,
		note: "ít đá, ít đường",
	},
	{
		item: 'Cà phê "muối"',
		net: 98_000,
		share: 3,
		note: "khách quen; hay đặt\r\ntrước",
	},
	{ item: "=SUM(A1)", net: -20_000, share: null, note: null },
];

function bytesOf(text: string): number[] {
	return [...new TextEncoder().encode(text)];
}

describe("buildCsv dialects", () => {
	it("keeps the comma dialect byte for byte as phase 9 wrote it, and as the default", () => {
		const expected = `${UTF8_BOM}Món,Doanh thu thuần,Tỷ trọng (%),Ghi chú\r\nTrà sữa trân châu,1234567.5,12.5,"ít đá, ít đường"\r\n"Cà phê ""muối""",98000,3,"khách quen; hay đặt\r\ntrước"\r\n'=SUM(A1),-20000,,\r\n`;
		expect(buildCsv(COLUMNS, ROWS)).toBe(expected);
		expect(buildCsv(COLUMNS, ROWS, "comma")).toBe(expected);
	});

	it("writes semicolons and decimal commas without thousands separators", () => {
		expect(buildCsv(COLUMNS, ROWS, "semicolon")).toBe(
			`${UTF8_BOM}Món;Doanh thu thuần;Tỷ trọng (%);Ghi chú\r\nTrà sữa trân châu;1234567,5;12,5;"ít đá, ít đường"\r\n"Cà phê ""muối""";98000;3;"khách quen; hay đặt\r\ntrước"\r\n'=SUM(A1);-20000;;\r\n`,
		);
	});

	it("starts both dialects with EF BB BF, ends lines with CRLF and decodes the Vietnamese header intact", () => {
		for (const dialect of ["comma", "semicolon"] as const) {
			const bytes = bytesOf(buildCsv(COLUMNS, ROWS, dialect));
			expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
			const text = new TextDecoder("utf-8", { fatal: true }).decode(
				new Uint8Array(bytes.slice(3)),
			);
			const separator = dialect === "comma" ? "," : ";";
			expect(text.split("\r\n")[0]).toBe(
				["Món", "Doanh thu thuần", "Tỷ trọng (%)", "Ghi chú"].join(separator),
			);
			expect(text.endsWith("\r\n")).toBe(true);
			expect(text.replace(/\r\n/g, "").includes("\n")).toBe(false);
			expect(text).not.toMatch(/^sep=/m);
		}
	});

	it("quotes a cell holding either delimiter, a quote or a line break in both dialects", () => {
		for (const dialect of ["comma", "semicolon"] as const) {
			const csv = buildCsv(
				[{ key: "a", label: "a" }],
				[{ a: "x,y" }, { a: "x;y" }, { a: 'x"y' }, { a: "x\ny" }, { a: "xy" }],
				dialect,
			);
			expect(csv.split("\r\n").slice(1, 6)).toEqual([
				'"x,y"',
				'"x;y"',
				'"x""y"',
				'"x\ny"',
				"xy",
			]);
		}
	});

	it("knows its two dialects", () => {
		expect(isCsvDialect("comma")).toBe(true);
		expect(isCsvDialect("semicolon")).toBe(true);
		expect(isCsvDialect("tab")).toBe(false);
		expect(isCsvDialect(undefined)).toBe(false);
	});
});
