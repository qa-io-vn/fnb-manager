import { describe, expect, it } from "vitest";
import { analyticsFunctions } from "../../../src/contract/functions.js";
import { TRUNCATION_ROW_LIMIT } from "../../../src/source/rpc-source.js";
import {
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	POSSIBLE_TRUNCATION_CODE,
	type RpcClient,
} from "../../../src/source/source.js";
import { ARGUMENT_SQL_TYPES } from "../../../src/themes/argument-types.js";
import { themeFunctions } from "../../../src/themes/contract.js";
import {
	createRpcReportSource,
	isReportFunctionName,
	ThemeCallError,
} from "../../../src/themes/source.js";
import { STORE_A } from "./fixtures.js";

function client(
	respond: (fn: string) => {
		data: unknown;
		error: { message: string; code?: string } | null;
	},
): { client: RpcClient; calls: { fn: string; args: unknown }[] } {
	const calls: { fn: string; args: unknown }[] = [];
	return {
		calls,
		client: {
			rpc(fn, args) {
				calls.push({ fn, args });
				return Promise.resolve(respond(fn));
			},
		},
	};
}

const modifierRow = {
	modifier_name: "Ít đá",
	lines: "12",
	share: "0.250000",
	compare_lines: null,
	compare_share: null,
};

describe("createRpcReportSource", () => {
	it("serves both registries through one client", async () => {
		const fake = client((fn) => ({
			data: fn === "modifier_summary" ? [modifierRow] : [],
			error: null,
		}));
		const source = createRpcReportSource(fake.client, "postgres");
		expect(source.kind).toBe("postgres");
		await source.call("store_coverage", {
			store_ids: [STORE_A],
			from_date: "2026-10-10",
			to_date: "2026-11-06",
		});
		const rows = await source.callTheme("modifier_summary", {
			store_ids: [STORE_A],
			from_date: "2026-10-10",
			to_date: "2026-11-06",
		});
		expect(fake.calls.map((call) => call.fn)).toEqual([
			"store_coverage",
			"modifier_summary",
		]);
		expect(fake.calls[1]?.args).toEqual({
			store_ids: [STORE_A],
			from_date: "2026-10-10",
			to_date: "2026-11-06",
		});
		expect(rows).toEqual([
			{
				modifier_name: "Ít đá",
				lines: 12,
				share: 0.25,
				compare_lines: null,
				compare_share: null,
			},
		]);
	});

	it("refuses range lists of different lengths before calling", async () => {
		const fake = client(() => ({ data: [], error: null }));
		const source = createRpcReportSource(fake.client);
		await expect(
			source.callTheme("range_totals", {
				store_ids: [STORE_A],
				from_dates: ["2026-10-01", "2026-09-01"],
				to_dates: ["2026-10-31"],
			}),
		).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		expect(fake.calls).toEqual([]);
	});

	it("passes database errors on with their SQLSTATE", async () => {
		const fake = client(() => ({
			data: null,
			error: {
				message: "hour_profile accepts at most 400 days",
				code: "22023",
			},
		}));
		const source = createRpcReportSource(fake.client);
		const error = await source
			.callTheme("hour_profile", {
				store_ids: [STORE_A],
				from_date: "2025-01-01",
				to_date: "2026-11-06",
			})
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ThemeCallError);
		expect(error).toMatchObject({
			code: "22023",
			functionName: "hour_profile",
		});
	});

	it("refuses rows of the wrong shape and a possibly truncated answer", async () => {
		const wrong = createRpcReportSource(
			client(() => ({ data: [{ modifier_name: 3 }], error: null })).client,
		);
		await expect(
			wrong.callTheme("modifier_summary", {
				store_ids: [STORE_A],
				from_date: "2026-10-10",
				to_date: "2026-11-06",
			}),
		).rejects.toMatchObject({ code: INVALID_ROWS_CODE });
		const many = createRpcReportSource(
			client(() => ({
				data: Array.from({ length: TRUNCATION_ROW_LIMIT }, () => modifierRow),
				error: null,
			})).client,
		);
		await expect(
			many.callTheme("modifier_summary", {
				store_ids: [STORE_A],
				from_date: "2026-10-10",
				to_date: "2026-11-06",
			}),
		).rejects.toMatchObject({ code: POSSIBLE_TRUNCATION_CODE });
	});

	it("calls each 10b function with named arguments", async () => {
		const range = {
			store_ids: [STORE_A],
			from_date: "2026-10-01",
			to_date: "2026-10-31",
		};
		const calls = [
			[
				"promotion_days",
				{ ...range, kind_filter: "item", key_filter: "KM-01" },
			],
			[
				"promotion_catalogue",
				{ store_ids: [STORE_A], as_of_date: "2026-10-31" },
			],
			[
				"promotion_lift",
				{
					store_ids: [STORE_A],
					promotion_kind: "voucher",
					promotion_key: "Giảm 20k",
					from_date: "2026-08-01",
					to_date: "2026-10-31",
					comparator: "sister_store",
					pre_weeks: 6,
				},
			],
			["promotion_compliance", { ...range, cap_rate: 0.5 }],
			[
				"item_discount_days",
				{
					store_ids: [STORE_A],
					calendar_year: 2026,
					as_of_date: "2026-10-31",
				},
			],
			["shift_adjustments", { ...range, z_threshold: 2.5 }],
			["data_quality_items", range],
			["data_quality_summary", range],
			["data_quality_payments", range],
		] as const;
		const fake = client(() => ({ data: [], error: null }));
		const source = createRpcReportSource(fake.client);
		for (const [name, args] of calls) {
			await expect(
				source.callTheme(name, args as never),
				name,
			).resolves.toEqual([]);
		}
		expect(fake.calls).toEqual(
			calls.map(([name, args]) => ({ fn: name, args })),
		);
	});

	it("maps a 10b function's database error, a row of the wrong shape and a possibly truncated answer as phase 9 does", async () => {
		const lift = {
			store_ids: [STORE_A],
			promotion_kind: "item" as const,
			promotion_key: "KM-01",
			from_date: "2026-07-01",
			to_date: "2026-10-31",
			comparator: "baseline" as const,
		};
		const refused = createRpcReportSource(
			client(() => ({
				data: null,
				error: {
					message: "promotion_lift covers at most 92 days",
					code: "22023",
				},
			})).client,
		);
		const error = await refused
			.callTheme("promotion_lift", lift)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ThemeCallError);
		expect(error).toMatchObject({
			code: "22023",
			functionName: "promotion_lift",
		});
		const range = {
			store_ids: [STORE_A],
			from_date: "2026-10-01",
			to_date: "2026-10-31",
		};
		const paymentRow = {
			pos_account_id: null,
			payment_method_external_id: "unknown",
			payment_method_name: null,
			kind: "other",
			pos_kind: null,
			override_kind: null,
			in_catalogue: true,
			invoices: null,
			amount: null,
		};
		const many = createRpcReportSource(
			client(() => ({
				data: Array.from({ length: TRUNCATION_ROW_LIMIT }, () => paymentRow),
				error: null,
			})).client,
		);
		await expect(
			many.callTheme("data_quality_payments", range),
		).rejects.toMatchObject({ code: POSSIBLE_TRUNCATION_CODE });
		const wrongKind = createRpcReportSource(
			client(() => ({
				data: [{ ...paymentRow, kind: "crypto" }],
				error: null,
			})).client,
		);
		await expect(
			wrongKind.callTheme("data_quality_payments", range),
		).rejects.toMatchObject({ code: INVALID_ROWS_CODE });
		const parsed = await createRpcReportSource(
			client(() => ({ data: [paymentRow], error: null })).client,
		).callTheme("data_quality_payments", range);
		expect(parsed).toEqual([paymentRow]);
	});

	it("knows the names of both registries", () => {
		expect(isReportFunctionName("item_summary")).toBe(true);
		expect(isReportFunctionName("hour_profile")).toBe(true);
		expect(isReportFunctionName("menu_matrix")).toBe(false);
	});
});

describe("ARGUMENT_SQL_TYPES", () => {
	it("has a SQL type for every argument of every function in both registries", () => {
		const missing = [
			...Object.values(analyticsFunctions),
			...Object.values(themeFunctions),
		]
			.flatMap((entry) => Object.keys(entry.args.shape))
			.filter((name) => !Object.hasOwn(ARGUMENT_SQL_TYPES, name));
		expect(missing).toEqual([]);
	});
});
