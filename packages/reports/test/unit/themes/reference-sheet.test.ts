import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERIOD_TOTAL_COLUMNS } from "../../../src/contract/rows.js";
import {
	chunksOf,
	type HeatmapRow,
	type ItemRow,
	type PaymentRow,
	type ProfileRow,
	paymentInvoiceShareOf,
	paymentRowsFor,
	rowValue,
	sellerRows,
	type TotalsRow,
	windowDays,
	windowFactsOf,
} from "../../live/reference-facts.js";
import {
	type PaymentShare,
	parseHourlyReference,
	parseMenuChecks,
	parsePaymentMix,
	parseReferenceSheet,
	parseSheetValue,
	type ReferenceSheet,
	rowKindOf,
	SheetError,
	type SheetValue,
	siblingPath,
	storeFor,
	type ValueRowKind,
	windowOf,
	within,
} from "../../live/reference-sheet.js";

const SHEET = readFileSync(
	new URL("./reference-sheet/sheet.md", import.meta.url),
	"utf8",
);
const HOURLY = readFileSync(
	new URL("./reference-sheet/hourly.md", import.meta.url),
	"utf8",
);

const LOTUS = "11111111-1111-4111-8111-111111111111";
const HARBOUR = "22222222-2222-4222-8222-222222222222";
const STORES = [
	{ id: LOTUS, name: "Lotus Tea House" },
	{ id: HARBOUR, name: "Harbour Coffee" },
];

interface StoreDay {
	readonly invoices: number;
	readonly hours: Readonly<Record<number, number>>;
	readonly weekdays: Readonly<Record<number, number>>;
	readonly payments: readonly [string, PaymentRow["kind"], number][];
}

const STORE_FACTS: Readonly<Record<string, StoreDay>> = {
	[LOTUS]: {
		invoices: 1_000,
		hours: { 8: 10e6, 9: 20e6, 10: 5e6, 20: 15e6 },
		weekdays: { 1: 6e6, 2: 6e6, 3: 6e6, 4: 7e6, 5: 8e6, 6: 8e6, 7: 9e6 },
		payments: [
			["Tiền mặt", "cash", 400],
			["Chuyển khoản", "bank_transfer", 350],
			["QR Wallet Pay", "ewallet", 250],
		],
	},
	[HARBOUR]: {
		invoices: 800,
		hours: { 8: 12e6, 9: 8e6, 10: 10e6, 20: 10e6 },
		weekdays: { 1: 5e6, 2: 5e6, 3: 5e6, 4: 7e6, 5: 6e6, 6: 6e6, 7: 6e6 },
		payments: [
			["Chuyển khoản", "bank_transfer", 480],
			["Tiền mặt", "cash", 320],
		],
	},
};

function profileRow(
	scope: ProfileRow["scope"],
	weekday: number | null,
	hour: number | null,
	invoices: number,
	net: number,
): ProfileRow {
	return {
		scope,
		weekday,
		hour_local: hour,
		hour_position: hour,
		days_with_data: 30,
		invoices,
		net_amount: net,
		avg_net_amount: net / 30,
		avg_invoices: invoices / 30,
		net_share: null,
		level: null,
		peak_share: null,
		dead_share: null,
		peak_hours_used: 3,
		dead_hour_ratio_used: 0.5,
		busy_hour_ratio_used: 1.25,
	};
}

function heatmapRow(weekday: number, hour: number, net: number): HeatmapRow {
	return {
		weekday,
		hour_local: hour,
		days_with_data: 4,
		invoices: 1,
		net_amount: net,
		avg_net_amount: net / 4,
		avg_invoices: 0.25,
	};
}

function totalsRow(invoices: number, net: number): TotalsRow {
	const empty = Object.fromEntries(
		PERIOD_TOTAL_COLUMNS.map((column) => [column, null]),
	);
	return {
		...empty,
		range_index: 1,
		store_id: null,
		from_date: "2026-12-20",
		to_date: "2027-01-18",
		days_with_data: 30,
		invoices,
		net_amount: net,
	} as TotalsRow;
}

