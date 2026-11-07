import { ConnectorCapabilityError, collectSales } from "@fnb/connector-core";
import {
	businessDate,
	type CanonicalSale,
	type DataQualityFlag,
	isoDatesBetween,
	zonedInstant,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	createIposConnector,
	FLAG_CODES,
	type IposConnectorOptions,
	LOGIN_PATH,
} from "../../src/index.js";
import {
	envelope,
	errorEnvelope,
	fakeUuid,
	makeLoginPayload,
	makeLoginStore,
	STORE_UID,
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
const TYPE_FRUIT_TEA = fakeUuid(701);
const TYPE_MATCHA = fakeUuid(702);
const TYPE_FREE_TOPPING = fakeUuid(703);
const TYPE_UNCATEGORY = fakeUuid(704);

const itemTypes: Row[] = [
	{ id: TYPE_FRUIT_TEA, item_type_id: "T01", item_type_name: "Trà trái cây" },
	{ id: TYPE_MATCHA, item_type_id: "T02", item_type_name: "Matcha" },
	{
		id: TYPE_FREE_TOPPING,
		item_type_id: "T03",
		item_type_name: "Topping tặng",
	},
	{ id: TYPE_UNCATEGORY, item_type_id: "TUN", item_type_name: "Uncategory" },
];

let itemUuidSequence = 800;

function item(code: string, name: string, typeUid: string, price: number): Row {
	itemUuidSequence += 1;
	return {
		id: fakeUuid(itemUuidSequence),
		item_id: code,
		item_name: name,
		ots_price: price,
		ta_price: price,
		cost_price: 0,
		active: 1,
		deleted: false,
		item_type_uid: typeUid,
		item_class_uid: null,
		unit_uid: null,
		store_uid: STORE_UID,
	};
}

const items: Row[] = [
	item("TBH-L", "Trà bưởi hồng (L)", TYPE_FRUIT_TEA, 55_000),
	item("ML", "Matcha Latte", TYPE_MATCHA, 50_000),
	item("MCCL-M", "Mãng Cầu Chanh Leo ( M )", TYPE_FRUIT_TEA, 50_000),
	item("DA50", "50% Đá", TYPE_UNCATEGORY, 0),
	item("DA50B", "50% Đá", TYPE_UNCATEGORY, 0),
	item("TOP-FREE", "Thạch tặng kèm", TYPE_FREE_TOPPING, 0),
	item("TP-TC", "Trân châu đen", TYPE_UNCATEGORY, 8_000),
];

const customizations: Row[] = [
	{
		id: fakeUuid(900),
		name: "Tuỳ chọn",
		active: 1,
		list_item: ["TBH-L", "ML", "MCCL-M"],
		data: {
			LstItem_Options: [
				{
					Name: "Đá",
					LstItem_Id: ["DA50"],
					Max_Permitted: 1,
					Min_Permitted: 0,
				},
				{
					Name: "Topping",
					LstItem_Id: ["TP-TC"],
					Max_Permitted: 3,
					Min_Permitted: 0,
				},
			],
		},
	},
];

const paymentMethods: Row[] = [
	{
		id: fakeUuid(910),
		payment_method_id: "PM-MOMO",
		payment_method_name: "Momo QR đa năng",
	},
	{
		id: fakeUuid(911),
		payment_method_id: "PM-CASH",
		payment_method_name: "Tiền mặt",
	},
	{
		id: fakeUuid(912),
		payment_method_id: "PM-TR",
		payment_method_name: "TRANSFER",
	},
	{
		id: fakeUuid(913),
		payment_method_id: "PM-X",
		payment_method_name: "Thanh toán khác",
	},
];

const sources: Row[] = [
	{
		id: fakeUuid(920),
		source_id: "SRC-OTS",
		source_name: "TẠI CHỖ",
		source_type: ["delivery"],
	},
	{
		id: fakeUuid(921),
		source_id: "SRC-GRAB",
		source_name: "ĐỐI TÁC GIAO HÀNG",
		source_type: ["delivery"],
	},
];

const LOCAL_0900 = Date.UTC(2026, 10, 7, 2, 0);
const LOCAL_2330 = Date.UTC(2026, 10, 7, 16, 30);
const LOCAL_0030_NEXT = Date.UTC(2026, 10, 7, 17, 30);
const LOCAL_0005_NEXT = Date.UTC(2026, 10, 7, 17, 5);

function invoice(tranId: string, tranDate: number, overrides: Row = {}): Row {
	return {
		tran_id: tranId,
		tran_no: `NO-${tranId}`,
		tran_date: tranDate,
		start_hour: 9,
		start_minute: 0,
		end_hour: 9,
		end_minute: 2,
		table_name: "THẺ 1",
		area_name: "Tầng 1",
		sale_type: "OTS",
		source_id: "SRC-OTS",
		source_name: "TẠI CHỖ",
		shift_id: "SHIFT-1",
		store_uid: STORE_UID,
		employee_id: "E-01",
		employee_name: "Thu ngân",
		customer_name: "",
		customer_phone: "",
		peo_count: 0,
		payment_method_id: "PM-MOMO",
		payment_method_name: "Momo QR đa năng",
		total_amount: 55_000,
		amount_origin: 55_000,
		amount_discount_detail: 0,
		amount_discount_price: 0,
		discount_extra_amount: 0,
		discount_extra_name: null,
		voucher_code: null,
		voucher_name: null,
		voucher_amount_paid: 0,
		vat_amount: 0,
		ship_fee_amount: 0,
		service_charge_amount: 0,
		commission_amount: 0,
		partner_marketing_amount: 0,
		...overrides,
	};
}

function line(
	tranId: string,
	tranDate: number,
	id: string,
	itemCode: string,
	itemName: string,
	price: number,
	overrides: Row = {},
): Row {
	return {
		tran_id: tranId,
		tran_no: `NO-${tranId}`,
		tran_date: tranDate,
		store_uid: STORE_UID,
		id,
		sale_id: fakeUuid(950),
		item_id: itemCode,
		item_name: itemName,
		item_type_id: "T01",
		item_type_name: "Trà trái cây",
		unit_id: null,
		quantity: 1,
		price,
		ots_price: price,
		amount: price,
		discount_amount: 0,
		amount_discount_on_price: 0,
		promotion_id: null,
		promotion_name: null,
		item_note: null,
		package_id: null,
		sale_detail_type: 0,
		...overrides,
	};
}

function payment(
	tranId: string,
	tranDate: number,
	methodId: string,
	methodName: string,
	amount: number,
): Row {
	return {
		tran_id: tranId,
		tran_no: `NO-${tranId}`,
		tran_date: tranDate,
		store_uid: STORE_UID,
		payment_method_id: methodId,
		payment_method_name: methodName,
		amount,
		total_amount: amount,
		payment_fee_amount: 0,
		trace_no: methodId === "PM-TR" ? "FT-0001" : null,
		tran_id_of_partner: null,
	};
}

const LINE_1_UUID = fakeUuid(1001);
const LINE_7_UUID = fakeUuid(1007);

const invoices: Row[] = [
	invoice("INV-1", LOCAL_0900),
	invoice("INV-1", LOCAL_0900),
	invoice("INV-2", LOCAL_2330, {
		sale_type: "TA",
		total_amount: 100_000,
		amount_origin: 100_000,
		payment_method_id: "PM-CASH",
		payment_method_name: "Tiền mặt",
		start_hour: 23,
		start_minute: 28,
		end_hour: 23,
		end_minute: 30,
	}),
	invoice("INV-3", LOCAL_0030_NEXT, {
		total_amount: 50_000,
		amount_origin: 50_000,
		start_hour: 0,
		start_minute: 29,
		end_hour: 0,
		end_minute: 30,
	}),
	invoice("INV-4", LOCAL_0900 + 60_000, {
		total_amount: 105_000,
		amount_origin: 105_000,
	}),
	invoice("INV-5", LOCAL_0900 + 120_000, {
		total_amount: 20_000,
		amount_origin: 50_000,
		amount_discount_detail: 5_000,
		amount_discount_price: 50_000,
		discount_extra_amount: 10_000,
		discount_extra_name: "Giảm giá hoá đơn",
		voucher_code: "VC-20",
		voucher_name: "Voucher 20k",
		voucher_amount_paid: 20_000,
	}),
	invoice("INV-6", LOCAL_0900 + 180_000, {
		sale_type: "TA",
		source_id: "SRC-GRAB",
		source_name: "ĐỐI TÁC GIAO HÀNG",
		total_amount: 50_000,
		amount_origin: 50_000,
		ship_fee_amount: 0,
		payment_method_id: "PM-X",
		payment_method_name: "Thanh toán khác",
	}),
	invoice("INV-7", LOCAL_0900 + 240_000, {
		sale_type: "XX",
		total_amount: 58_000,
		amount_origin: 58_000,
	}),
	invoice("INV-8", LOCAL_0900 + 300_000, {
		total_amount: 50_000,
		amount_origin: 50_000,
	}),
	invoice("INV-9", LOCAL_0900 + 360_000, {
		total_amount: 50_000,
		amount_origin: 50_000,
	}),
	invoice("INV-10", LOCAL_0900 + 420_000, {
		total_amount: 30_000,
		amount_origin: 30_000,
	}),
	invoice("INV-11", LOCAL_0900 + 480_000, {
		total_amount: 50_000,
		amount_origin: 50_000,
	}),
	invoice("INV-12", LOCAL_0005_NEXT, {
		total_amount: 50_000,
		amount_origin: 50_000,
		start_hour: 23,
		start_minute: 50,
		end_hour: 0,
		end_minute: 5,
	}),
];

const lines: Row[] = [
	line("INV-1", LOCAL_0900, LINE_1_UUID, "TBH-L", "Trà bưởi hồng (L)", 55_000, {
		item_type_id: TYPE_FRUIT_TEA,
		item_type_name: "",
		index: 0,
	}),
	line("INV-1", LOCAL_0900, fakeUuid(1002), "DA50", "50% Đá", 0, {
		item_type_id: "TUN",
		item_type_name: "UnCategory",
		index: 1,
	}),
	line("INV-1", LOCAL_0900, fakeUuid(1003), "TOP-FREE", "Thạch tặng kèm", 0, {
		item_type_id: "T03",
		item_type_name: "Topping tặng",
		index: 2,
	}),
	line("INV-2", LOCAL_2330, fakeUuid(1004), "ML", "Matcha Latte", 50_000, {
		item_type_id: "T02",
		item_type_name: "Matcha",
		index: 0,
	}),
	line(
		"INV-2",
		LOCAL_2330,
		fakeUuid(1005),
		"MCCL-M",
		"Mãng Cầu Chanh Leo ( M )",
		50_000,
		{
			index: 1,
		},
	),
	line("INV-3", LOCAL_0030_NEXT, fakeUuid(1006), "ML", "Matcha Latte", 50_000, {
		item_type_id: "T02",
		item_type_name: "Matcha",
	}),
	line(
		"INV-4",
		LOCAL_0900 + 60_000,
		fakeUuid(1011),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
		},
	),
	line(
		"INV-4",
		LOCAL_0900 + 60_000,
		fakeUuid(1012),
		"TBH-L",
		"Trà bưởi hồng (L)",
		55_000,
	),
	line(
		"INV-5",
		LOCAL_0900 + 120_000,
		fakeUuid(1021),
		"TBH-L",
		"Trà bưởi hồng (L)",
		55_000,
		{
			amount: 50_000,
			discount_amount: 5_000,
		},
	),
	line("INV-5", LOCAL_0900 + 120_000, fakeUuid(1022), "ML", "Matcha Latte", 0, {
		item_type_id: "T02",
		item_type_name: "Matcha",
		ots_price: 50_000,
		amount: 0,
		amount_discount_on_price: 50_000,
		promotion_id: "PR-B1G1",
		promotion_name: "Mua 1 tặng 1",
	}),
	line(
		"INV-6",
		LOCAL_0900 + 180_000,
		fakeUuid(1031),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
		},
	),
	line(
		"INV-7",
		LOCAL_0900 + 240_000,
		LINE_7_UUID,
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
			index: 0,
		},
	),
	line(
		"INV-7",
		LOCAL_0900 + 240_000,
		`${LINE_7_UUID}_INV7_SDTOP_x_1_TP-TC_t1`,
		"TP-TC",
		"Trân châu đen",
		8_000,
		{ item_type_id: "TUN", item_type_name: "UnCategory", index: 1 },
	),
	line("INV-8", LOCAL_0900 + 300_000, fakeUuid(1041), "DA50", "50% Đá", 0, {
		item_type_id: "TUN",
		item_type_name: "UnCategory",
		index: 0,
	}),
	line(
		"INV-8",
		LOCAL_0900 + 300_000,
		fakeUuid(1042),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
			index: 1,
		},
	),
	line(
		"INV-9",
		LOCAL_0900 + 360_000,
		fakeUuid(1051),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
		},
	),
	line(
		"INV-10",
		LOCAL_0900 + 420_000,
		fakeUuid(1061),
		"GHOST",
		"Món đã xoá",
		30_000,
		{
			item_type_id: "TUN",
			item_type_name: "UnCategory",
		},
	),
	line(
		"INV-11",
		LOCAL_0900 + 480_000,
		fakeUuid(1071),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
			index: 0,
		},
	),
	line("INV-11", LOCAL_0900 + 480_000, fakeUuid(1072), "DA50B", "50% Đá", 0, {
		item_type_id: "TUN",
		item_type_name: "UnCategory",
		index: 1,
	}),
	line(
		"INV-12",
		LOCAL_0005_NEXT,
		fakeUuid(1081),
		"ML",
		"Matcha Latte",
		50_000,
		{
			item_type_id: "T02",
			item_type_name: "Matcha",
		},
	),
];

