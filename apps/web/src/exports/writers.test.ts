import { describe, expect, it } from "vitest";
import { csvText, fileBytes, jsonText } from "./writers";

const COLUMNS = [
	"store_name",
	"receipt_no",
	"item_name",
	"net_amount",
	"changed_after_close",
	"note",
];

const ROWS = [
	{
		store_name: 'Quán "Đêm"; số 2',
		receipt_no: "00123",
		item_name: "=SUM(A1:A9)",
		net_amount: 120500.5,
		changed_after_close: true,
		note: null,
	},
	{
		store_name: "Cửa hàng mẫu",
		receipt_no: "45",
		item_name: "Bánh mì, pa tê\r\nthêm trứng",
		net_amount: -1000,
		changed_after_close: false,
		note: "+84 ưu đãi",
	},
];

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

describe("CSV files", () => {
	it("start with the UTF-8 byte order mark, end lines with CRLF and keep diacritics", () => {
		const bytes = fileBytes({
			format: "csv",
			dialect: "comma",
			meta: { table: "invoices", store: "S1", month: "2026-10" },
			columns: COLUMNS,
			rows: ROWS,
		});
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = decoder.decode(bytes);
		expect(text.startsWith("\u{FEFF}store_name,receipt_no,")).toBe(true);
		expect(text.endsWith("\r\n")).toBe(true);
		expect(text).toContain("Cửa hàng mẫu");
		expect(text.split("\r\n")).toHaveLength(5);
	});

	it("quotes separators, quotes and line breaks and neutralises formulas", () => {
		const lines = csvText(COLUMNS, ROWS, "comma").split("\r\n");
		expect(lines[1]).toBe(
			'"Quán ""Đêm""; số 2",00123,\'=SUM(A1:A9),120500.5,true,',
		);
		expect(lines[2]).toBe('Cửa hàng mẫu,45,"Bánh mì, pa tê');
		expect(lines[3]).toBe("thêm trứng\",-1000,false,'+84 ưu đãi");
	});

	it("uses semicolons and a decimal comma in the semicolon dialect, never a sep= line", () => {
		const text = csvText(COLUMNS, ROWS, "semicolon");
		expect(text).not.toContain("sep=");
		const lines = text.split("\r\n");
		expect(lines[0]).toBe(
			"\u{FEFF}store_name;receipt_no;item_name;net_amount;changed_after_close;note",
		);
		expect(lines[1]).toBe(
			'"Quán ""Đêm""; số 2";00123;\'=SUM(A1:A9);120500,5;true;',
		);
	});
});

describe("JSON files", () => {
	it("carry no byte order mark and describe the table, store and month", () => {
		const bytes = fileBytes({
			format: "json",
			dialect: "semicolon",
			meta: { table: "invoices", store: "S1", month: "2026-10" },
			columns: COLUMNS,
			rows: ROWS,
		});
		expect(bytes[0]).toBe("{".charCodeAt(0));
		const document = JSON.parse(decoder.decode(bytes));
		expect(document).toMatchObject({
			format: "fnb-export",
			version: 1,
			table: "invoices",
			store: "S1",
			month: "2026-10",
			columns: COLUMNS,
		});
		expect(document.rows[0]).toEqual(ROWS[0]);
		expect(Object.keys(document.rows[1])).toEqual(COLUMNS);
	});

	it("keeps identifiers as text and leaves formulas untouched", () => {
		const text = jsonText(
			{ table: "invoices", store: null, month: "2026-10" },
			["receipt_no", "item_name"],
			ROWS,
		);
		expect(text).toContain('"receipt_no":"00123"');
		expect(text).toContain('"item_name":"=SUM(A1:A9)"');
		expect(text.endsWith("}\n")).toBe(true);
	});
});
