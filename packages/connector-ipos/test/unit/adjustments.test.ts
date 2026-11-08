import type { CanonicalAdjustment, DataQualityFlag } from "@fnb/core";
import { zonedInstant } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	createIposConnector,
	FLAG_CODES,
	type IposConnectorOptions,
	LOGIN_PATH,
	REMOVED_ITEMS_PATH,
	SALE_EDIT_DELETE_PATH,
	sameCalendarMonth,
} from "../../src/index.js";
import {
	envelope,
	errorEnvelope,
	fakeUuid,
	makeChangeLogLine,
	makeEditDeleteRow,
	makeLoginPayload,
	makeRemovedItemEvent,
	TEST_CREDENTIALS,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	type RecordedRequest,
	routeByPath,
} from "../fixtures/fake-fetch.js";

type Row = Record<string, unknown>;

const TIMEZONE = "Asia/Ho_Chi_Minh";
const DAY = { fromDate: "2026-11-07", toDate: "2026-11-07" };
const CROSS_MONTH_WINDOW = { fromDate: "2026-10-30", toDate: "2026-11-02" };

function local(date: string, hour: number, minute = 0): number {
	return zonedInstant(date, hour * 60 + minute, TIMEZONE).getTime();
}

const VOID_TRAN = fakeUuid(601);
const EDIT_TRAN = fakeUuid(602);
const EDIT_ORIGIN = fakeUuid(603);
const EDIT_FIRST_ORIGIN_TRAN = fakeUuid(604);
const EDIT_FIRST_ORIGIN = fakeUuid(605);
const EDIT_ORPHAN_TRAN = fakeUuid(606);
const LATE_VOID_TRAN = fakeUuid(607);
const ODD_STATUS_TRAN = fakeUuid(608);
const EDIT_UP_TRAN = fakeUuid(609);
const EDIT_UP_ORIGIN = fakeUuid(610);
const SEPTEMBER_VOID_TRAN = fakeUuid(611);
const REMOVAL_TRAN = fakeUuid(651);
const UNSUFFIXED_TRAN = fakeUuid(652);
const UNSUFFIXED_LINE = fakeUuid(7204);
const LONG_WINDOW = { fromDate: "2026-09-20", toDate: "2026-11-05" };
const REMOVED_LINE_A = fakeUuid(7201);
const REMOVED_LINE_B = fakeUuid(7202);
const KEPT_LINE = fakeUuid(7203);

const editDeleteRows: Row[] = [
	makeEditDeleteRow(1, local("2026-11-07", 9, 40), {
		tran_id: VOID_TRAN,
		first_origin_tran_id: VOID_TRAN,
		updated_at: local("2026-11-07", 9, 52),
		total_amount_origin: 85_000,
		sale_note: "Phục vụ nhầm",
	}),
	makeEditDeleteRow(2, local("2026-11-07", 14, 0), {
		tran_id: EDIT_TRAN,
		status: "EDIT",
		origin_tran_id: EDIT_ORIGIN,
		first_origin_tran_id: EDIT_ORIGIN,
		updated_at: local("2026-11-07", 14, 6),
		total_amount_origin: 120_000,
		total_amount: 95_000,
		sale_note: "",
	}),
	makeEditDeleteRow(3, local("2026-11-07", 15, 0), {
		tran_id: EDIT_FIRST_ORIGIN_TRAN,
		status: "EDIT",
		origin_tran_id: "",
		first_origin_tran_id: EDIT_FIRST_ORIGIN,
		updated_at: local("2026-11-07", 15, 3),
		total_amount_origin: 50_000,
		total_amount: 50_000,
	}),
	makeEditDeleteRow(4, local("2026-11-07", 16, 0), {
		tran_id: EDIT_ORPHAN_TRAN,
		status: "EDIT",
		origin_tran_id: null,
		first_origin_tran_id: "",
		updated_at: local("2026-11-07", 16, 1),
		total_amount_origin: 70_000,
		total_amount: 60_000,
	}),
	makeEditDeleteRow(5, local("2026-11-07", 23, 50), {
		tran_id: LATE_VOID_TRAN,
		first_origin_tran_id: LATE_VOID_TRAN,
		updated_at: local("2026-11-08", 0, 10),
		total_amount_origin: 40_000,
	}),
	makeEditDeleteRow(6, local("2026-11-07", 11, 0), {
		tran_id: ODD_STATUS_TRAN,
		status: "RESTORE",
		updated_at: local("2026-11-07", 11, 5),
	}),
	makeEditDeleteRow(7, local("2026-11-07", 17, 0), {
		tran_id: EDIT_UP_TRAN,
		status: "EDIT",
		origin_tran_id: EDIT_UP_ORIGIN,
		first_origin_tran_id: EDIT_UP_ORIGIN,
		updated_at: local("2026-11-07", 17, 2),
		total_amount_origin: 50_000,
		total_amount: 80_000,
		sale_note: "",
	}),
	makeEditDeleteRow(8, local("2026-09-25", 10, 0), {
		tran_id: SEPTEMBER_VOID_TRAN,
		first_origin_tran_id: SEPTEMBER_VOID_TRAN,
		updated_at: local("2026-09-25", 10, 5),
		total_amount_origin: 30_000,
	}),
];

