import { describe, expect, it } from "vitest";
import {
	analyticsFunctionNames,
	argumentNames,
} from "../../../src/contract/functions.js";
import {
	createJsonRpcClient,
	INVALID_CALL_CODE,
	ReportJsonCallError,
	reportJsonStatement,
	type UnsafeQueryable,
} from "../../../src/source/json-rpc-client.js";
import {
	themeArgumentNames,
	themeFunctionNames,
} from "../../../src/themes/contract.js";
import { createRpcReportSource } from "../../../src/themes/source.js";
import { STORE_A, STORE_B } from "../fixtures.js";

const PREFIX =
	"select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) as rows from public.";

interface Seen {
	readonly query: string;
	readonly params: unknown;
}

function recordingQueryable(answer: readonly Record<string, unknown>[]): {
	queryable: UnsafeQueryable;
	seen: Seen[];
} {
	const seen: Seen[] = [];
	return {
		seen,
		queryable: {
			unsafe(query, params) {
				seen.push({ query, params });
				return Promise.resolve(answer);
			},
		},
	};
}

describe("reportJsonStatement", () => {
	it("binds an analytics function's arguments by name and SQL type", () => {
		const statement = reportJsonStatement("period_series", {
			store_ids: [STORE_A, STORE_B],
			grain: "week",
			from_date: "2026-08-10",
			to_date: "2026-11-08",
			include_stores: true,
			weeks: undefined,
		});
		expect(statement.text).toBe(
			`${PREFIX}period_series(store_ids => $1::uuid[], grain => $2::text, from_date => $3::date, to_date => $4::date, include_stores => $5::boolean) with ordinality as r`,
		);
		expect(statement.params).toEqual([
			`{"${STORE_A}","${STORE_B}"}`,
			"week",
			"2026-08-10",
			"2026-11-08",
			"true",
		]);
	});

	it("binds a theme function's arrays and numbers", () => {
		const statement = reportJsonStatement("metric_windows", {
			store_ids: [STORE_A],
			metric_ids: ["net_revenue", "avg_ticket"],
			from_dates: ["2026-10-15", "2026-09-17"],
			to_dates: ["2026-11-11", "2026-10-14"],
		});
		expect(statement.text).toBe(
			`${PREFIX}metric_windows(store_ids => $1::uuid[], metric_ids => $2::text[], from_dates => $3::date[], to_dates => $4::date[]) with ordinality as r`,
		);
		expect(statement.params).toEqual([
			`{"${STORE_A}"}`,
			'{"net_revenue","avg_ticket"}',
			'{"2026-10-15","2026-09-17"}',
			'{"2026-11-11","2026-10-14"}',
		]);
		const profile = reportJsonStatement("hour_profile", {
			store_ids: [STORE_A],
			from_date: "2026-08-20",
			to_date: "2026-11-11",
			peak_hours: 3,
			dead_hour_ratio: 0.5,
			busy_hour_ratio: null,
		});
		expect(profile.text).toContain(
			"peak_hours => $4::integer, dead_hour_ratio => $5::numeric, busy_hour_ratio => $6::numeric",
		);
		expect(profile.params.slice(3)).toEqual(["3", "0.5", null]);
	});

	it("writes array literals that quote and escape every element", () => {
		const statement = reportJsonStatement("metric_windows", {
			store_ids: [],
			metric_ids: ['quote"d', "back\\slash", "comma,brace}", null],
			from_dates: ["2026-10-15"],
			to_dates: ["2026-11-11"],
		});
		expect(statement.params[0]).toBe("{}");
		expect(statement.params[1]).toBe(
			'{"quote\\"d","back\\\\slash","comma,brace}",NULL}',
		);
	});

	it("refuses an unknown function, an unknown argument and unsupported values with invalid_call", () => {
		for (const call of [
			() => reportJsonStatement("pg_sleep", {}),
			() => reportJsonStatement("store_profiles; drop table stores", {}),
			() => reportJsonStatement("metric_value", { store_ids: [] }),
			() => reportJsonStatement("store_profiles", { store_ids: [], evil: 1 }),
			() =>
				reportJsonStatement("holiday_calendar", {
					store_ids: [STORE_A],
					from_date: { at: "2026-11-12" },
				}),
			() =>
				reportJsonStatement("hour_profile", {
					store_ids: [STORE_A],
					peak_hours: Number.NaN,
				}),
			() =>
				reportJsonStatement("store_profiles", { store_ids: [{ id: STORE_A }] }),
		]) {
			expect(call).toThrow(ReportJsonCallError);
			try {
				call();
			} catch (error) {
				expect((error as ReportJsonCallError).code).toBe(INVALID_CALL_CODE);
			}
		}
		expect(() =>
			reportJsonStatement("store_profiles", { store_ids: [], evil: 1 }),
		).toThrow("store_profiles takes no argument named evil");
	});

	it("builds a statement for every argument of every function of both registries", () => {
		for (const name of analyticsFunctionNames) {
			const args = Object.fromEntries(
				argumentNames(name).map((argument) => [argument, "x"]),
			);
			expect(() => reportJsonStatement(name, args), name).not.toThrow();
		}
		for (const name of themeFunctionNames) {
			const args = Object.fromEntries(
				themeArgumentNames(name).map((argument) => [argument, "x"]),
			);
			expect(() => reportJsonStatement(name, args), name).not.toThrow();
		}
	});
});

