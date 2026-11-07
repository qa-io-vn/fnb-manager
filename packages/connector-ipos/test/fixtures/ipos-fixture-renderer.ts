import {
	DEFAULT_MOCK_PROFILE,
	generateDays,
	MENU,
	type Menu,
	type MockProfile,
	mockStore,
} from "@fnb/connector-mock";
import {
	businessDate,
	businessDayStart,
	type CanonicalDailyTotal,
	type CanonicalSale,
	type CanonicalShift,
	type CanonicalStore,
	isoDatesBetween,
	shiftIsoDate,
	sumMoney,
	wallClockIn,
} from "@fnb/core";
import { LOGIN_PATH } from "../../src/index.js";
import {
	BRAND_UID,
	CITY_UID,
	COMPANY_UID,
	envelope,
	errorEnvelope,
	fakeUuid,
	makeLoginPayload,
	makeLoginStore,
	STORE_UID,
	USER_UID,
} from "./factories.js";
import type { FakeResponse, RecordedRequest, Responder } from "./fake-fetch.js";

export interface FixtureShopOptions {
	seed: number;
	fromDate: string;
	toDate: string;
	profile?: Partial<MockProfile>;
	menu?: Menu;
	paddingDays?: number;
}

export interface FixtureShop {
	store: CanonicalStore;
	storeUid: string;
	menu: Menu;
	sales: CanonicalSale[];
	shifts: CanonicalShift[];
	dailyTotals: CanonicalDailyTotal[];
	uuidOnlyTypeItemIds: ReadonlySet<string>;
}

type Row = Record<string, unknown>;

const UNCATEGORY_TYPE_UID = fakeUuid(399);
const UNIT_UID = fakeUuid(350);
const DELIVERY_SOURCE_NAME = "GIAO HÀNG";
const UUID_ONLY_TYPE_EVERY = 3;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

function uuidOnlyTypeItemIds(menu: Menu): ReadonlySet<string> {
	return new Set(
		menu.drinks
			.filter((_, index) => index % UUID_ONLY_TYPE_EVERY === 0)
			.map((drink) => drink.externalId),
	);
}

export function renderFixtureShop(options: FixtureShopOptions): FixtureShop {
	const profile = { ...DEFAULT_MOCK_PROFILE, ...options.profile };
	const menu = options.menu ?? MENU;
	const padding = options.paddingDays ?? 2;
	const store = mockStore(1, profile);
	const generated = generateDays(
		options.seed,
		profile,
		shiftIsoDate(options.fromDate, -padding),
		shiftIsoDate(options.toDate, padding),
		store,
		menu,
	);
	return {
		store,
		storeUid: STORE_UID,
		menu,
		sales: generated.sales.filter((sale) => sale.status !== "voided"),
		shifts: generated.shifts,
		dailyTotals: generated.dailyTotals,
		uuidOnlyTypeItemIds: uuidOnlyTypeItemIds(menu),
	};
}

function typeUid(shop: FixtureShop, externalId: string | undefined): string {
	const index = shop.menu.catalog.itemTypes.findIndex(
		(type) => type.externalId === externalId,
	);
	return index < 0 ? UNCATEGORY_TYPE_UID : fakeUuid(300 + index);
}

function classUid(shop: FixtureShop, name: string | undefined): string | null {
	const index = shop.menu.catalog.itemClasses.findIndex(
		(itemClass) => itemClass.name === name,
	);
	return index < 0 ? null : fakeUuid(330 + index);
}

function itemRows(shop: FixtureShop): Row[] {
	return shop.menu.catalog.items.map((item, index) => ({
		id: fakeUuid(1000 + index),
		item_id: item.externalId,
		item_name: item.name,
		ots_price: item.listPrice,
		ta_price: item.takeawayPrice ?? item.listPrice,
		cost_price: 0,
		active: item.active ? 1 : 0,
		deleted: false,
		item_type_uid: item.isModifier
			? UNCATEGORY_TYPE_UID
			: typeUid(shop, item.itemTypeExternalId),
		item_class_uid: classUid(shop, item.itemClassName),
		unit_uid: UNIT_UID,
		store_uid: shop.storeUid,
		customization_uid: null,
	}));
}

