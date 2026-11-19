import { describe, expect, it } from "vitest";
import { csvOfRows } from "../components/report-card/data-table";
import { translate } from "../i18n";
import { UTF8_BOM } from "../lib/csv";
import { vndFormatters } from "../test/render";
import type { ComplianceRow } from "./compliance";
import { actorName, operationsCsvName, shiftLabel } from "./labels";
import { logEntries } from "./log";
import type { Actors, CashCountRow } from "./source";
import { cashTable, complianceTable, logTable } from "./tables";

const t = (
	key: Parameters<typeof translate>[1],
	params?: Record<string, string | number>,
) => translate("vi", key, params);

const ACTORS: Actors = {
	currentUserId: "owner-1",
	byId: new Map([
		["owner-1", { name: null, role: "owner" }],
		["manager-1", { name: null, role: "manager" }],
		["staff-1", { name: "Nhân viên 1", role: "staff" }],
	]),
};

const ONE_STORE = [{ id: "store-1", name: "Cửa hàng 1" }];
const TWO_STORES = [...ONE_STORE, { id: "store-2", name: "Cửa hàng 2" }];

function context(stores = ONE_STORE) {
	return {
		t,
		formatters: vndFormatters(),
		stores,
		actors: ACTORS,
		timeZone: "Asia/Ho_Chi_Minh",
	};
}

function cashRow(overrides: Partial<CashCountRow> = {}): CashCountRow {
	return {
		storeId: "store-1",
		businessDate: "2026-11-17",
		shiftId: "shift-1",
		shiftNumber: 1,
		openedAt: "2026-11-16T23:00:00Z",
		closedAt: "2026-11-17T04:00:00Z",
		cashCountId: "count-1",
		countedAmount: 1_950_000,
		countedBy: "staff-1",
		countedAt: "2026-11-17T04:05:00Z",
		recounts: 0,
		expectedCashAmount: 2_000_000,
		drawerAmount: 2_000_000,
		cashSalesAmount: 1_500_000,
		varianceAmount: -50_000,
		drawerVarianceAmount: 0,
		overAbs: false,
		overRel: true,
		overZ: false,
		state: "over",
		...overrides,
	};
}

describe("operations labels", () => {
	it("names shifts Ca {n} and a count without a shift as not matched", () => {
		expect(shiftLabel(t, 3)).toBe("Ca 3");
		expect(shiftLabel(t, null)).toBe("Chưa khớp ca");
		expect(shiftLabel((key, params) => translate("en", key, params), 2)).toBe(
			"Shift 2",
		);
	});

	it("names a person as you, by their roster name or by their role, never by a login", () => {
		expect(actorName(t, ACTORS, "owner-1")).toBe("Bạn");
		expect(actorName(t, ACTORS, "staff-1")).toBe("Nhân viên 1");
		expect(actorName(t, ACTORS, "manager-1")).toBe("Quản lý");
		expect(actorName(t, ACTORS, "someone")).toBe("Không rõ");
		expect(actorName(t, undefined, "staff-1")).toBe("Không rõ");
		expect(actorName(t, ACTORS, null)).toBeNull();
	});

	it("names CSV files after the page, the card and the range without marks", () => {
		expect(
			operationsCsvName(
				"chat-luong",
				"ca-chưa-đếm",
				"2026-11-01",
				"2026-11-17",
			),
		).toBe("chat-luong-ca-chua-dem-2026-11-01_2026-11-17.csv");
	});
});

describe("the cash count table", () => {
	it("shows Ca n, the count, the POS drawer, the expected cash and the variance with the state and reasons", () => {
		const table = cashTable(
			[
				cashRow(),
				cashRow({
					shiftId: "shift-2",
					shiftNumber: 2,
					cashCountId: null,
					countedAmount: null,
					countedBy: null,
					countedAt: null,
					recounts: null,
					varianceAmount: null,
					overRel: false,
					state: "no_count",
				}),
				cashRow({
					shiftId: null,
					shiftNumber: null,
					closedAt: null,
					cashCountId: "count-3",
					state: "unmatched",
					varianceAmount: null,
					overRel: false,
				}),
			],
			context(),
		);
		expect(table.columns.map((column) => column.key)).toEqual([
			"date",
			"shift",
			"closed",
			"counted",
			"drawer",
			"expected",
			"variance",
			"status",
			"reasons",
			"counter",
			"countedAt",
			"recounts",
		]);
		expect(table.rows.map((row) => row.cells.shift)).toEqual([
			"Ca 1",
			"Ca 2",
			"Chưa khớp ca",
		]);
		expect(table.rows[0]?.cells).toMatchObject({
			counted: 1_950_000,
			drawer: 2_000_000,
			expected: 2_000_000,
			variance: -50_000,
			status: "Vượt ngưỡng",
			reasons: "so với thu tiền mặt",
			counter: "Nhân viên 1",
			closed: "17/11/2026 11:00",
		});
		expect(table.rows[1]?.cells).toMatchObject({
			status: "Chưa đếm",
			counter: null,
			recounts: null,
		});
	});

	it("adds the store column only for several stores", () => {
		expect(
			cashTable([cashRow()], context(TWO_STORES)).columns.map(
				(column) => column.key,
			),
		).toContain("store");
	});

	it("downloads as CSV with a UTF-8 BOM and the Vietnamese headings and states intact", () => {
		const table = cashTable([cashRow()], context());
		const csv = csvOfRows(
			table.columns,
			table.rows,
			(label) => `${label} (%)`,
			vndFormatters(),
		);
		expect(csv.startsWith(UTF8_BOM)).toBe(true);
		expect(csv).toContain("Đếm trên ứng dụng");
		expect(csv).toContain("Vượt ngưỡng");
		expect(csv).toContain("Ca 1");
		expect(csv).toContain("-50000");
		expect(csv.endsWith("\r\n")).toBe(true);
	});
});