function paymentRow(
	name: string,
	kind: PaymentRow["kind"],
	invoices: number,
	share: number,
): PaymentRow {
	return {
		method_key: name,
		kind,
		payment_method_name: name,
		invoices,
		amount: share * 1e6,
		share,
		fee_amount: 0,
		fee_estimate_amount: 0,
		compare_amount: null,
		compare_share: null,
	};
}

function itemRow(
	name: string,
	base: string | null,
	size: string | null,
	quantity: number,
	net: number,
): ItemRow {
	return {
		item_external_id: name,
		item_name: name,
		base_name: base,
		size_label: size,
		item_type_external_id: null,
		item_type_name: null,
		role: null,
		quantity,
		net_amount: net,
		invoices: quantity,
		days_sold: 7,
		net_share: null,
		compare_quantity: null,
		compare_net_amount: null,
		compare_net_share: null,
		first_sold_on: null,
		last_sold_on: null,
	};
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function factsFor(storeId: string) {
	const store = STORE_FACTS[storeId];
	if (store === undefined) throw new Error("no such store");
	const net = sum(Object.values(store.hours));
	const hours = Object.entries(store.hours).map(([hour, amount]) =>
		profileRow("all", null, Number(hour), 1, amount),
	);
	const weekdays = Object.entries(store.weekdays).map(([day, amount]) =>
		profileRow("weekday", Number(day), null, 1, amount),
	);
	const totalPaid = sum(store.payments.map(([, , invoices]) => invoices));
	return windowFactsOf({
		profile: [
			...hours,
			profileRow("all", null, null, store.invoices, net),
			...weekdays,
		],
		heatmap: Object.entries(store.weekdays).flatMap(([day, dayNet]) =>
			Object.entries(store.hours).map(([hour, hourNet]) =>
				heatmapRow(Number(day), Number(hour), (hourNet * dayNet) / net),
			),
		),
		totals: totalsRow(store.invoices, net),
		payments: store.payments.map(([name, kind, invoices]) =>
			paymentRow(name, kind, invoices, invoices / totalPaid),
		),
	});
}

function value(
	sheet: ReferenceSheet,
	index: number,
	column: number,
): SheetValue {
	const row = sheet.rows.find((candidate) => candidate.index === index);
	if (row?.form !== "value") throw new Error(`row ${index} holds no value`);
	const cell = row.cells[column];
	if (cell === undefined) throw new Error("no such column");
	return cell;
}

function expectSheetError(run: () => unknown, message?: RegExp): void {
	expect(run).toThrow(SheetError);
	if (message !== undefined) expect(run).toThrow(message);
}

describe("the reference window's dates", () => {
	it("gives the first date the second's year, or the year before when its month is later", () => {
		expect(windowOf("## A — reference window 20 Dec – 18 Jan 2027")).toEqual({
			from: "2026-12-20",
			to: "2027-01-18",
		});
		expect(windowOf("reference window 3 Mar - 1 Apr 2026")).toEqual({
			from: "2026-03-03",
			to: "2026-04-01",
		});
		expect(windowOf("reference window 1 September – 30 Sept. 2026")).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
		});
	});

	it("refuses missing, impossible or backwards dates", () => {
		expectSheetError(() => windowOf("reference window"), /cannot be read/);
		expectSheetError(() => windowOf("31 Feb – 2 Mar 2026"), /does not exist/);
		expectSheetError(() => windowOf("9 Mar – 2 Mar 2026"), /before it starts/);
		expectSheetError(() => windowOf("1 Foo – 2 Mar 2026"), /month/);
	});
});

