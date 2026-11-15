import { describe, expect, it } from "vitest";
import { analyticsFunctions } from "../../../src/contract/functions.js";
import { ARGUMENT_SQL_TYPES } from "../../../src/themes/argument-types.js";
import {
	type ThemeFunctionName,
	themeArgumentNames,
	themeFunctions,
	themeRowColumns,
} from "../../../src/themes/contract.js";
import { STORE_A } from "./fixtures.js";

const TEN_B_FUNCTIONS = [
	"promotion_days",
	"promotion_catalogue",
	"promotion_lift",
	"promotion_compliance",
	"item_discount_days",
	"shift_adjustments",
	"data_quality_items",
	"data_quality_summary",
	"data_quality_payments",
] as const satisfies readonly ThemeFunctionName[];

type TenBFunction = (typeof TEN_B_FUNCTIONS)[number];

const sqlArguments: Record<TenBFunction, readonly string[]> = {
	promotion_days: [
		"store_ids",
		"from_date",
		"to_date",
		"kind_filter",
		"key_filter",
	],
	promotion_catalogue: ["store_ids", "as_of_date"],
	promotion_lift: [
		"store_ids",
		"promotion_kind",
		"promotion_key",
		"from_date",
		"to_date",
		"comparator",
		"pre_weeks",
	],
	promotion_compliance: ["store_ids", "from_date", "to_date", "cap_rate"],
	item_discount_days: ["store_ids", "calendar_year", "as_of_date"],
	shift_adjustments: ["store_ids", "from_date", "to_date", "z_threshold"],
	data_quality_items: ["store_ids", "from_date", "to_date"],
	data_quality_summary: ["store_ids", "from_date", "to_date"],
	data_quality_payments: ["store_ids", "from_date", "to_date"],
};

const databaseRows: Record<TenBFunction, Record<string, unknown>> = {
	promotion_days: {
		store_id: null,
		business_date: "2026-10-12",
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		invoices: "14",
		lines: "17",
		discount_amount: "238000.00",
	},
	promotion_catalogue: {
		promotion_kind: "voucher",
		promotion_key: "unnamed",
		promotion_name: "unnamed",
		in_catalogue: false,
		catalogue_active: null,
		starts_at: null,
		ends_at: null,
		first_used_on: "2025-03-02",
		last_used_on: "2026-11-01",
		days_used_365: 40,
		invoices_365: "52",
		discount_365: "1040000.00",
	},
	promotion_lift: {
		business_date: null,
		promo_day: null,
		control_day: null,
		test_gross_amount: null,
		test_net_amount: null,
		test_invoices: null,
		discount_amount: "120000.00",
		reference_gross_amount: null,
		reference_days: null,
		counterfactual_gross_amount: null,
		gross_lift_amount: "-45000.00",
		test_store_count: 1,
		control_store_count: 1,
		promo_days: 5,
		measured_days: 4,
		control_days: 12,
		trend_adjustment_amount: "3500.00",
		net_lift_amount: "-165000.00",
		lift_rate: "-0.012500",
		flags: ["unmeasured_days", "other_promotions"],
	},
	promotion_compliance: {
		promotion_kind: "invoice_total",
		promotion_key: "all",
		promotion_name: null,
		checked_rows: "310",
		max_partial_rate: "0.600000",
		over_cap_rows: "2",
		over_cap_discount_amount: "54000.00",
		first_over_cap_on: "2026-10-03",
		last_over_cap_on: "2026-10-19",
		full_discount_rows: "1",
		full_discount_amount: "45000.00",
		first_full_discount_on: "2026-10-11",
		last_full_discount_on: "2026-10-11",
	},
	item_discount_days: {
		item_external_id: "ITEM-7",
		item_name: "Trà sữa",
		price_discount_days: 31,
		line_price_discount_days: 12,
		bill_discount_days: 22,
		gift_days: 4,
		voucher_days: 0,
		first_price_discount_on: "2026-01-04",
		last_price_discount_on: "2026-10-30",
	},
	shift_adjustments: {
		store_id: STORE_A,
		shift_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000149",
		shift_external_id: "SH-881",
		shift_name: "Ca sáng",
		business_date: "2026-10-12",
		cashier_name: null,
		opened_at: "2026-10-12T00:30:00+00:00",
		closed_at: null,
		orders: "84",
		item_lines: "131",
		voids: 2,
		void_amount: "70000.00",
		edits: 1,
		removed_lines: 3,
		removed_amount: "96000.00",
		edits_after_close: 0,
		changed_after_close: false,
		void_rate: "0.023256",
		removed_line_rate: "0.022901",
		trailing_shifts: 18,
		void_z_score: "2.4100",
		removed_z_score: null,
		flagged: true,
		reasons: ["voids"],
	},
	data_quality_items: {
		item_external_id: "ITEM-9",
		item_name: "Bánh flan",
		pos_account_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000149",
		pos_type_external_id: null,
		pos_type_name: null,
		override_type_external_id: "TYPE-3",
		item_type_external_id: "TYPE-3",
		item_type_name: "Bánh",
		type_known: true,
		role: null,
		cost_known: false,
		catalogue_modifier: false,
		quantity: "41.000",
		net_amount: "820000.00",
		net_share: "0.012345",
	},
	data_quality_summary: {
		store_id: null,
		invoices: "2210",
		item_lines: "3480",
		modifier_lines: "1120",
		modifier_line_share: "0.243478",
		catalogue_modifier_lines: "0",
		identified_invoices: "0",
		capture_rate: "0.000000",
		identified_customers: "0",
		loyalty_consents: "0",
		marketing_consents: "0",
		consent_coverage: null,
		unattributed_events: "0",
		e_invoice_status: null,
		tran_no_reset_period: null,
		member_capture_status: null,
		opening_hours_known: null,
		seat_count: null,
		opened_on: null,
		receipt_days: null,
		receipt_restarts_daily: null,
	},
	data_quality_payments: {
		pos_account_id: null,
		payment_method_external_id: "unknown",
		payment_method_name: null,
		kind: "other",
		pos_kind: null,
		override_kind: null,
		in_catalogue: true,
		invoices: null,
		amount: null,
	},
};

