export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function fakeUuid(sequence: number): string {
	return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export const COMPANY_UID = fakeUuid(1);
export const BRAND_UID = fakeUuid(2);
export const STORE_UID = fakeUuid(3);
export const CITY_UID = fakeUuid(4);
export const USER_UID = fakeUuid(5);

export const TEST_EMAIL = "manager@example.com";
export const TEST_PASSWORD = "correct-horse-battery-staple";
export const TEST_APP_ACCESS_TOKEN = "0123456789abcdef0123456789abcdef";
export const TEST_CREDENTIALS = {
	email: TEST_EMAIL,
	password: TEST_PASSWORD,
	appAccessToken: TEST_APP_ACCESS_TOKEN,
};

function base64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

export interface FakeJwtOptions {
	issuedAt?: number;
	expiresAt?: number;
	userUid?: string;
	companyUid?: string;
	email?: string;
}

export function makeJwt(options: FakeJwtOptions = {}): string {
	const issuedAtSeconds = Math.floor((options.issuedAt ?? Date.now()) / 1000);
	const expiresAtSeconds = Math.floor(
		(options.expiresAt ?? Date.now() + 7 * DAY_MS) / 1000,
	);
	const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const payload = base64Url(
		JSON.stringify({
			id: options.userUid ?? USER_UID,
			ut: "user",
			email: options.email ?? TEST_EMAIL,
			cp: options.companyUid ?? COMPANY_UID,
			iat: issuedAtSeconds,
			exp: expiresAtSeconds,
		}),
	);
	return `${header}.${payload}.${base64Url("signature")}`;
}

export function makeLoginStore(overrides: Record<string, unknown> = {}) {
	return {
		id: STORE_UID,
		brand_uid: BRAND_UID,
		city_uid: CITY_UID,
		company_uid: COMPANY_UID,
		store_id: "S001",
		store_name: "Store A",
		address: "1 Example Street",
		phone: "0000000000",
		active: 1,
		open_at: 0,
		fb_store_id: 1000,
		...overrides,
	};
}

export function makeLoginPayload(token: string = makeJwt()) {
	return {
		user: {
			id: USER_UID,
			email: TEST_EMAIL,
			full_name: "Manager A",
			phone: null,
			role_uid: fakeUuid(6),
			company_uid: COMPANY_UID,
			active: 1,
		},
		user_role: {
			id: fakeUuid(6),
			role_id: "R01",
			role_name: "Chain manager",
			description: null,
			scope: "company",
		},
		user_permissions: {
			id: fakeUuid(7),
			user_uid: USER_UID,
			company_uid: COMPANY_UID,
			stores: {},
		},
		company: {
			id: COMPANY_UID,
			company_id: "C001",
			company_name: "Company A",
			active: 1,
		},
		brands: [
			{
				id: BRAND_UID,
				brand_id: "B001",
				brand_name: "Brand A",
				active: 1,
				currency: "VND",
			},
		],
		cities: [{ id: CITY_UID, city_id: "CT01", city_name: "City A", active: 1 }],
		stores: [makeLoginStore()],
		genai_access: false,
		token,
	};
}

export function makeStore(sequence = 1) {
	return {
		id: sequence === 1 ? STORE_UID : fakeUuid(100 + sequence),
		store_id: `S00${sequence}`,
		store_name: `Store ${String.fromCharCode(64 + sequence)}`,
		brand_uid: BRAND_UID,
		company_uid: COMPANY_UID,
		city_uid: CITY_UID,
		address: `${sequence} Example Street`,
		phone: "0000000000",
		active: 1,
		fb_store_id: 1000 + sequence,
		extra_data: { open_at: 0 },
	};
}

export function makeItem(sequence: number) {
	return {
		id: fakeUuid(200 + sequence),
		item_id: `I${String(sequence).padStart(3, "0")}`,
		item_name: `Item ${sequence} (M)`,
		ots_price: 50_000,
		ta_price: 50_000,
		cost_price: 0,
		active: 1,
		deleted: false,
		item_type_uid: fakeUuid(300),
		item_class_uid: fakeUuid(301),
		unit_uid: fakeUuid(302),
		store_uid: STORE_UID,
	};
}

export function makeInvoice(sequence: number, tranDate: number) {
	return {
		index: sequence,
		tran_id: fakeUuid(400 + sequence),
		tran_no: `TN${String(sequence).padStart(5, "0")}`,
		tran_date: tranDate,
		start_hour: 9,
		start_minute: 0,
		end_hour: 9,
		end_minute: 2,
		table_name: "CARD 1",
		area_name: "Area A",
		sale_type: "OTS",
		source_id: "SRC01",
		source_name: "Dine in",
		shift_id: "SH01",
		store_uid: STORE_UID,
		employee_id: "E01",
		employee_name: "Cashier",
		customer_name: "",
		customer_phone: "",
		peo_count: 0,
		payment_method_id: "PM01",
		payment_method_name: "Cash",
		pos_id: 1,
		total_amount: 100_000,
		amount_origin: 100_000,
		amount_discount_detail: 0,
		amount_discount_price: 0,
		discount_extra_amount: 0,
		voucher_amount_paid: 0,
		vat_amount: 0,
		ship_fee_amount: 0,
		service_charge_amount: 0,
		commission_amount: 0,
	};
}

export function makePayment(
	sequence: number,
	tranDate: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		index: sequence,
		tran_id: fakeUuid(500 + sequence),
		tran_no: `TN${String(sequence).padStart(5, "0")}`,
		tran_date: tranDate,
		store_uid: STORE_UID,
		payment_method_id: "PM01",
		payment_method_name: "Cash",
		amount: 50_000,
		total_amount: 100_000,
		payment_fee_amount: 0,
		trace_no: null,
		...overrides,
	};
}