function itemTypeRows(shop: FixtureShop): Row[] {
	return [
		...shop.menu.catalog.itemTypes.map((type, index) => ({
			id: fakeUuid(300 + index),
			item_type_id: type.externalId,
			item_type_name: type.name,
			item_type_parent_id: null,
			active: 1,
			deleted: false,
		})),
		{
			id: UNCATEGORY_TYPE_UID,
			item_type_id: "UNCAT",
			item_type_name: "Uncategory",
			item_type_parent_id: null,
			active: 1,
			deleted: false,
		},
	];
}

function itemClassRows(shop: FixtureShop): Row[] {
	return shop.menu.catalog.itemClasses.map((itemClass, index) => ({
		id: fakeUuid(330 + index),
		item_class_id: itemClass.externalId,
		item_class_name: itemClass.name,
		active: 1,
		deleted: false,
	}));
}

function customizationRows(shop: FixtureShop): Row[] {
	const appliesTo = shop.menu.drinks.map((drink) => drink.externalId);
	return shop.menu.modifierGroups.map((group, index) => ({
		id: fakeUuid(2000 + index),
		name: group.name,
		active: 1,
		list_item: appliesTo,
		data: {
			LstItem_Options: [
				{
					id: `OPTION-GROUP-${index + 1}`,
					Name: group.name,
					index,
					LstItem_Id: group.options.map((option) => option.externalId),
					Max_Permitted: 1,
					Min_Permitted: 0,
				},
			],
		},
		brand_uid: BRAND_UID,
		company_uid: COMPANY_UID,
	}));
}

function sourceRows(shop: FixtureShop): Row[] {
	return shop.menu.catalog.sources.map((source, index) => ({
		id: fakeUuid(2100 + index),
		source_id: source.externalId,
		source_name: source.name,
		source_type: ["delivery"],
		active: 1,
		deleted: false,
	}));
}

function paymentMethodRows(shop: FixtureShop): Row[] {
	return shop.menu.catalog.paymentMethods.map((method, index) => ({
		id: fakeUuid(2200 + index),
		payment_method_id: method.externalId,
		payment_method_name: method.name,
		payment_type: 1,
		active: 1,
		deleted: false,
	}));
}

function promotionRows(shop: FixtureShop): Row[] {
	return shop.menu.catalog.promotions.map((promotion) => ({
		promotion_id: promotion.externalId,
		promotion_name: promotion.name,
		promotions: [],
	}));
}

function saleType(sale: CanonicalSale): string {
	switch (sale.channel) {
		case "dine_in":
			return "OTS";
		case "take_away":
		case "delivery":
			return "TA";
		default:
			return "OTHER";
	}
}

function sourceName(sale: CanonicalSale): string {
	return sale.channel === "delivery"
		? DELIVERY_SOURCE_NAME
		: (sale.sourceName ?? "TẠI CHỖ");
}

function clock(instant: Date | undefined, timezone: string) {
	if (!instant) {
		return { hour: null, minute: null };
	}
	const wall = wallClockIn(instant, timezone);
	return { hour: wall.hour, minute: wall.minute };
}