const unsuffixedRemovalEvent: Row = makeRemovedItemEvent(
	4,
	local("2026-11-07", 19, 0),
	[
		makeChangeLogLine(`${REMOVED_LINE_A}_REMOVE`, {
			item_id: "I001",
			quantity: -1,
			price: 45_000,
			amount: 45_000,
		}),
		makeChangeLogLine(UNSUFFIXED_LINE, {
			item_id: "I004",
			item_name: "Item 4",
			quantity: -1,
			sort_index: -1,
			price: 35_000,
			amount: 35_000,
		}),
		makeChangeLogLine(KEPT_LINE, { item_id: "I003", item_name: "Item 3" }),
	],
	{ tran_id: UNSUFFIXED_TRAN },
);

const removalEvent: Row = makeRemovedItemEvent(
	1,
	local("2026-11-07", 18, 30),
	[
		makeChangeLogLine(KEPT_LINE, { item_id: "I003", item_name: "Item 3" }),
		makeChangeLogLine(`${REMOVED_LINE_A}_REMOVE`, {
			item_id: "I001",
			item_name: "Item 1 (M)",
			quantity: -2,
			price: 45_000,
			amount: 90_000,
		}),
		makeChangeLogLine(`${REMOVED_LINE_B}_REMOVE`, {
			item_id: "I002",
			item_name: "Item 2 (L)",
			quantity: -1,
			price: 55_000,
			amount: 55_000,
		}),
	],
	{ tran_id: REMOVAL_TRAN, tran_no: "" },
);

function queryNumber(request: RecordedRequest, name: string): number {
	return Number(request.url.searchParams.get(name));
}

function inRange(request: RecordedRequest, field: string) {
	const start = queryNumber(request, "start_date");
	const end = queryNumber(request, "end_date");
	return (row: Row) => Number(row[field]) >= start && Number(row[field]) <= end;
}