const payments: Row[] = [
	payment("INV-1", LOCAL_0900, "PM-MOMO", "Momo QR đa năng", 55_000),
	payment("INV-2", LOCAL_2330, "PM-CASH", "Tiền mặt", 100_000),
	payment("INV-3", LOCAL_0030_NEXT, "PM-MOMO", "Momo QR đa năng", 50_000),
	payment("INV-4", LOCAL_0900 + 60_000, "PM-CASH", "Tiền mặt", 50_000),
	payment("INV-4", LOCAL_0900 + 60_000, "PM-TR", "TRANSFER", 55_000),
	payment("INV-5", LOCAL_0900 + 120_000, "PM-MOMO", "Momo QR đa năng", 20_000),
	payment("INV-6", LOCAL_0900 + 180_000, "PM-X", "Thanh toán khác", 50_000),
	payment("INV-7", LOCAL_0900 + 240_000, "PM-MOMO", "Momo QR đa năng", 58_000),
	payment("INV-8", LOCAL_0900 + 300_000, "PM-MOMO", "Momo QR đa năng", 50_000),
	payment("INV-9", LOCAL_0900 + 360_000, "PM-MOMO", "Momo QR đa năng", 10_000),
	payment("INV-10", LOCAL_0900 + 420_000, "PM-MOMO", "Momo QR đa năng", 30_000),
	payment("INV-11", LOCAL_0900 + 480_000, "PM-MOMO", "Momo QR đa năng", 50_000),
	payment("INV-12", LOCAL_0005_NEXT, "PM-MOMO", "Momo QR đa năng", 50_000),
];