describe("createJsonRpcClient", () => {
	it("returns the aggregated rows as data", async () => {
		const { queryable, seen } = recordingQueryable([
			{ rows: [{ holiday_date: "2027-02-06", name: "Tết", kind: "tet" }] },
		]);
		const answer = await createJsonRpcClient(queryable).rpc(
			"holiday_calendar",
			{ store_ids: [STORE_A], from_date: "2026-11-12", to_date: "2027-02-09" },
		);
		expect(answer).toEqual({
			data: [{ holiday_date: "2027-02-06", name: "Tết", kind: "tet" }],
			error: null,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]?.params).toEqual([
			`{"${STORE_A}"}`,
			"2026-11-12",
			"2027-02-09",
		]);
		const empty = await createJsonRpcClient(
			recordingQueryable([{ rows: null }]).queryable,
		).rpc("store_profiles", { store_ids: [] });
		expect(empty).toEqual({ data: [], error: null });
	});

	it("answers invalid_call without touching the database", async () => {
		const { queryable, seen } = recordingQueryable([]);
		const answer = await createJsonRpcClient(queryable).rpc("drop_everything", {
			store_ids: [],
		});
		expect(answer.data).toBeNull();
		expect(answer.error?.code).toBe(INVALID_CALL_CODE);
		expect(seen).toEqual([]);
	});

	it("keeps the SQLSTATE of a database error, and its message only for a limit", async () => {
		const failing = (error: unknown) =>
			createJsonRpcClient({ unsafe: () => Promise.reject(error) });
		const limit = await failing(
			Object.assign(
				new Error("metric_windows covers at most 400 days, not 401"),
				{
					code: "22023",
				},
			),
		).rpc("metric_windows", {
			store_ids: [STORE_A],
			metric_ids: ["net_revenue"],
			from_dates: ["2025-10-01"],
			to_dates: ["2026-11-05"],
		});
		expect(limit.error).toEqual({
			message: "metric_windows covers at most 400 days, not 401",
			code: "22023",
		});
		const denied = await failing(
			Object.assign(new Error(`permission denied for ${STORE_A}`), {
				code: "42501",
			}),
		).rpc("store_profiles", { store_ids: [STORE_A] });
		expect(denied.error).toEqual({
			message: "store_profiles failed in the database",
			code: "42501",
		});
		const unknown = await failing("socket closed").rpc("store_profiles", {
			store_ids: [STORE_A],
		});
		expect(unknown.error).toEqual({
			message: "store_profiles failed in the database",
		});
	});

	it("feeds createRpcReportSource, which parses the rows of a theme function", async () => {
		const { queryable } = recordingQueryable([
			{
				rows: [
					{
						range_index: 1,
						from_date: "2026-10-15",
						to_date: "2026-11-11",
						metric_id: "avg_ticket",
						value: 52314.27,
					},
				],
			},
		]);
		const source = createRpcReportSource(
			createJsonRpcClient(queryable),
			"postgres",
		);
		expect(source.kind).toBe("postgres");
		expect(
			await source.callTheme("metric_windows", {
				store_ids: [STORE_A],
				metric_ids: ["avg_ticket"],
				from_dates: ["2026-10-15"],
				to_dates: ["2026-11-11"],
			}),
		).toEqual([
			{
				range_index: 1,
				from_date: "2026-10-15",
				to_date: "2026-11-11",
				metric_id: "avg_ticket",
				value: 52314.27,
			},
		]);
	});
});