describe("sheet values and their tolerances", () => {
	it("reads millions, dong, shares and counts", () => {
		expect(parseSheetValue("123.4 M₫")).toEqual({
			value: 123_400_000,
			tolerance: 617_000,
			unit: "amount",
		});
		expect(parseSheetValue("2.5 M₫")).toEqual({
			value: 2_500_000,
			tolerance: 50_000,
			unit: "amount",
		});
		expect(parseSheetValue("12,345 ₫")).toEqual({
			value: 12_345,
			tolerance: 12_345 * 0.005,
			unit: "amount",
		});
		expect(parseSheetValue("≈ 35 %")).toEqual({
			value: 0.35,
			tolerance: 0.01,
			unit: "share",
		});
		expect(parseSheetValue("1,234")).toEqual({
			value: 1_234,
			tolerance: 1_234 * 0.005,
			unit: "count",
		});
		expect(parseSheetValue("42")).toEqual({
			value: 42,
			tolerance: 0.5,
			unit: "count",
		});
		expect(parseSheetValue("**9.8**", true)).toEqual({
			value: 9_800_000,
			tolerance: 50_000,
			unit: "amount",
		});
	});

	it("refuses what it cannot read", () => {
		for (const text of ["n/a", "1.2.3", "", "12 items", "M₫", "1.5"]) {
			expectSheetError(() => parseSheetValue(text), /cannot be read/);
		}
	});

	it("accepts a value inside the tolerance and refuses one outside or missing", () => {
		const expected = parseSheetValue("2.5 M₫");
		expect(within(2_550_000, expected)).toBe(true);
		expect(within(2_449_999, expected)).toBe(false);
		expect(within(null, expected)).toBe(false);
		expect(within(Number.NaN, expected)).toBe(false);
		const share = parseSheetValue("≈ 35 %");
		expect(within(0.36, share)).toBe(true);
		expect(within(0.3601, share)).toBe(false);
	});
});

describe("row labels", () => {
	it("recognises the compared rows case-insensitively and skips the others", () => {
		expect(rowKindOf("INVOICES")).toEqual({ kind: "invoices" });
		expect(rowKindOf("Net")).toEqual({ kind: "net" });
		expect(rowKindOf("average ticket")).toEqual({ kind: "averageTicket" });
		expect(rowKindOf("7h revenue")).toEqual({ kind: "hourNet", hour: 7 });
		expect(rowKindOf("19–21h share of net")).toEqual({
			kind: "hourShare",
			from: 19,
			to: 21,
		});
		expect(rowKindOf("fri-sun share")).toEqual({ kind: "weekendShare" });
		expect(rowKindOf("Sunday net")).toEqual({ kind: "sundayNet" });
		expect(rowKindOf("Payment mix")).toEqual({ kind: "paymentMix" });
		expect(rowKindOf("Net per seat")).toEqual({ kind: "skipped" });
	});

	it("refuses an impossible hour or a span that runs backwards", () => {
		expectSheetError(() => rowKindOf("25h revenue"), /hour/);
		expectSheetError(() => rowKindOf("21–19h share of net"), /backwards/);
	});

	it("reads a payment mix and refuses an item without a label or a share", () => {
		expect(parsePaymentMix("Cash 40 % · QR Wallet ≈ 25 %")).toEqual<
			PaymentShare[]
		>([
			{ label: "Cash", share: parseSheetValue("40 %") },
			{ label: "QR Wallet", share: parseSheetValue("25 %") },
		]);
		expectSheetError(() => parsePaymentMix("40 %"), /payment share/);
		expectSheetError(() => parsePaymentMix("Cash · Transfer 10 %"), /payment/);
	});
});