function queryNumber(request: RecordedRequest, name: string): number | null {
	const value = request.url.searchParams.get(name);
	return value === null ? null : Number(value);
}

function withinRange(rows: Row[], request: RecordedRequest): Row[] {
	const start = queryNumber(request, "start_date") ?? Number.NEGATIVE_INFINITY;
	const end = queryNumber(request, "end_date") ?? Number.POSITIVE_INFINITY;
	return rows.filter((row) => {
		const date = Number(row.tran_date);
		return date >= start && date <= end;
	});
}

function uniqueInvoices(): Row[] {
	const seen = new Set<string>();
	return invoices.filter((row) => {
		const id = String(row.tran_id);
		if (seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
}

function daysView(request: RecordedRequest) {
	const openAt = queryNumber(request, "store_open_at") ?? 0;
	const start = queryNumber(request, "start_date");
	const end = queryNumber(request, "end_date");
	if (
		!Number.isInteger(openAt) ||
		openAt < 0 ||
		openAt > 23 ||
		!start ||
		!end
	) {
		return jsonResponse(errorEnvelope(400, "Truyền thiếu dữ liệu"), 400);
	}
	const rows = isoDatesBetween(
		businessDate(new Date(start), TIMEZONE, 0),
		businessDate(new Date(end), TIMEZONE, 0),
	).map((date) => {
		const inDay = uniqueInvoices().filter(
			(row) =>
				businessDate(new Date(Number(row.tran_date)), TIMEZONE, openAt * 60) ===
				date,
		);
		const net = inDay.reduce((sum, row) => sum + Number(row.total_amount), 0);
		return {
			date,
			tran_date: zonedInstant(date, 0, TIMEZONE).getTime(),
			total_sales: inDay.length,
			revenue_gross: net,
			revenue_net: net,
		};
	});
	return jsonResponse(
		envelope({
			total_sales: rows.reduce((sum, row) => sum + row.total_sales, 0),
			revenue_gross: 0,
			revenue_net: 0,
			list_data: rows,
		}),
	);
}

function responder(loginOpenAt = 0) {
	const login = makeLoginPayload();
	login.stores = [makeLoginStore({ open_at: loginOpenAt })];
	return routeByPath({
		[LOGIN_PATH]: () => jsonResponse(envelope(login)),
		"/api/mdata/v1/stores": () => jsonResponse(envelope([])),
		"/api/mdata/v1/items": () => jsonResponse(envelope(items)),
		"/api/mdata/v1/item-types": () => jsonResponse(envelope(itemTypes)),
		"/api/mdata/v1/item-classes": () => jsonResponse(envelope([])),
		"/api/mdata/v1/units": () => jsonResponse(envelope([])),
		"/api/mdata/v1/customizations": () =>
			jsonResponse(envelope(customizations)),
		"/api/mdata/v1/sources": () => jsonResponse(envelope(sources)),
		"/api/mdata/v1/payment-methods": () =>
			jsonResponse(envelope(paymentMethods)),
		"/api/mdata/v1/promotions": () => jsonResponse(envelope([])),
		"/api/mdata/v1/packages": () => jsonResponse(envelope([])),
		"/api/v1/accounting/report/sale": (request) =>
			jsonResponse(
				envelope(withinRange(invoices, request), { next_cursor: null }),
			),
		"/api/v1/accounting/report/sale-detail": (request) =>
			jsonResponse(
				envelope(withinRange(lines, request), { next_cursor: null }),
			),
		"/api/v1/accounting/report/payment-method": (request) =>
			jsonResponse(
				envelope(withinRange(payments, request), { next_cursor: null }),
			),
		"/api/v3/reports/sale-summary/days": daysView,
	});
}

interface Harness {
	sales: Map<string, CanonicalSale>;
	flags: DataQualityFlag[];
}

async function run(
	window: { fromDate: string; toDate: string },
	options: IposConnectorOptions = {},
): Promise<Harness> {
	const flags: DataQualityFlag[] = [];
	const connector = createIposConnector({
		fetch: createFakeFetch(responder()).fetch,
		deliverySources: ["ĐỐI TÁC GIAO HÀNG"],
		onFlag: (flag) => flags.push(flag),
		...options,
	});
	await connector.authenticate(TEST_CREDENTIALS);
	const [store] = await connector.discoverStores();
	if (!store) {
		throw new Error("login payload had no store");
	}
	const sales = await collectSales(connector.fetchSales(store, window));
	return {
		sales: new Map(sales.map((sale) => [sale.externalId, sale])),
		flags,
	};
}

async function connect(
	loginOpenAt: number,
	options: IposConnectorOptions = {},
) {
	const fake = createFakeFetch(responder(loginOpenAt));
	const connector = createIposConnector({ fetch: fake.fetch, ...options });
	await connector.authenticate(TEST_CREDENTIALS);
	const [store] = await connector.discoverStores();
	if (!store) {
		throw new Error("login payload had no store");
	}
	return { connector, store, fake };
}

const DAY = { fromDate: "2026-11-07", toDate: "2026-11-08" };

function sale(harness: Harness, id: string): CanonicalSale {
	const found = harness.sales.get(id);
	if (!found) {
		throw new Error(`sale ${id} was not emitted`);
	}
	return found;
}

describe("iPOS adapter golden cases", () => {
	it("turns a 50% Đá line into a modifier attached to the preceding item line", async () => {
		const harness = await run(DAY);
		const lines = sale(harness, "INV-1").lines;
		const modifier = lines.find((line) => line.itemName === "50% Đá");
		expect(modifier?.lineKind).toBe("modifier");
		expect(modifier?.parentLineExternalId).toBe(LINE_1_UUID);
		expect(modifier?.netAmount).toBe(0);
	});

	it("recognises a modifier by its option name when the item id is not listed in the customisation", async () => {
		const harness = await run(DAY);
		const [matcha, byName] = sale(harness, "INV-11").lines;
		expect(byName?.itemExternalId).toBe("DA50B");
		expect(byName?.lineKind).toBe("modifier");
		expect(byName?.parentLineExternalId).toBe(matcha?.externalId);
	});

	it("keeps a free topping that exists in the item master as an item", async () => {
		const harness = await run(DAY);
		const topping = sale(harness, "INV-1").lines.find(
			(line) => line.itemName === "Thạch tặng kèm",
		);
		expect(topping?.lineKind).toBe("item");
		expect(topping?.netAmount).toBe(0);
		expect(topping?.itemTypeName).toBe("Topping tặng");
	});

	it("parses sizes from item names", async () => {
		const harness = await run(DAY);
		const tbh = sale(harness, "INV-1").lines[0];
		expect(tbh).toMatchObject({ baseName: "Trà bưởi hồng", sizeLabel: "L" });
		const [matcha, mangCau] = sale(harness, "INV-2").lines;
		expect(matcha).toMatchObject({
			baseName: "Matcha Latte",
			sizeLabel: undefined,
		});
		expect(mangCau).toMatchObject({
			baseName: "Mãng Cầu Chanh Leo",
			sizeLabel: "M",
		});
	});

	it("resolves a UUID-only item type through the item types list", async () => {
		const harness = await run(DAY);
		const tbh = sale(harness, "INV-1").lines[0];
		expect(tbh?.itemTypeName).toBe("Trà trái cây");
		expect(tbh?.itemTypeExternalId).toBe("T01");
	});

	it("keeps 23:30 local on its business date and moves 00:30 with a 05:00 day start", async () => {
		const midnightStart = await run(DAY);
		expect(sale(midnightStart, "INV-2").businessDate).toBe("2026-11-07");
		expect(sale(midnightStart, "INV-2").closedAt?.toISOString()).toBe(
			"2026-11-07T16:30:00.000Z",
		);
		expect(sale(midnightStart, "INV-3").businessDate).toBe("2026-11-08");

		const lateStart = await run(
			{ fromDate: "2026-11-07", toDate: "2026-11-07" },
			{ dayStartMinutes: 5 * 60 },
		);
		expect(sale(lateStart, "INV-3").businessDate).toBe("2026-11-07");
		expect(sale(lateStart, "INV-3").closedAt?.toISOString()).toBe(
			"2026-11-07T17:30:00.000Z",
		);
	});

	it("rolls openedAt back a day for a bill opened before midnight and paid after it", async () => {
		const harness = await run(DAY);
		const overnight = sale(harness, "INV-12");
		expect(overnight.businessDate).toBe("2026-11-08");
		expect(overnight.openedAt?.toISOString()).toBe("2026-11-07T16:50:00.000Z");
		expect(overnight.closedAt?.toISOString()).toBe("2026-11-07T17:05:00.000Z");
		expect(overnight.openedAt?.getTime()).toBeLessThan(
			overnight.closedAt?.getTime() ?? 0,
		);
	});

	it("turns a split bill into one sale with two payments", async () => {
		const harness = await run(DAY);
		const split = sale(harness, "INV-4");
		expect(split.payments).toHaveLength(2);
		expect(split.payments.map((payment) => payment.kind)).toEqual([
			"cash",
			"bank_transfer",
		]);
		expect(split.payments[1]?.referenceNo).toBe("FT-0001");
		expect(split.paidAmount).toBe(105_000);
		expect(harness.sales.size).toBe(12);
	});

	it("maps channels and payment kinds, honouring per-tenant overrides", async () => {
		const harness = await run(DAY);
		expect(sale(harness, "INV-1").channel).toBe("dine_in");
		expect(sale(harness, "INV-2").channel).toBe("take_away");
		expect(sale(harness, "INV-6").channel).toBe("delivery");
		expect(sale(harness, "INV-7").channel).toBe("other");
		expect(sale(harness, "INV-1").payments[0]?.kind).toBe("ewallet");
		expect(sale(harness, "INV-2").payments[0]?.kind).toBe("cash");
		expect(sale(harness, "INV-6").payments[0]?.kind).toBe("other");

		const overridden = await run(DAY, {
			paymentKindOverrides: { "Thanh toán khác": "voucher" },
		});
		expect(sale(overridden, "INV-6").payments[0]?.kind).toBe("voucher");
	});

	it("decomposes discounts on a voucher invoice so the identity holds", async () => {
		const harness = await run(DAY);
		const voucher = sale(harness, "INV-5");
		expect(voucher).toMatchObject({
			grossAmount: 105_000,
			itemDiscountAmount: 55_000,
			billDiscountAmount: 10_000,
			billDiscountName: "Giảm giá hoá đơn",
			voucherCode: "VC-20",
			voucherName: "Voucher 20k",
			voucherAmount: 20_000,
			netAmount: 20_000,
			paidAmount: 20_000,
		});
		expect(
			voucher.grossAmount -
				voucher.itemDiscountAmount -
				voucher.billDiscountAmount -
				voucher.voucherAmount,
		).toBe(voucher.netAmount);
		const free = voucher.lines.find((line) => line.itemName === "Matcha Latte");
		expect(free).toMatchObject({
			lineKind: "item",
			grossAmount: 50_000,
			discountAmount: 50_000,
			netAmount: 0,
			promotionName: "Mua 1 tặng 1",
		});
		expect(
			harness.flags.filter((flag) => flag.saleExternalId === "INV-5"),
		).toEqual([]);
	});

	it("keeps a priced customisation option as an item linked through its composite id", async () => {
		const harness = await run(DAY);
		const topping = sale(harness, "INV-7").lines.find(
			(line) => line.itemName === "Trân châu đen",
		);
		expect(topping?.lineKind).toBe("item");
		expect(topping?.netAmount).toBe(8_000);
		expect(topping?.parentLineExternalId).toBe(LINE_7_UUID);
	});

	it("attaches a modifier that comes first to the nearest item line", async () => {
		const harness = await run(DAY);
		const [modifier, matcha] = sale(harness, "INV-8").lines;
		expect(modifier?.lineKind).toBe("modifier");
		expect(modifier?.parentLineExternalId).toBe(matcha?.externalId);
	});

	it("emits data-quality flags for duplicates, payment mismatches and unknown items", async () => {
		const harness = await run(DAY);
		const codes = harness.flags.map(
			(flag) => `${flag.code}:${flag.saleExternalId}`,
		);
		expect(codes).toContain(`${FLAG_CODES.duplicateSale}:INV-1`);
		expect(codes).toContain(`${FLAG_CODES.paymentSumMismatch}:INV-9`);
		expect(codes).toContain(`${FLAG_CODES.unknownItem}:INV-10`);
		expect(codes).toContain(`${FLAG_CODES.unknownItemType}:INV-10`);
		expect(sale(harness, "INV-10").lines[0]?.lineKind).toBe("item");
		expect(sale(harness, "INV-9").paidAmount).toBe(10_000);
		expect(
			harness.flags.filter((flag) => flag.code === FLAG_CODES.lineSumMismatch),
		).toEqual([]);
	});

	it("also delivers flags through the vendor-neutral fetch context", async () => {
		const { connector, store } = await connect(0);
		const flags: DataQualityFlag[] = [];
		await collectSales(
			connector.fetchSales(store, DAY, { onFlag: (flag) => flags.push(flag) }),
		);
		expect(flags.map((flag) => flag.code)).toContain(FLAG_CODES.duplicateSale);
	});

	it("declares adjustments as unavailable and rejects fetchAdjustments", async () => {
		const { connector, store } = await connect(0);
		expect(connector.describe().capabilities.adjustments).toBe(false);
		expect(connector.describe().credentialsSchema.safeParse({}).success).toBe(
			false,
		);
		await expect(connector.fetchAdjustments(store, DAY)).rejects.toBeInstanceOf(
			ConnectorCapabilityError,
		);
	});

	it("builds a catalog whose modifier flags mirror the line classification", async () => {
		const { connector, store } = await connect(0, {
			deliverySources: ["SRC-GRAB"],
		});
		const catalog = await connector.fetchCatalog(store);
		expect(
			catalog.items.find((item) => item.externalId === "TBH-L"),
		).toMatchObject({
			baseName: "Trà bưởi hồng",
			sizeLabel: "L",
			itemTypeName: "Trà trái cây",
			isModifier: false,
		});
		const flagged = (id: string) =>
			catalog.items.find((item) => item.externalId === id)?.isModifier;
		expect(flagged("DA50")).toBe(true);
		expect(flagged("DA50B")).toBe(true);
		expect(flagged("TP-TC")).toBe(false);
		expect(flagged("TOP-FREE")).toBe(false);
		expect(catalog.modifiers.map((modifier) => modifier.externalId)).toEqual([
			"DA50",
		]);
		expect(catalog.modifiers[0]?.appliesToItemExternalIds).toEqual([
			"TBH-L",
			"ML",
			"MCCL-M",
		]);
		expect(catalog.paymentMethods.map((method) => method.kind)).toEqual([
			"ewallet",
			"cash",
			"bank_transfer",
			"other",
		]);
		expect(
			catalog.sources.find((source) => source.externalId === "SRC-GRAB")
				?.isDelivery,
		).toBe(true);
		expect(
			catalog.sources.find((source) => source.externalId === "SRC-OTS")
				?.isDelivery,
		).toBe(false);
	});

	it("takes the business-day start from the store's open_at unless overridden", async () => {
		const fromLogin = await connect(5);
		expect(fromLogin.store.dayStartMinutes).toBe(300);
		const overridden = await connect(5, { dayStartMinutes: 0 });
		expect(overridden.store.dayStartMinutes).toBe(0);
		expect(() => createIposConnector({ dayStartMinutes: 90 })).toThrow(
			RangeError,
		);
	});

	it("queries control totals with local-midnight instants and store_open_at in hours", async () => {
		const { connector, store, fake } = await connect(5);
		const window = { fromDate: "2026-11-07", toDate: "2026-11-07" };
		const totals = await connector.fetchControlTotals(store, window);
		const sales = await collectSales(connector.fetchSales(store, window));
		const request = fake.requestsTo("/api/v3/reports/sale-summary/days")[0];
		expect(request?.url.searchParams.get("store_open_at")).toBe("5");
		expect(request?.url.searchParams.get("start_date")).toBe(
			String(Date.UTC(2026, 10, 6, 17, 0)),
		);
		expect(request?.url.searchParams.get("end_date")).toBe(
			String(Date.UTC(2026, 10, 7, 17, 0) - 1),
		);
		expect(totals).toHaveLength(1);
		expect(totals[0]?.businessDate).toBe("2026-11-07");
		expect(totals[0]?.invoiceCount).toBe(sales.length);
		expect(sales.map((entry) => entry.externalId)).toContain("INV-3");
		expect(sales.map((entry) => entry.externalId)).toContain("INV-12");
	});
});