const enumColumns: readonly [TenBFunction, string, string][] = [
	["promotion_days", "promotion_kind", "combo"],
	["promotion_catalogue", "promotion_kind", "invoice_total"],
	["promotion_compliance", "promotion_kind", "coupon"],
	["data_quality_items", "role", "dessert"],
	["data_quality_summary", "e_invoice_status", "pending"],
	["data_quality_summary", "tran_no_reset_period", "monthly"],
	["data_quality_summary", "member_capture_status", "partial"],
	["data_quality_payments", "kind", "crypto"],
	["data_quality_payments", "pos_kind", "crypto"],
	["data_quality_payments", "override_kind", "crypto"],
];

function missingArgumentTypes(
	types: Readonly<Record<string, string>>,
): string[] {
	return [
		...new Set(
			[...Object.values(analyticsFunctions), ...Object.values(themeFunctions)]
				.flatMap((entry) => Object.keys(entry.args.shape))
				.filter((name) => !Object.hasOwn(types, name)),
		),
	];
}

function parseRow(name: TenBFunction, row: Record<string, unknown>) {
	return themeFunctions[name].row.safeParse(row);
}

describe("the contracts of the 10b functions", () => {
	it("name every argument and column of the SQL signatures in order", () => {
		for (const name of TEN_B_FUNCTIONS) {
			expect(themeArgumentNames(name), name).toEqual(sqlArguments[name]);
			expect(themeRowColumns(name), name).toEqual(
				Object.keys(databaseRows[name]),
			);
		}
	});

	it("parse a row shaped like the function's columns, numeric strings turned into numbers", () => {
		for (const name of TEN_B_FUNCTIONS) {
			expect(parseRow(name, databaseRows[name]).success, name).toBe(true);
		}
		expect(
			themeFunctions.promotion_lift.row.parse(databaseRows.promotion_lift),
		).toMatchObject({
			business_date: null,
			gross_lift_amount: -45000,
			lift_rate: -0.0125,
			promo_days: 5,
			flags: ["unmeasured_days", "other_promotions"],
		});
		expect(
			themeFunctions.shift_adjustments.row.parse(
				databaseRows.shift_adjustments,
			),
		).toMatchObject({
			store_id: STORE_A,
			orders: 84,
			void_z_score: 2.41,
			removed_z_score: null,
			reasons: ["voids"],
		});
		expect(
			themeFunctions.promotion_days.row.parse(databaseRows.promotion_days),
		).toMatchObject({ store_id: null, invoices: 14, lines: 17 });
	});

	it("take null for the sums a function computes over no rows", () => {
		expect(
			parseRow("promotion_catalogue", {
				...databaseRows.promotion_catalogue,
				in_catalogue: true,
				catalogue_active: true,
				first_used_on: null,
				last_used_on: null,
				days_used_365: null,
				invoices_365: null,
				discount_365: null,
			}).success,
		).toBe(true);
		expect(
			parseRow("shift_adjustments", {
				...databaseRows.shift_adjustments,
				voids: 0,
				void_amount: null,
				removed_lines: 0,
				removed_amount: null,
			}).success,
		).toBe(true);
		expect(
			themeFunctions.data_quality_payments.row.parse({
				...databaseRows.data_quality_payments,
				invoices: "4",
				amount: "180000.00",
			}),
		).toMatchObject({ invoices: 4, amount: 180000 });
	});

	it("keep null flags and reasons, and refuse a flag list of numbers", () => {
		expect(
			parseRow("promotion_lift", {
				...databaseRows.promotion_lift,
				business_date: "2026-10-12",
				flags: null,
			}).success,
		).toBe(true);
		expect(
			parseRow("shift_adjustments", {
				...databaseRows.shift_adjustments,
				reasons: null,
			}).success,
		).toBe(true);
		expect(
			parseRow("promotion_lift", {
				...databaseRows.promotion_lift,
				flags: [1],
			}).success,
		).toBe(false);
	});

	it("refuse an unknown enum value in every enum column", () => {
		for (const [name, column, value] of enumColumns) {
			expect(
				parseRow(name, { ...databaseRows[name], [column]: value }).success,
				`${name}.${column}`,
			).toBe(false);
		}
	});

	it("refuse a row without a required column", () => {
		const { promotion_key: _dropped, ...withoutKey } =
			databaseRows.promotion_days;
		expect(parseRow("promotion_days", withoutKey).success).toBe(false);
	});

	it("check the arguments as the database does", () => {
		const range = {
			store_ids: [STORE_A],
			from_date: "2026-10-01",
			to_date: "2026-10-31",
		};
		const days = themeFunctions.promotion_days.args;
		expect(days.safeParse({ ...range, key_filter: "KM-01" }).success).toBe(
			false,
		);
		expect(
			days.safeParse({ ...range, kind_filter: "item", key_filter: "KM-01" })
				.success,
		).toBe(true);
		expect(days.safeParse({ ...range, kind_filter: "combo" }).success).toBe(
			false,
		);
		const lift = {
			store_ids: [STORE_A],
			promotion_kind: "bill",
			promotion_key: "unnamed",
			from_date: "2026-08-04",
			to_date: "2026-11-03",
			comparator: "prior_weeks",
		};
		const liftArgs = themeFunctions.promotion_lift.args;
		expect(liftArgs.safeParse(lift).success).toBe(true);
		expect(liftArgs.safeParse({ ...lift, pre_weeks: null }).success).toBe(true);
		expect(liftArgs.safeParse({ ...lift, pre_weeks: 1 }).success).toBe(false);
		expect(liftArgs.safeParse({ ...lift, pre_weeks: 9 }).success).toBe(false);
		expect(liftArgs.safeParse({ ...lift, comparator: "sister" }).success).toBe(
			false,
		);
		expect(liftArgs.safeParse({ ...lift, promotion_key: "" }).success).toBe(
			false,
		);
		const compliance = themeFunctions.promotion_compliance.args;
		expect(compliance.safeParse({ ...range, cap_rate: 0.5 }).success).toBe(
			true,
		);
		expect(compliance.safeParse({ ...range, cap_rate: 1 }).success).toBe(true);
		expect(compliance.safeParse({ ...range, cap_rate: 0 }).success).toBe(false);
		expect(compliance.safeParse({ ...range, cap_rate: 1.2 }).success).toBe(
			false,
		);
		const discountDays = themeFunctions.item_discount_days.args;
		expect(
			discountDays.safeParse({ store_ids: [STORE_A], calendar_year: 2022 })
				.success,
		).toBe(false);
		expect(
			discountDays.safeParse({
				store_ids: [STORE_A],
				calendar_year: 2026,
				as_of_date: null,
			}).success,
		).toBe(true);
		const shifts = themeFunctions.shift_adjustments.args;
		expect(shifts.safeParse({ ...range, z_threshold: 0 }).success).toBe(false);
		expect(shifts.safeParse({ ...range, z_threshold: null }).success).toBe(
			true,
		);
	});
});

describe("the SQL types of the arguments", () => {
	it("cover every argument of both registries", () => {
		expect(missingArgumentTypes(ARGUMENT_SQL_TYPES)).toEqual([]);
	});

	it("would miss an argument of a 10b function whose type were removed", () => {
		for (const name of [
			"kind_filter",
			"key_filter",
			"promotion_kind",
			"promotion_key",
			"comparator",
			"pre_weeks",
			"cap_rate",
			"calendar_year",
			"z_threshold",
		]) {
			const { [name]: _removed, ...rest } = ARGUMENT_SQL_TYPES;
			expect(missingArgumentTypes(rest), name).toEqual([name]);
		}
	});
});