function invoiceHeader(sale: CanonicalSale, shop: FixtureShop): Row {
	const opened = clock(sale.openedAt, shop.store.timezone);
	const closed = clock(sale.closedAt, shop.store.timezone);
	const firstPayment = sale.payments[0];
	return {
		tran_id: sale.externalId,
		tran_no: sale.receiptNo ?? null,
		tran_date: sale.soldAt.getTime(),
		start_hour: opened.hour,
		start_minute: opened.minute,
		end_hour: closed.hour,
		end_minute: closed.minute,
		table_name: sale.tableName ?? null,
		area_id: "AREA-01",
		area_name: sale.areaName ?? null,
		sale_type: saleType(sale),
		source_id: sale.sourceExternalId ?? null,
		source_name: sourceName(sale),
		shift_id: sale.shiftExternalId ?? null,
		store_uid: shop.storeUid,
		employee_id: sale.employeeExternalId ?? null,
		employee_name: sale.employeeName ?? null,
		customer_name: sale.customerName ?? "",
		customer_phone: sale.customerPhone ?? "",
		peo_count: sale.guestCount,
		payment_method_id: firstPayment?.methodExternalId ?? null,
		payment_method_name: firstPayment?.methodName ?? null,
		pos_id: 1,
	};
}

function invoiceRows(shop: FixtureShop): Row[] {
	return shop.sales.map((sale) => ({
		...invoiceHeader(sale, shop),
		total_amount: sale.netAmount,
		amount_origin: sale.grossAmount - sale.itemDiscountAmount,
		amount_discount_detail: sale.itemDiscountAmount,
		amount_discount_price: 0,
		discount_extra_amount: sale.billDiscountAmount,
		discount_extra_name: sale.billDiscountName ?? null,
		voucher_code: sale.voucherCode ?? null,
		voucher_name: sale.voucherName ?? null,
		voucher_amount_paid: sale.voucherAmount,
		vat_amount: 0,
		ship_fee_amount: 0,
		service_charge_amount: 0,
		commission_amount: 0,
		partner_marketing_amount: 0,
	}));
}

function lineRows(shop: FixtureShop): Row[] {
	return shop.sales.flatMap((sale) => {
		const header = invoiceHeader(sale, shop);
		return sale.lines.map((line, position) => {
			const modifier = line.lineKind === "modifier";
			const uuidOnlyType =
				line.itemExternalId !== undefined &&
				shop.uuidOnlyTypeItemIds.has(line.itemExternalId);
			return {
				...header,
				id: line.externalId,
				sale_id: fakeUuid(5000),
				item_id: line.itemExternalId ?? line.externalId,
				item_name: line.itemName,
				item_type_id: modifier
					? "UNCAT"
					: uuidOnlyType
						? typeUid(shop, line.itemTypeExternalId)
						: (line.itemTypeExternalId ?? null),
				item_type_name: modifier
					? "UnCategory"
					: uuidOnlyType
						? ""
						: line.itemTypeName,
				item_class_id: null,
				item_class_name: line.itemClassName ?? null,
				unit_id: "LY",
				quantity: line.quantity,
				price: line.unitPrice,
				ots_price: line.unitPrice,
				amount: line.netAmount,
				discount_amount: line.discountAmount,
				amount_discount_on_price: 0,
				promotion_id: line.promotionExternalId ?? null,
				promotion_name: line.promotionName ?? null,
				item_note: line.note ?? null,
				package_id: null,
				sale_detail_type: 0,
				index: position,
			};
		});
	});
}

function paymentRows(shop: FixtureShop): Row[] {
	return shop.sales.flatMap((sale) =>
		sale.payments.map((payment) => ({
			tran_id: sale.externalId,
			tran_no: sale.receiptNo ?? null,
			tran_date: sale.soldAt.getTime(),
			store_uid: shop.storeUid,
			payment_method_id: payment.methodExternalId,
			payment_method_name: payment.methodName,
			amount: payment.amount,
			total_amount: sale.netAmount,
			payment_fee_amount: payment.feeAmount,
			trace_no: payment.referenceNo ?? null,
			tran_id_of_partner: payment.partnerTransactionId ?? null,
		})),
	);
}