describe("the synthetic reference sheet", () => {
	const sheet = parseReferenceSheet(SHEET);

	it("reads the window, the store columns and the hourly pointer of the reference section only", () => {
		expect(sheet.window).toEqual({ from: "2026-12-20", to: "2027-01-18" });
		expect(sheet.columns).toEqual(["Lotus", "Harbour"]);
		expect(sheet.hourlyFile).toBe("hourly.md");
		expect(sheet.rows.map((row) => row.form)).toEqual([
			"value",
			"value",
			"value",
			"value",
			"value",
			"value",
			"value",
			"payment",
			"skipped",
			"skipped",
		]);
		expect(value(sheet, 2, 1)).toEqual(parseSheetValue("40.0 M₫"));
	});

	it("matches every store column to exactly one store, in either direction of the names", () => {
		expect(sheet.columns.map((column) => storeFor(column, STORES))).toEqual([
			LOTUS,
			HARBOUR,
		]);
		expect(storeFor("harbour coffee riverside", STORES)).toBe(HARBOUR);
		expectSheetError(() => storeFor("Ocean", STORES), /matches 0 stores/);
		expectSheetError(
			() => storeFor("Lotus", [...STORES, { id: "x", name: "Lotus Garden" }]),
			/matches 2 stores/,
		);
	});

	it("agrees with facts built to the sheet, store by store", () => {
		for (const [column, storeId] of [LOTUS, HARBOUR].entries()) {
			const { facts, identities } = factsFor(storeId);
			expect(identities).toEqual({
				totalsAgree: true,
				heatmapAgrees: true,
				paymentSharesSumToOne: true,
			});
			for (const row of sheet.rows) {
				if (row.form === "value") {
					expect(
						within(rowValue(row.kind, facts), row.cells[column] as SheetValue),
						`row ${row.index} column ${column + 1}`,
					).toBe(true);
				}
				if (row.form === "payment") {
					for (const share of row.cells[column] ?? []) {
						expect(
							within(
								paymentInvoiceShareOf(facts.payments, share.label),
								share.share,
							),
						).toBe(true);
					}
				}
			}
		}
	});

	it("fails without its section, a store column, a cell or one of the compared rows", () => {
		expectSheetError(
			() => parseReferenceSheet(SHEET.replace("reference window", "window")),
			/section is missing/,
		);
		expectSheetError(
			() =>
				parseReferenceSheet(
					SHEET.replace("| Invoices | 1,000 | 800 |", "| Invoices | 1,000 |"),
				),
			/row 1 has a missing column/,
		);
		expectSheetError(
			() => parseReferenceSheet(SHEET.replace("| 50.0 M₫ |", "|  |")),
			/row 2 has a missing column/,
		);
		expectSheetError(
			() =>
				parseReferenceSheet(
					SHEET.replace("| Metric | Lotus | Harbour |", "| Metric | Lotus | |"),
				),
			/empty store column/,
		);
		expectSheetError(
			() => parseReferenceSheet(SHEET.replace("| Metric |", "| Measure |")),
			/Metric column/,
		);
		const onlySkipped = [
			"## Reference window 1 Mar – 2 Mar 2026",
			"",
			"| Metric | Lotus |",
			"|---|---|",
			"| Table names | 3 |",
		].join("\n");
		expectSheetError(
			() => parseReferenceSheet(onlySkipped),
			/no invoices, net, averageTicket, hourNet, hourShare, weekendShare, sundayNet, paymentMix row/,
		);
		expectSheetError(
			() =>
				parseReferenceSheet(
					SHEET.replace("| Payment mix |", "| Payment mix (bills) |"),
				),
			/^the table has no paymentMix row$/,
		);
		expectSheetError(
			() => parseReferenceSheet(SHEET.replace("| 8–9h share", "| 8—9h share")),
			/^the table has no hourShare row$/,
		);
		expectSheetError(
			() =>
				parseReferenceSheet(
					SHEET.replace("50,000 ₫ | 50,000 ₫", "50,000 ₫ | about fifty"),
				),
			/cannot be read/,
		);
	});

	it("refuses a value whose form does not fit its row and lets a skipped row lack cells", () => {
		expectSheetError(
			() => parseReferenceSheet(SHEET.replace("| ≈ 60 % |", "| 0 |")),
			/row 5 holds a value of the wrong form/,
		);
		expectSheetError(
			() =>
				parseReferenceSheet(
					SHEET.replace("| 1,000 | 800 |", "| 1.0 M₫ | 800 |"),
				),
			/row 1 holds a value of the wrong form/,
		);
		const shortSkipped = parseReferenceSheet(
			SHEET.replace("| Table names | 20 | 25 |", "| Table names |"),
		);
		expect(shortSkipped.rows.at(-1)).toEqual({ index: 10, form: "skipped" });
	});

	it("finds the hourly file only in the sheet's own folder", () => {
		expect(siblingPath("/owner/private/sheet.md", "hourly.md")).toBe(
			"/owner/private/hourly.md",
		);
		for (const name of ["../hourly.md", "other/hourly.md", "", ".."]) {
			expectSheetError(
				() => siblingPath("/owner/private/sheet.md", name),
				/folder/,
			);
		}
	});
});

