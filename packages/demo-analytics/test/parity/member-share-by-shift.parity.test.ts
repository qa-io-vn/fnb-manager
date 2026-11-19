import type { GeneratedDay } from "@fnb/connector-mock";
import { addDays, type IsoDate, type ThemeArgs } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	DemoDayRewrite,
	DemoReportSource,
	DemoStoreId,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { type ParityDataset, parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { matrixAnchors, STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 1;
const RANGE_DAYS = [7, 92] as const;
const OPTIONS = {
	key: ["store_id", "business_date", "shift_ordinal"],
	timestampColumns: ["opened_at", "closed_at"],
	checkOrder: true,
};

const MEMBER_STORE: DemoStoreId = "MOCK-S1";
const MEMBER_DAYS_BEFORE_AS_OF = 3;
const UNSHIFTED_PHONE = "0900000901";
const VOIDED_PHONE = "0900000902";
const UNKNOWN_SHIFT_PHONE = "0900000903";
const UNKNOWN_SHIFT_ID = "PARITY-MEMBER-NO-SHIFT";
const EMPTY_SHIFT_ID = "PARITY-MEMBER-EMPTY-SHIFT";
const MINUTE_MS = 60_000;

function memberDay(asOf: IsoDate): IsoDate {
	return addDays(asOf, -MEMBER_DAYS_BEFORE_AS_OF);
}

function memberCases(asOf: IsoDate): DemoDayRewrite {
	const date = memberDay(asOf);
	return (store, day: GeneratedDay) => {
		if (store.id !== MEMBER_STORE || day.date !== date) return day;
		const completed = day.sales.filter((sale) => sale.status === "completed");
		const [unshifted, voided, unknownShift] = completed;
		if (
			unshifted === undefined ||
			voided === undefined ||
			unknownShift === undefined
		) {
			throw new Error("too few completed sales for the member cases");
		}
		unshifted.shiftExternalId = undefined;
		unshifted.customerPhone = UNSHIFTED_PHONE;
		voided.status = "voided";
		voided.customerPhone = VOIDED_PHONE;
		unknownShift.shiftExternalId = UNKNOWN_SHIFT_ID;
		unknownShift.customerPhone = UNKNOWN_SHIFT_PHONE;
		const last = day.shifts.reduce((latest, shift) =>
			shift.openedAt.getTime() > latest.openedAt.getTime() ? shift : latest,
		);
		const opened = new Date(
			(last.closedAt ?? last.openedAt).getTime() + MINUTE_MS,
		);
		day.shifts = [
			...day.shifts,
			{
				...last,
				externalId: EMPTY_SHIFT_ID,
				openedAt: opened,
				closedAt: new Date(opened.getTime() + 30 * MINUTE_MS),
				salesAmount: 0,
				ordersCount: 0,
			},
		];
		return day;
	};
}

function memberDataset(): ParityDataset {
	return {
		id: "M1",
		from: addDays(clock.asOf, -20),
		to: clock.today,
		volumeScale: 0.3,
		rewriteDay: memberCases(clock.asOf),
	};
}

describe("member_share_by_shift in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3, memberDataset()],
			clock,
		);
		for (const seeded of database.datasets) {
			engines.set(seeded.dataset.id, themeEngine(seeded, clock));
		}
	});

	afterAll(async () => {
		console.info(
			`member_share_by_shift parity: ${report.summary().split("\n")[0]}`,
		);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function engineOf(seeded: SeededDataset): DemoReportSource {
		const engine = engines.get(seeded.dataset.id);
		if (engine === undefined) throw new Error("no theme engine");
		return engine;
	}

	function seededOf(id: string): SeededDataset {
		const seeded = active().datasets.find(
			(candidate) => candidate.dataset.id === id,
		);
		if (seeded === undefined) throw new Error(`no ${id} dataset`);
		return seeded;
	}

	async function compare(
		seeded: SeededDataset,
		args: ThemeArgs<"member_share_by_shift">,
		label: string,
	): Promise<void> {
		await compareThemeCall(
			report,
			active(),
			seeded,
			engineOf(seeded),
			"member_share_by_shift",
			args,
			OPTIONS,
			label,
		);
	}

	it("matches row by row over 7 and 92 days for every store set at each anchor of the matrix, with members attached since the capture ramp", async () => {
		for (const seeded of active().datasets) {
			for (const anchor of matrixAnchors(seeded, clock, RANDOM_ANCHORS)) {
				for (const days of RANGE_DAYS) {
					for (const stores of STORE_SETS) {
						await compare(
							seeded,
							{
								store_ids: [...stores],
								from_date: addDays(anchor, -(days - 1)),
								to_date: anchor,
							},
							` ${days}d`,
						);
					}
				}
			}
		}
		const members = await engineOf(seededOf("D1")).callTheme(
			"member_share_by_shift",
			{
				store_ids: ["MOCK-S1", "MOCK-S2"],
				from_date: addDays(clock.asOf, -91),
				to_date: clock.asOf,
			},
		);
		expect(members.some((row) => row.member_invoices > 0)).toBe(true);
		expect(members.some((row) => row.member_invoices === 0)).toBe(true);
		expect(report.rows).toBeGreaterThan(1_000);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("counts an invoice without a shift and one naming an unknown shift in the Không rõ ca row, leaves a voided invoice out and gives an empty shift zeros, in both engines", async () => {
		const seeded = seededOf("M1");
		const day = memberDay(clock.asOf);
		const args = { store_ids: [MEMBER_STORE], from_date: day, to_date: day };
		await compare(seeded, args, " member cases");
		const rows = await engineOf(seeded).callTheme(
			"member_share_by_shift",
			args,
		);
		const unknown = rows.filter((row) => row.shift_ordinal === null);
		expect(unknown).toHaveLength(1);
		expect(unknown[0]?.member_invoices).toBeGreaterThanOrEqual(2);
		const last = rows.filter((row) => row.shift_ordinal !== null).at(-1);
		expect(last).toMatchObject({
			invoices: 0,
			member_invoices: 0,
			member_share: null,
		});
		const [phones] = await active().connection.rows(
			`select
				count(*) filter (where i.status <> 'voided' and i.has_customer_phone)::integer as members,
				count(*) filter (where i.status = 'voided' and i.has_customer_phone)::integer as voided
			from public.invoices i
			where i.store_id = $1::uuid and i.business_date = $2::date`,
			[seeded.uuidOf(MEMBER_STORE), day],
		);
		expect(Number(phones?.voided)).toBeGreaterThanOrEqual(1);
		expect(rows.reduce((sum, row) => sum + row.member_invoices, 0)).toBe(
			Number(phones?.members),
		);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("refuses the same calls with 22023 in both engines", async () => {
		const seeded = seededOf("D1");
		for (const args of [
			{
				store_ids: ["MOCK-S1"],
				from_date: addDays(clock.asOf, -92),
				to_date: clock.asOf,
			},
			{
				store_ids: ["MOCK-S1"],
				from_date: clock.asOf,
				to_date: addDays(clock.asOf, -1),
			},
			{ store_ids: [], from_date: clock.asOf, to_date: clock.asOf },
		]) {
			await compare(seeded, args, " edges");
		}
		await expect(
			engineOf(seeded).callTheme("member_share_by_shift", {
				store_ids: ["MOCK-S1"],
				from_date: addDays(clock.asOf, -92),
				to_date: clock.asOf,
			}),
		).rejects.toMatchObject({ code: "22023" });
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