function shiftRows(shop: FixtureShop): Row[] {
	return shop.shifts.map((shift) => ({
		shift_id: shift.externalId,
		shift_name: shift.name ?? null,
		store_uid: shop.storeUid,
		brand_uid: BRAND_UID,
		company_uid: COMPANY_UID,
		user_uid: shift.cashierExternalId ?? USER_UID,
		user_name: shift.cashierName ?? null,
		device_code: shift.deviceCode ?? null,
		status: shift.status ?? "closed",
		start_date: shift.openedAt.getTime(),
		end_date: shift.closedAt?.getTime() ?? null,
		amount: shift.salesAmount,
		cash_drawer_total: shift.cashDrawerAmount ?? null,
		balance: shift.openingFloatAmount ?? null,
		number_order: shift.ordersCount,
		change_after_close: shift.changedAfterClose ? 1 : 0,
	}));
}

function dayRow(shop: FixtureShop, date: string, openAtHours: number): Row {
	const timezone = shop.store.timezone;
	const inDay = shop.sales.filter(
		(sale) =>
			businessDate(sale.soldAt, timezone, openAtHours * MINUTES_PER_HOUR) ===
			date,
	);
	return {
		date,
		tran_date: businessDayStart(date, timezone, 0).getTime(),
		total_sales: inDay.length,
		revenue_gross: sumMoney(inDay.map((sale) => sale.grossAmount)),
		revenue_net: sumMoney(inDay.map((sale) => sale.netAmount)),
		discount_amount: sumMoney(
			inDay.map((sale) => sale.itemDiscountAmount + sale.billDiscountAmount),
		),
		voucher_amount: sumMoney(inDay.map((sale) => sale.voucherAmount)),
		vat_amount: 0,
		ship_fee_amount: 0,
		peo_count: 0,
	};
}

function number(request: RecordedRequest, name: string): number | null {
	const value = request.url.searchParams.get(name);
	return value === null ? null : Number(value);
}

function inRange(row: Row, request: RecordedRequest, field: string): boolean {
	const value = Number(row[field]);
	const start = number(request, "start_date") ?? Number.NEGATIVE_INFINITY;
	const end = number(request, "end_date") ?? Number.POSITIVE_INFINITY;
	return value >= start && value <= end;
}

function storeMismatch(
	request: RecordedRequest,
	shop: FixtureShop,
	parameter: string,
): FakeResponse | null {
	const value = request.url.searchParams.get(parameter);
	if (value === null) {
		return {
			status: 400,
			json: errorEnvelope(400, `${parameter} is required`),
		};
	}
	if (value === "") {
		return { status: 500, json: errorEnvelope(500, "internal error") };
	}
	if (value !== shop.storeUid) {
		return { status: 200, json: envelope([]) };
	}
	return null;
}

function cursorPage(rows: Row[], request: RecordedRequest): FakeResponse {
	const pageSize = number(request, "results_per_page") ?? 5000;
	const cursor = number(request, "last_tran_date");
	const sorted = [...rows].sort(
		(left, right) => Number(left.tran_date) - Number(right.tran_date),
	);
	const remaining =
		cursor === null
			? sorted
			: sorted.filter((row) => Number(row.tran_date) >= cursor);
	const page = remaining.slice(0, pageSize);
	const last = page[page.length - 1];
	const nextCursor =
		page.length < remaining.length && last ? Number(last.tran_date) : null;
	return { status: 200, json: envelope(page, { next_cursor: nextCursor }) };
}

function accountingReport(
	rows: Row[],
	request: RecordedRequest,
	shop: FixtureShop,
): FakeResponse {
	const mismatch = storeMismatch(request, shop, "list_store_uid");
	if (mismatch) {
		return mismatch;
	}
	return cursorPage(
		rows.filter((row) => inRange(row, request, "tran_date")),
		request,
	);
}

function shiftsPage(rows: Row[], request: RecordedRequest): FakeResponse {
	const pageSize = number(request, "results_per_page") ?? 10;
	const page = number(request, "page") ?? 1;
	const matching = rows.filter((row) => inRange(row, request, "start_date"));
	const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
	return {
		status: 200,
		json: envelope(matching.slice((page - 1) * pageSize, page * pageSize), {
			page,
			num_results: matching.length,
			total_pages: totalPages,
		}),
	};
}