describe("the compliance table", () => {
	it("shows each checklist's status, items done, photos, who ran it and its deadline", () => {
		const rows: ComplianceRow[] = [
			{
				key: "store-1|2026-11-17|t1",
				storeId: "store-1",
				businessDate: "2026-11-17",
				phase: "opening",
				templateId: "t1",
				title: "Checklist mở ca",
				status: "late",
				deadline: new Date("2026-11-17T00:00:00Z"),
				run: {
					id: "run-1",
					storeId: "store-1",
					templateId: "t1",
					templateVersion: 2,
					title: "Checklist mở ca",
					phase: "opening",
					businessDate: "2026-11-17",
					status: "finished",
					startedAt: "2026-11-17T00:05:00Z",
					finishedAt: "2026-11-17T00:20:00Z",
					startedBy: "staff-1",
					itemsTotal: 4,
					itemsDone: 3,
					photos: 1,
					photosRemoved: 0,
					corrections: 1,
				},
				runs: 1,
			},
			{
				key: "store-1|2026-11-17|t2",
				storeId: "store-1",
				businessDate: "2026-11-17",
				phase: "closing",
				templateId: "t2",
				title: "Checklist đóng ca",
				status: "missing",
				deadline: null,
				run: null,
				runs: 0,
			},
		];
		const table = complianceTable(rows, context());
		expect(table.rows[0]?.cells).toMatchObject({
			phase: "Mở ca",
			status: "Xong muộn",
			items: "3/4",
			photos: 1,
			actor: "Nhân viên 1",
			finished: "17/11/2026 07:20",
			deadline: "17/11/2026 07:00",
			corrections: 1,
		});
		expect(table.rows[1]?.cells).toMatchObject({
			phase: "Đóng ca",
			status: "Bị bỏ",
			items: null,
			actor: null,
			deadline: null,
		});
	});
});

describe("the log table", () => {
	it("writes a handover as Ca n → Ca m with its note and the incident's category and item", () => {
		const entries = logEntries(
			[
				{
					id: "i1",
					storeId: "store-1",
					businessDate: "2026-11-17",
					occurredAt: "2026-11-17T03:00:00Z",
					kind: "stock_out",
					categoryKey: "khac",
					description: "Hết trân châu đen",
					itemLabel: "Trân châu đen",
					photoBucket: null,
					photoPaths: [],
					photosRemoved: false,
					status: "open",
					reportedBy: "staff-1",
					acknowledgedBy: null,
					acknowledgedAt: null,
					resolvedBy: null,
					resolvedAt: null,
				},
			],
			[
				{
					id: "h1",
					storeId: "store-1",
					businessDate: "2026-11-17",
					fromShift: 1,
					toShift: 2,
					note: "Đã báo thợ sửa máy",
					writtenBy: "staff-1",
					writtenAt: "2026-11-17T02:00:00Z",
					acknowledgedBy: "owner-1",
					acknowledgedAt: "2026-11-17T02:30:00Z",
				},
			],
		);
		const table = logTable(
			entries,
			[{ key: "khac", label: "Khác", sortOrder: 90, active: true }],
			context(),
		);
		expect(table.rows.map((row) => row.cells.text)).toEqual([
			"Hết trân châu đen",
			"Ca 1 → Ca 2: Đã báo thợ sửa máy",
		]);
		expect(table.rows[0]?.cells).toMatchObject({
			kind: "Hết hàng",
			category: "Khác",
			item: "Trân châu đen",
			status: "Chưa xem",
			reporter: "Nhân viên 1",
			photos: 0,
		});
		expect(table.rows[1]?.cells).toMatchObject({
			kind: "Bàn giao ca",
			status: "Đã xem",
			seenBy: "Bạn",
			photos: null,
		});
	});
});