export function makeShift(sequence: number, startDate: number) {
	return {
		shift_id: `SH${String(sequence).padStart(3, "0")}`,
		shift_name: `Shift ${sequence}`,
		store_uid: STORE_UID,
		user_uid: USER_UID,
		user_name: "Cashier",
		device_code: "POS-1",
		status: "closed",
		start_date: startDate,
		end_date: startDate + 8 * HOUR_MS,
		amount: 1_000_000,
		cash_drawer_total: 1_500_000,
		balance: 500_000,
		number_order: 10,
		change_after_close: 0,
	};
}

export function makeDayRow(tranDate: number) {
	return {
		date: "2026-01-01",
		tran_date: tranDate,
		total_sales: 10,
		revenue_gross: 1_000_000,
		revenue_net: 1_000_000,
		discount_amount: 0,
		voucher_amount: 0,
		vat_amount: 0,
		ship_fee_amount: 0,
		peo_count: 0,
	};
}

export function makeDaysPayload(dayCount: number, firstDay: number) {
	const list_data = Array.from({ length: dayCount }, (_, offset) =>
		makeDayRow(firstDay + offset * DAY_MS),
	);
	return {
		total_sales: dayCount * 10,
		revenue_gross: dayCount * 1_000_000,
		revenue_net: dayCount * 1_000_000,
		discount_amount: 0,
		peo_count: 0,
		list_data,
	};
}

export function envelope(data: unknown, extra: Record<string, unknown> = {}) {
	return { data, message: null, track_id: "track-0001", ...extra };
}

export function errorEnvelope(
	code: number,
	message: string,
	trackId = "track-err-0001",
) {
	return { error: { code, message }, track_id: trackId };
}

export function makeEditDeleteRow(
	sequence: number,
	tranDate: number,
	overrides: Record<string, unknown> = {},
) {
	const tranId = fakeUuid(600 + sequence);
	return {
		tran_id: tranId,
		origin_tran_id: "",
		first_origin_tran_id: tranId,
		tran_no: `TN${String(sequence).padStart(5, "0")}`,
		shift_id: "SH001",
		store_uid: STORE_UID,
		store_name: "Store A",
		table_name: "CARD 1",
		employee_uid: USER_UID,
		employee_name: "Cashier",
		sale_note: "Phục vụ nhầm",
		status: "DELETE",
		total_amount_origin: 60_000,
		total_amount: 0,
		tran_date: tranDate,
		updated_at: tranDate + 5 * 60_000,
		payment_method_id: "PM01",
		payment_method_name: "Cash",
		tran_id_of_partner: null,
		trace_no: null,
		source_voucher: null,
		source_deli: null,
		extra_data: {},
		...overrides,
	};
}

export function makeChangeLogLine(
	lineId: string,
	overrides: Record<string, unknown> = {},
) {
	const removed =
		typeof overrides.quantity === "number" && overrides.quantity < 0;
	return {
		id: fakeUuid(7100),
		id_sale_detail: lineId,
		item_id: "I001",
		item_name: "Item 1 (M)",
		item_type_id: "T01",
		item_type_name: "Type 1",
		item_class_id: null,
		item_class_name: null,
		quantity: 1,
		price: 50_000,
		price_org: 50_000,
		amount: 50_000,
		sort_index: removed ? -1 : 1,
		unit_id: "LY",
		note: "",
		hour: 9,
		minute: 5,
		is_printed: removed ? 1 : 0,
		quantity_print_temp: 0,
		order_no: 1,
		device_code: "POS-1",
		employee_id: "E01",
		employee_name: "Cashier",
		status: "COOKING",
		toppings: [],
		...overrides,
	};
}

export function makeRemovedItemEvent(
	sequence: number,
	logDate: number,
	saleDetail: Record<string, unknown>[],
	overrides: Record<string, unknown> = {},
) {
	return {
		tran_id: fakeUuid(650 + sequence),
		tran_no: "",
		store_uid: STORE_UID,
		log_type: "SALE_CHANGE",
		log_date: logDate,
		updated_at: Math.floor(logDate / 1000) + 25_200,
		state_action: 1,
		table_name: "CARD 2",
		employee_name: "Cashier",
		total_tran_id: saleDetail.length,
		sale_detail: saleDetail,
		...overrides,
	};
}
