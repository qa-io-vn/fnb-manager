import {
	analyticsFunctionNames,
	argumentNames,
	createRpcAnalyticsSource,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	ARGUMENT_TYPES,
	jsonRpcClient,
	jsonStatementFor,
	recordedRows,
	recordingSource,
	type UnsafeQueryable,
} from "../../../src/index.js";
import { STORE_A, STORE_B } from "../../fixtures/ngay-rows.js";

describe("JSON analytics source", () => {
	it("has a type for every argument of every analytics function", () => {
		for (const name of analyticsFunctionNames) {
			for (const argument of argumentNames(name)) {
				expect(ARGUMENT_TYPES[argument], `${name}.${argument}`).toBeDefined();
			}
		}
	});

	it("aggregates the rows to JSON in order and binds each argument by name and type", () => {
		const statement = jsonStatementFor("period_compare_by_store", {
			store_ids: [STORE_A, STORE_B],
			grain: "day",
			anchor: "2026-11-07",
		});
		expect(statement.text).toBe(
			"select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) as rows from public.period_compare_by_store(store_ids => $1::uuid[], grain => $2::text, anchor => $3::date) with ordinality as r",
		);
		expect(statement.params).toEqual([
			`{"${STORE_A}","${STORE_B}"}`,
			"day",
			"2026-11-07",
		]);
		const series = jsonStatementFor("period_series", {
			store_ids: [STORE_A],
			grain: "day",
			from_date: "2026-11-07",
			to_date: "2026-11-07",
			include_stores: false,
			weeks: undefined,
		});
		expect(series.text).toContain("include_stores => $5::boolean");
		expect(series.params[4]).toBe("false");
		const shifts = jsonStatementFor("shift_review", {
			store_ids: [STORE_A],
			from_date: "2026-11-07",
			to_date: "2026-11-07",
			abs_threshold: 50_000,
		});
		expect(shifts.text).toContain("abs_threshold => $4::numeric");
		expect(shifts.params[3]).toBe("50000");
	});

	it("refuses an unknown function or argument", () => {
		expect(() => jsonStatementFor("pg_sleep", {})).toThrow(
			"not an analytics function",
		);
		expect(() =>
			jsonStatementFor("store_coverage", { store_ids: [], evil: "x" }),
		).toThrow("store_coverage takes no argument named evil");
	});

	it("returns the aggregated array as data, and errors without the statement or values", async () => {
		const seen: { query: string; params: unknown }[] = [];
		const queryable: UnsafeQueryable = {
			unsafe(query, params) {
				seen.push({ query, params });
				return Promise.resolve([{ rows: [{ store_id: STORE_A }] }]);
			},
		};
		const client = jsonRpcClient(queryable);
		expect(
			await client.rpc("store_coverage", {
				store_ids: [STORE_A],
				from_date: "2026-11-07",
				to_date: "2026-11-07",
			}),
		).toEqual({ data: [{ store_id: STORE_A }], error: null });
		const refused = await client.rpc("drop_everything", {});
		expect(refused.error?.code).toBe("invalid_call");
		expect(seen).toHaveLength(1);
		const failing = jsonRpcClient({
			unsafe: () =>
				Promise.reject(
					Object.assign(new Error(`relation for ${STORE_A} failed`), {
						code: "42501",
					}),
				),
		});
		const answer = await failing.rpc("store_coverage", {
			store_ids: [STORE_A],
			from_date: "2026-11-07",
			to_date: "2026-11-07",
		});
		expect(answer.error).toEqual({
			message: "store_coverage failed in the database",
			code: "42501",
		});
	});

	it("records every call and its rows for the day rules", async () => {
		const source = recordingSource(
			createRpcAnalyticsSource(
				{
					rpc: async () => ({
						data: [
							{
								store_id: STORE_A,
								opened_on: null,
								first_sales_on: null,
								last_sales_on: null,
								history_start: null,
								store_as_of_date: "2026-11-07",
								sales_days: 0,
								checked_days: 0,
								matched_days: 0,
								unmatched_days: 0,
								unchecked_sales_days: 0,
								stale_days: 0,
								last_refreshed_at: null,
							},
						],
						error: null,
					}),
				},
				"postgres",
			),
		);
		await source.call("store_coverage", {
			store_ids: [STORE_A],
			from_date: "2026-11-07",
			to_date: "2026-11-07",
		});
		const calls = source.recorded();
		expect(calls).toHaveLength(1);
		expect(recordedRows(calls, "store_coverage")[0]?.store_id).toBe(STORE_A);
		expect(recordedRows(calls, "shift_review")).toEqual([]);
	});
});