describe("the hourly reference", () => {
	const hourly = parseHourlyReference(HOURLY);

	it("reads every hour and weekday per store, bold marks included", () => {
		expect(hourly.hours.map((series) => series.name)).toEqual([
			"Lotus",
			"Harbour",
		]);
		expect([...(hourly.hours[0]?.values.keys() ?? [])]).toEqual([8, 9, 10, 20]);
		expect(hourly.hours[0]?.values.get(9)).toEqual(parseSheetValue("20.0 M₫"));
		expect(hourly.weekdays.map((series) => series.name)).toEqual([
			"Lotus",
			"Harbour",
		]);
		expect(hourly.weekdays[1]?.values.get(7)).toEqual(
			parseSheetValue("6.0 M₫"),
		);
		expect(hourly.weekdays[1]?.values.size).toBe(7);
	});

	it("agrees with the same facts the reference section agrees with", () => {
		for (const series of hourly.hours) {
			const { facts } = factsFor(storeFor(series.name, STORES));
			for (const [hour, expected] of series.values) {
				expect(within(facts.hourNet.get(hour) ?? 0, expected)).toBe(true);
			}
		}
		for (const series of hourly.weekdays) {
			const { facts } = factsFor(storeFor(series.name, STORES));
			for (const [day, expected] of series.values) {
				expect(within(facts.weekdayNet.get(day) ?? 0, expected)).toBe(true);
			}
		}
	});

	it("fails without its table, its weekday line or an hour of a row", () => {
		expectSheetError(
			() => parseHourlyReference(HOURLY.replace("| Hour |", "| Time |")),
			/hourly table is missing/,
		);
		expectSheetError(
			() => parseHourlyReference(HOURLY.replace("Weekday net", "Day net")),
			/weekday line is missing/,
		);
		expectSheetError(
			() => parseHourlyReference(HOURLY.replace("| 12.0 | 8.0 |", "| 12.0 |")),
			/missing hour/,
		);
		expectSheetError(
			() => parseHourlyReference(HOURLY.replace("Tue 6.0", "Tue six")),
			/weekday value cannot be read/,
		);
	});
});

describe("the menu checks", () => {
	const menu = parseMenuChecks(SHEET);

	it("reads the store, the seven days, the top sellers and the modifier shares", () => {
		expect(menu?.store).toBe("Harbour");
		expect(menu?.window).toEqual({ from: "2027-01-12", to: "2027-01-18" });
		expect(menu?.topSellers.map((seller) => seller.name)).toEqual([
			"Lemon Tea (L)",
			"Trà đào (L)",
			"Peach Soda (snack)",
		]);
		expect(menu?.topSellers[0]?.net).toEqual(parseSheetValue("1.20 M₫"));
		expect(menu?.modifierDate).toBe("2027-01-15");
		expect(menu?.modifierShares).toEqual([
			{
				name: "Lotus",
				modifierLines: parseSheetValue("12"),
				lines: parseSheetValue("340"),
			},
			{
				name: "Harbour",
				modifierLines: parseSheetValue("30"),
				lines: parseSheetValue("400"),
			},
		]);
	});

	it("is absent without its section and fails on an unreadable seller", () => {
		expect(parseMenuChecks(SHEET.replace("Menu checks", "Menu notes"))).toBe(
			null,
		);
		expectSheetError(
			() => parseMenuChecks(SHEET.replace("40 / 1.20 M₫", "forty / 1.20 M₫")),
			/top seller/,
		);
		expectSheetError(
			() => parseMenuChecks(SHEET.replace("7 days to", "a week to")),
			/scope/,
		);
		expectSheetError(
			() =>
				parseMenuChecks(
					SHEET.replace(
						"Lotus 12 of 340 (3.5 %), Harbour 30 of 400 (7.5 %)",
						"none recorded",
					),
				),
			/modifier share names no store/,
		);
	});

	it("finds a seller by its exact name, then without tone marks, then without a trailing note", () => {
		const items = [
			itemRow("Lemon Tea (L)", "Lemon Tea", "L", 40, 1_200_000),
			itemRow("Lemon Tea (M)", "Lemon Tea", "M", 12, 300_000),
			itemRow("Trà Đáo ( L ) ", "Trà Đáo", "L", 25, 1_000_000),
			itemRow("Peach Soda", null, null, 10, 300_000),
		];
		expect(sellerRows(items, "Lemon Tea (L)")).toEqual([items[0]]);
		expect(sellerRows(items, "Trà đào (L)")).toEqual([items[2]]);
		expect(sellerRows(items, "Peach Soda (snack)")).toEqual([items[3]]);
		expect(sellerRows(items, "Mango Soda")).toEqual([]);
	});
});