function daysPayload(
	shop: FixtureShop,
	request: RecordedRequest,
): FakeResponse {
	const openAt = number(request, "store_open_at") ?? 0;
	const start = number(request, "start_date");
	const end = number(request, "end_date");
	if (
		!Number.isInteger(openAt) ||
		openAt < 0 ||
		openAt >= HOURS_PER_DAY ||
		start === null ||
		end === null
	) {
		return { status: 400, json: errorEnvelope(400, "Truyền thiếu dữ liệu") };
	}
	const timezone = shop.store.timezone;
	const rows = isoDatesBetween(
		businessDate(new Date(start), timezone, 0),
		businessDate(new Date(end), timezone, 0),
	)
		.map((date) => dayRow(shop, date, openAt))
		.filter((row) => Number(row.total_sales) > 0);
	const sum = (field: string) =>
		rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
	return {
		status: 200,
		json: envelope({
			total_sales: sum("total_sales"),
			revenue_gross: sum("revenue_gross"),
			revenue_net: sum("revenue_net"),
			discount_amount: sum("discount_amount"),
			peo_count: 0,
			list_data: rows,
		}),
	};
}

export function fixtureResponder(shop: FixtureShop): Responder {
	const storeRow = {
		...makeLoginStore({
			id: shop.storeUid,
			store_name: shop.store.name,
			address: shop.store.address ?? null,
			open_at: shop.store.dayStartMinutes / MINUTES_PER_HOUR,
		}),
	};
	const login = makeLoginPayload();
	login.stores = [storeRow];
	const masterData: Record<string, Row[]> = {
		"/api/mdata/v1/stores": [storeRow],
		"/api/mdata/v1/item-types": itemTypeRows(shop),
		"/api/mdata/v1/item-classes": itemClassRows(shop),
		"/api/mdata/v1/units": [{ id: UNIT_UID, unit_id: "LY", unit_name: "Ly" }],
		"/api/mdata/v1/sources": sourceRows(shop),
		"/api/mdata/v1/payment-methods": paymentMethodRows(shop),
		"/api/mdata/v1/promotions": promotionRows(shop),
	};
	const items = itemRows(shop);
	const customizations = customizationRows(shop);
	const invoices = invoiceRows(shop);
	const lines = lineRows(shop);
	const payments = paymentRows(shop);
	const shifts = shiftRows(shop);

	return (request) => {
		const path = request.url.pathname;
		if (path === LOGIN_PATH) {
			return { status: 200, json: envelope(login) };
		}
		const master = masterData[path];
		if (master) {
			return { status: 200, json: envelope(master) };
		}
		switch (path) {
			case "/api/mdata/v1/items":
				return (
					storeMismatch(request, shop, "list_store_uid") ?? {
						status: 200,
						json: envelope(items),
					}
				);
			case "/api/mdata/v1/packages":
				return (
					storeMismatch(request, shop, "list_store_uid") ?? {
						status: 200,
						json: envelope([]),
					}
				);
			case "/api/mdata/v1/customizations":
				return (
					storeMismatch(request, shop, "store_uid") ?? {
						status: 200,
						json: envelope(customizations),
					}
				);
			case "/api/v1/accounting/report/sale":
				return accountingReport(invoices, request, shop);
			case "/api/v1/accounting/report/sale-detail":
				return accountingReport(lines, request, shop);
			case "/api/v1/accounting/report/payment-method":
				return accountingReport(payments, request, shop);
			case "/api/v3/reports/shifts":
				return shiftsPage(shifts, request);
			case "/api/v3/reports/sale-summary/days":
				return daysPayload(shop, request);
			default:
				return {
					status: 404,
					json: errorEnvelope(404, `no fixture route for ${path}`),
				};
		}
	};
}

export const FIXTURE_DELIVERY_SOURCES = [DELIVERY_SOURCE_NAME];
export const FIXTURE_CITY_UID = CITY_UID;
