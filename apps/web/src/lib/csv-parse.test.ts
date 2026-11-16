import { describe, expect, it } from "vitest";
import { UTF8_BOM } from "./csv";
import {
	detectDateOrder,
	detectDelimiter,
	parseCsv,
	parseDateCell,
	parseMoneyCell,
} from "./csv-parse";

function rowsOf(text: string): readonly (readonly string[])[] {
	const parsed = parseCsv(text);
	if (!parsed.ok) throw new Error(`not parsed: ${JSON.stringify(parsed)}`);
	return parsed.rows;
}

describe("parseCsv", () => {
	it("reads each delimiter, with or without a BOM", () => {
		for (const delimiter of [",", ";", "\t"] as const) {
			const body = [
				["Mã món", "Giá vốn", "Từ ngày"].join(delimiter),
				["CF01", "12500", "2026-11-01"].join(delimiter),
			].join("\r\n");
			for (const text of [body, `${UTF8_BOM}${body}`]) {
				expect(parseCsv(text)).toEqual({
					ok: true,
					delimiter,
					rows: [
						["Mã món", "Giá vốn", "Từ ngày"],
						["CF01", "12500", "2026-11-01"],
					],
					lines: [1, 2],
				});
			}
		}
	});

	it("chooses the delimiter by its count outside quotes on the header line", () => {
		expect(detectDelimiter('"Tên, đầy đủ";"Giá";"Ngày"\r\n1,2;3;4')).toBe(";");
		expect(detectDelimiter('"a;b;c",d')).toBe(",");
		expect(detectDelimiter("a,b;c,d")).toBe(",");
		expect(detectDelimiter("one column")).toBe(",");
		expect(detectDelimiter('\ufeff"a,b";c')).toBe(";");
	});

	it("opens quotes only at the start of a cell, in the header as in the rows", () => {
		const text = 'Cỡ 12";Giá vốn;Ngày\r\nLy 16";2500;2026-11-01\r\n';
		expect(parseCsv(text)).toEqual({
			ok: true,
			delimiter: ";",
			rows: [
				['Cỡ 12"', "Giá vốn", "Ngày"],
				['Ly 16"', "2500", "2026-11-01"],
			],
			lines: [1, 2],
		});
	});

	it("gives each record the physical line it starts on, past blank lines and line breaks inside quotes", () => {
		const parsed = parseCsv('a,b\r\n\r\n"one\r\ntwo",c\n\n\nd,e\r,f\r\n');
		expect(parsed).toEqual({
			ok: true,
			delimiter: ",",
			rows: [
				["a", "b"],
				["one\r\ntwo", "c"],
				["d", "e"],
				["", "f"],
			],
			lines: [1, 3, 7, 8],
		});
	});

	it("keeps quoted delimiters, doubled quotes and line breaks inside a cell", () => {
		const text =
			'Tên;Ghi chú\r\n"Trà sữa; size L";"Nói ""ít đá""\r\nthêm trân châu"\n"";x\rlast;row\r\n';
		expect(rowsOf(text)).toEqual([
			["Tên", "Ghi chú"],
			["Trà sữa; size L", 'Nói "ít đá"\r\nthêm trân châu'],
			["", "x"],
			["last", "row"],
		]);
	});

	it("keeps an empty last cell and a cell that is only quotes", () => {
		expect(rowsOf('a,b,\r\n"",\r\n""\r\n')).toEqual([
			["a", "b", ""],
			["", ""],
			[""],
		]);
	});

	it("reads LF and CR line endings and skips blank lines", () => {
		expect(rowsOf("a,b\nc,d\n")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(rowsOf("a,b\rc,d")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(rowsOf("a,b\r\n\r\nc,d\r\n\r\n")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(rowsOf("")).toEqual([]);
	});

	it("refuses a quote that never closes instead of swallowing the rows after it", () => {
		expect(parseCsv('a,b\r\n"x,y\r\nc,d\r\n')).toEqual({
			ok: false,
			error: "unterminatedQuote",
			line: 2,
		});
		expect(parseCsv('a;b\n1;2\n3;"multi\nline\n5;6')).toEqual({
			ok: false,
			error: "unterminatedQuote",
			line: 3,
		});
	});

	it("refuses text after a closing quote, so a stray quote cannot hide rows behind a later one", () => {
		const text =
			'Mã;Giá;Ngày\r\n"A01;1000;2026-11-01\r\nA02;2000;2026-11-01\r\n"A03";3000;2026-11-01\r\n';
		expect(parseCsv(text)).toEqual({
			ok: false,
			error: "textAfterQuote",
			line: 2,
		});
		expect(parseCsv('a,b\r\n"x"y,z\r\n')).toEqual({
			ok: false,
			error: "textAfterQuote",
			line: 2,
		});
		expect(parseCsv('"a" ,b')).toEqual({
			ok: false,
			error: "textAfterQuote",
			line: 1,
		});
		expect(rowsOf('"a",b\r\n"c"\r\n"d"')).toEqual([["a", "b"], ["c"], ["d"]]);
	});
});

describe("parseMoneyCell", () => {
	it("reads every whole-đồng form", () => {
		for (const text of [
			"12500",
			"12.500",
			"12,500",
			"12 500",
			"12 500",
			"12 500",
			"12.500 ₫",
			"12.500đ",
			"12.500 VNĐ",
			"12,500 VND",
			"₫ 12.500",
			" 12500 ",
		]) {
			expect(parseMoneyCell(text, 0), text).toBe(12_500);
		}
		for (const text of ["1.250.000", "1,250,000", "1 250 000"]) {
			expect(parseMoneyCell(text, 0), text).toBe(1_250_000);
		}
	});

	it("refuses every fraction of a đồng instead of reading it a hundred times too large", () => {
		for (const text of [
			"12500.50",
			"12.500,50",
			"12,500.50",
			"12500,5",
			"12,5",
			"12.5",
			"8333.33",
			"8333,33",
			"1.250,000",
			"1.250.00",
			"0.500",
			"-12500",
			"",
			"₫",
			"abc",
		]) {
			expect(parseMoneyCell(text, 0), text).toBeNull();
		}
	});

	it("takes a space as a group mark only between groups of three, and a unit only at an end", () => {
		for (const text of [
			"12 50",
			"12 . 500",
			"1 2500",
			"12 500.000",
			"12₫500",
			"12 500 00",
		]) {
			expect(parseMoneyCell(text, 0), text).toBeNull();
		}
	});

	it("reads cents for a currency that has them", () => {
		expect(parseMoneyCell("12.50", 2)).toBe(12.5);
		expect(parseMoneyCell("12,50", 2)).toBe(12.5);
		expect(parseMoneyCell("1,234.56", 2)).toBe(1234.56);
		expect(parseMoneyCell("1.234,56", 2)).toBe(1234.56);
		expect(parseMoneyCell("1 234,56", 2)).toBe(1234.56);
		expect(parseMoneyCell("1,234", 2)).toBe(1234);
		expect(parseMoneyCell("12.505", 2)).toBe(12505);
		expect(parseMoneyCell("12.5055", 2)).toBeNull();
		expect(parseMoneyCell("1.234.56", 2)).toBeNull();
		expect(parseMoneyCell(".50", 2)).toBeNull();
	});

	it("refuses an amount too long to hold exactly instead of returning something else", () => {
		expect(parseMoneyCell("1000000000000000000000.50", 2)).toBeNull();
		expect(parseMoneyCell("99999999999999999999", 0)).toBeNull();
		expect(parseMoneyCell("999.999.999.999", 0)).toBe(999_999_999_999);
		expect(parseMoneyCell("9999999999999.99", 2)).toBe(9_999_999_999_999.99);
	});
});

describe("parseDateCell", () => {
	it("always reads ISO dates", () => {
		expect(parseDateCell("2026-11-15", "dmy")).toBe("2026-11-15");
		expect(parseDateCell(" 2026-11-15 ", "mdy")).toBe("2026-11-15");
	});

	it("reads slash dates in the order given and refuses dates that do not exist", () => {
		expect(parseDateCell("05/11/2026", "dmy")).toBe("2026-11-05");
		expect(parseDateCell("05/11/2026", "mdy")).toBe("2026-05-11");
		expect(parseDateCell("5/1/2026", "dmy")).toBe("2026-01-05");
		expect(parseDateCell("31/02/2026", "dmy")).toBeNull();
		expect(parseDateCell("13/13/2026", "dmy")).toBeNull();
		expect(parseDateCell("05/11/26", "dmy")).toBeNull();
		expect(parseDateCell("2026/11/05", "dmy")).toBeNull();
	});
});

describe("detectDateOrder", () => {
	it("reports the order the cells prove", () => {
		expect(detectDateOrder(["05/11/2026", "25/11/2026"])).toBe("dmy");
		expect(detectDateOrder(["11/05/2026", "11/25/2026"])).toBe("mdy");
	});

	it("reports a conflict when the cells prove both orders", () => {
		expect(detectDateOrder(["25/11/2026", "11/25/2026"])).toBe("conflict");
	});

	it("reports unknown when no cell decides", () => {
		expect(detectDateOrder(["05/11/2026", "01/02/2026"])).toBe("unknown");
		expect(detectDateOrder(["2026-11-15"])).toBe("unknown");
		expect(detectDateOrder(["Từ ngày", ""])).toBe("unknown");
		expect(detectDateOrder([])).toBe("unknown");
	});

	it("takes no proof from a date that exists in neither order", () => {
		for (const cell of [
			"45/01/2026",
			"31/02/2026",
			"31/04/2026",
			"00/13/2026",
			"02/30/2026",
		]) {
			expect(detectDateOrder([cell]), cell).toBe("unknown");
		}
		expect(detectDateOrder(["31/04/2026", "05/06/2026"])).toBe("unknown");
		expect(detectDateOrder(["31/04/2026", "11/25/2026"])).toBe("mdy");
	});
});