describe("the comparison helpers", () => {
	it("computes each row's value from the window facts", () => {
		const { facts } = factsFor(LOTUS);
		const kinds: [ValueRowKind, number][] = [
			[{ kind: "invoices" }, 1_000],
			[{ kind: "net" }, 50e6],
			[{ kind: "averageTicket" }, 50_000],
			[{ kind: "hourNet", hour: 20 }, 15e6],
			[{ kind: "hourNet", hour: 3 }, 0],
			[{ kind: "hourShare", from: 8, to: 10 }, 0.7],
			[{ kind: "weekendShare" }, 0.5],
			[{ kind: "sundayNet" }, 9e6],
		];
		for (const [kind, expected] of kinds) {
			expect(rowValue(kind, facts), kind.kind).toBeCloseTo(expected, 6);
		}
	});

	it("flags facts whose sources disagree", () => {
		const { identities } = windowFactsOf({
			profile: [
				profileRow("all", null, 8, 1, 100),
				profileRow("all", null, null, 2, 100),
				profileRow("weekday", 1, null, 2, 100),
			],
			heatmap: [heatmapRow(1, 8, 90)],
			totals: totalsRow(3, 100),
			payments: [paymentRow("Cash", "cash", 2, 0.9)],
		});
		expect(identities).toEqual({
			totalsAgree: false,
			heatmapAgrees: false,
			paymentSharesSumToOne: false,
		});
	});

	it("reads cash and transfer as kinds and any other label as a part of the method's name", () => {
		const payments = [
			paymentRow("Tiền mặt", "cash", 5, 0.5),
			paymentRow("Chuyển khoản", "bank_transfer", 3, 0.3),
			paymentRow("VÍ QR MỘT", "ewallet", 1, 0.1),
			paymentRow("Ví QR Hai", "ewallet", 1, 0.1),
		];
		expect(paymentRowsFor(payments, "Cash")).toHaveLength(1);
		expect(paymentRowsFor(payments, "transfer")).toHaveLength(1);
		expect(paymentRowsFor(payments, "ví qr")).toHaveLength(2);
		expect(paymentInvoiceShareOf(payments, "Ví QR")).toBeCloseTo(0.2, 9);
		expect(paymentInvoiceShareOf([], "cash")).toBe(null);
		expect(paymentInvoiceShareOf(payments, "Card")).toBe(null);
	});

	it("tiles a long window into chunks that the 92-day functions accept", () => {
		const year = { from: "2025-11-16", to: "2026-11-15" };
		const chunks = chunksOf(year, 91);
		expect(chunks).toHaveLength(5);
		expect(chunks[0]).toEqual({ from: "2025-11-16", to: "2026-02-14" });
		expect(chunks.at(-1)).toEqual({ from: "2026-11-15", to: "2026-11-15" });
		expect(sum(chunks.map(windowDays))).toBe(windowDays(year));
		expect(windowDays(year)).toBe(365);
	});
});