function responder(removalEvents: Row[] = [removalEvent]) {
	return routeByPath({
		[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
		"/api/mdata/v1/stores": () => jsonResponse(envelope([])),
		[SALE_EDIT_DELETE_PATH]: (request) =>
			jsonResponse({
				data: editDeleteRows.filter(inRange(request, "updated_at")),
				data_shift: [],
				track_id: "track-0005",
			}),
		[REMOVED_ITEMS_PATH]: (request) => {
			const range = {
				startDate: queryNumber(request, "start_date"),
				endDate: queryNumber(request, "end_date"),
			};
			if (!sameCalendarMonth(range, TIMEZONE)) {
				return jsonResponse(errorEnvelope(0, "Truyền thiếu dữ liệu"), 400);
			}
			return jsonResponse(
				envelope(removalEvents.filter(inRange(request, "log_date"))),
			);
		},
	});
}

async function fetchAdjustments(
	window: { fromDate: string; toDate: string },
	options: IposConnectorOptions = {},
	removalEvents?: Row[],
) {
	const fake = createFakeFetch(responder(removalEvents));
	const flags: DataQualityFlag[] = [];
	const contextFlags: DataQualityFlag[] = [];
	const connector = createIposConnector({
		fetch: fake.fetch,
		onFlag: (flag) => flags.push(flag),
		...options,
	});
	await connector.authenticate(TEST_CREDENTIALS);
	const [store] = await connector.discoverStores();
	if (!store) {
		throw new Error("login payload had no store");
	}
	const adjustments = await connector.fetchAdjustments(store, window, {
		onFlag: (flag) => contextFlags.push(flag),
	});
	return { adjustments, flags, contextFlags, fake, store };
}

function byKind(adjustments: CanonicalAdjustment[], kind: string) {
	return adjustments.filter((adjustment) => adjustment.kind === kind);
}

describe("iPOS adapter adjustments", () => {
	it("turns a cancelled invoice into a voided adjustment with the pre-cancel amount and the cashier's reason", async () => {
		const { adjustments } = await fetchAdjustments(DAY);
		const voided = byKind(adjustments, "voided");
		expect(voided).toHaveLength(1);
		expect(voided[0]).toMatchObject({
			saleExternalId: VOID_TRAN,
			amount: 85_000,
			reason: "Phục vụ nhầm",
		});
		expect(voided[0]?.relatedSaleExternalId).toBeUndefined();
		expect(voided[0]?.occurredAt.getTime()).toBe(local("2026-11-07", 9, 52));
		expect(voided[0]?.raw).toMatchObject({ status: "DELETE" });
	});

	it("turns an edited invoice into an edited adjustment linked to its origin with the amount difference", async () => {
		const { adjustments, flags } = await fetchAdjustments(DAY);
		const edited = byKind(adjustments, "edited");
		expect(edited.map((adjustment) => adjustment.saleExternalId)).toEqual([
			EDIT_TRAN,
			EDIT_FIRST_ORIGIN_TRAN,
			EDIT_ORPHAN_TRAN,
			EDIT_UP_TRAN,
		]);
		expect(edited[0]).toMatchObject({
			relatedSaleExternalId: EDIT_ORIGIN,
			amount: 25_000,
		});
		expect(edited[0]?.reason).toBeUndefined();
		expect(edited[1]).toMatchObject({
			relatedSaleExternalId: EDIT_FIRST_ORIGIN,
			amount: 0,
		});
		expect(edited[2]?.relatedSaleExternalId).toBeUndefined();
		expect(edited[2]?.amount).toBe(10_000);
		expect(
			flags.filter((flag) => flag.code === FLAG_CODES.editWithoutOrigin),
		).toMatchObject([{ saleExternalId: EDIT_ORPHAN_TRAN, severity: "warn" }]);
	});

	it("drops a row with an unknown status and says so through a flag", async () => {
		const { adjustments, flags, contextFlags } = await fetchAdjustments(DAY);
		expect(
			adjustments.some(
				(adjustment) => adjustment.saleExternalId === ODD_STATUS_TRAN,
			),
		).toBe(false);
		const unknown = flags.filter(
			(flag) => flag.code === FLAG_CODES.unknownAdjustmentStatus,
		);
		expect(unknown).toMatchObject([{ saleExternalId: ODD_STATUS_TRAN }]);
		expect(contextFlags).toEqual(flags);
	});

	it("emits one line_removed adjustment per _REMOVE line and skips the kept line", async () => {
		const { adjustments } = await fetchAdjustments(DAY);
		const removed = byKind(adjustments, "line_removed");
		expect(removed).toHaveLength(2);
		expect(removed[0]).toMatchObject({
			saleExternalId: REMOVAL_TRAN,
			lineExternalId: `${REMOVED_LINE_A}_REMOVE`,
			itemExternalId: "I001",
			itemName: "Item 1 (M)",
			quantity: 2,
			amount: 90_000,
		});
		expect(removed[1]).toMatchObject({
			lineExternalId: `${REMOVED_LINE_B}_REMOVE`,
			itemExternalId: "I002",
			quantity: 1,
			amount: 55_000,
		});
		for (const adjustment of removed) {
			expect(adjustment.occurredAt.getTime()).toBe(local("2026-11-07", 18, 30));
			const raw = adjustment.raw as { sale_detail: Row[] };
			expect(raw.sale_detail).toHaveLength(1);
			expect(raw.sale_detail[0]?.id_sale_detail).toBe(
				adjustment.lineExternalId,
			);
		}
		expect(
			removed.some((adjustment) => adjustment.lineExternalId === KEPT_LINE),
		).toBe(false);
	});

	it("keeps only adjustments whose change time falls on a business date inside the window", async () => {
		const { adjustments, fake } = await fetchAdjustments(DAY);
		expect(
			adjustments.some(
				(adjustment) => adjustment.saleExternalId === LATE_VOID_TRAN,
			),
		).toBe(false);
		const request = fake.requestsTo(SALE_EDIT_DELETE_PATH)[0];
		expect(request?.url.searchParams.get("start_date")).toBe(
			String(local("2026-11-06", 0)),
		);
		expect(request?.url.searchParams.get("end_date")).toBe(
			String(local("2026-11-09", 0) - 1),
		);
		expect(request?.url.searchParams.get("store_open_at")).toBe("0");

		const nextDay = await fetchAdjustments({
			fromDate: "2026-11-08",
			toDate: "2026-11-08",
		});
		expect(
			nextDay.adjustments.map((adjustment) => adjustment.saleExternalId),
		).toEqual([LATE_VOID_TRAN]);
	});

	it("attributes a post-midnight cancellation to the previous business date when the day starts at 05:00", async () => {
		const { adjustments } = await fetchAdjustments(DAY, {
			dayStartMinutes: 5 * 60,
		});
		expect(
			adjustments.map((adjustment) => adjustment.saleExternalId),
		).toContain(LATE_VOID_TRAN);
	});

	it("splits a cross-month window into month-bounded removed-item calls and orders the result by time", async () => {
		const octoberEvent = makeRemovedItemEvent(2, local("2026-10-31", 20, 0), [
			makeChangeLogLine(`${fakeUuid(7301)}_REMOVE`, { quantity: -1 }),
		]);
		const novemberEvent = makeRemovedItemEvent(3, local("2026-11-02", 8, 0), [
			makeChangeLogLine(`${fakeUuid(7302)}_REMOVE`, { quantity: -1 }),
		]);
		const { adjustments, fake } = await fetchAdjustments(
			CROSS_MONTH_WINDOW,
			{},
			[novemberEvent, octoberEvent],
		);
		const requests = fake.requestsTo(REMOVED_ITEMS_PATH);
		expect(requests).toHaveLength(2);
		expect(requests[0]?.url.searchParams.get("start_date")).toBe(
			String(local("2026-10-29", 0)),
		);
		expect(requests[0]?.url.searchParams.get("end_date")).toBe(
			String(local("2026-11-01", 0) - 1),
		);
		expect(requests[1]?.url.searchParams.get("start_date")).toBe(
			String(local("2026-11-01", 0)),
		);
		expect(requests[1]?.url.searchParams.get("end_date")).toBe(
			String(local("2026-11-04", 0) - 1),
		);
		expect(
			byKind(adjustments, "line_removed").map(
				(adjustment) => adjustment.saleExternalId,
			),
		).toEqual([String(octoberEvent.tran_id), String(novemberEvent.tran_id)]);
	});

	it("de-duplicates an event the server returns twice", async () => {
		const { adjustments } = await fetchAdjustments(DAY, {}, [
			removalEvent,
			{ ...removalEvent },
		]);
		expect(byKind(adjustments, "line_removed")).toHaveLength(2);
	});

	it("reports an edit that increased the bill with the absolute difference and keeps the direction in raw", async () => {
		const { adjustments, flags } = await fetchAdjustments(DAY);
		const increased = adjustments.find(
			(adjustment) => adjustment.saleExternalId === EDIT_UP_TRAN,
		);
		expect(increased).toMatchObject({
			kind: "edited",
			relatedSaleExternalId: EDIT_UP_ORIGIN,
			amount: 30_000,
		});
		expect(increased?.raw).toMatchObject({
			total_amount_origin: 50_000,
			total_amount: 80_000,
		});
		expect(
			adjustments.every((adjustment) => (adjustment.amount ?? 0) >= 0),
		).toBe(true);
		expect(
			flags.filter((flag) => flag.saleExternalId === EDIT_UP_TRAN),
		).toEqual([]);
	});

	it("recognises a removed line by its negative quantity when the _REMOVE suffix is missing and flags it", async () => {
		const { adjustments, flags } = await fetchAdjustments(DAY, {}, [
			unsuffixedRemovalEvent,
		]);
		const removed = byKind(adjustments, "line_removed");
		expect(removed.map((adjustment) => adjustment.lineExternalId)).toEqual([
			`${REMOVED_LINE_A}_REMOVE`,
			UNSUFFIXED_LINE,
		]);
		expect(removed[1]).toMatchObject({
			saleExternalId: UNSUFFIXED_TRAN,
			itemExternalId: "I004",
			itemName: "Item 4",
			quantity: 1,
			amount: 35_000,
		});
		expect(
			removed.some((adjustment) => adjustment.lineExternalId === KEPT_LINE),
		).toBe(false);
		expect(
			flags.filter((flag) => flag.code === FLAG_CODES.removedLineWithoutSuffix),
		).toMatchObject([{ saleExternalId: UNSUFFIXED_TRAN, severity: "info" }]);
		expect(
			flags.filter((flag) => flag.saleExternalId === UNSUFFIXED_TRAN),
		).toHaveLength(1);
	});

	it("splits a window longer than a calendar month into month-bounded C05 calls and concatenates the rows", async () => {
		const { adjustments, fake } = await fetchAdjustments(LONG_WINDOW);
		const requests = fake.requestsTo(SALE_EDIT_DELETE_PATH);
		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(
				sameCalendarMonth(
					{
						startDate: queryNumber(request, "start_date"),
						endDate: queryNumber(request, "end_date"),
					},
					TIMEZONE,
				),
			).toBe(true);
		}
		expect(queryNumber(requests[0] as RecordedRequest, "start_date")).toBe(
			local("2026-09-19", 0),
		);
		expect(queryNumber(requests[2] as RecordedRequest, "end_date")).toBe(
			local("2026-11-07", 0) - 1,
		);
		const voided = byKind(adjustments, "voided").map(
			(adjustment) => adjustment.saleExternalId,
		);
		expect(voided).toContain(SEPTEMBER_VOID_TRAN);
		expect(voided).not.toContain(VOID_TRAN);
	});
});
