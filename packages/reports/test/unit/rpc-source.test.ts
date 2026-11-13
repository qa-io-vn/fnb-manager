import { describe, expect, it } from "vitest";
import {
	AnalyticsCallError,
	createRpcAnalyticsSource,
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	isArgumentLimitError,
	POSSIBLE_TRUNCATION_CODE,
	type RpcClient,
	TRUNCATION_ROW_LIMIT,
} from "../../src/index.js";
import { STORE_A, STORE_B } from "./fixtures.js";

interface RecordedCall {
	readonly fn: string;
	readonly args: Record<string, unknown>;
}

function client(
	respond: (call: RecordedCall) => {
		data: unknown;
		error: { message: string; code?: string } | null;
	},
): { client: RpcClient; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	return {
		calls,
		client: {
			rpc(fn, args) {
				const call = { fn, args };
				calls.push(call);
				return Promise.resolve(respond(call));
			},
		},
	};
}

const targetRow = { store_id: STORE_A, net_target_amount: "250000000.00" };

describe("createRpcAnalyticsSource", () => {
	it("calls the function by name and leaves optional arguments out", async () => {
		const fake = client(() => ({ data: [], error: null }));
		const source = createRpcAnalyticsSource(fake.client);
		await source.call("hourly_profile", {
			store_ids: [STORE_A],
			target_date: "2026-11-03",
		});
		expect(source.kind).toBe("supabase");
		expect(fake.calls).toEqual([
			{
				fn: "hourly_profile",
				args: { store_ids: [STORE_A], target_date: "2026-11-03" },
			},
		]);
		expect(Object.hasOwn(fake.calls[0]?.args ?? {}, "weeks")).toBe(false);
	});

	it("parses numbers from JSON numbers and from numeric strings", async () => {
		const fake = client(() => ({
			data: [targetRow, { store_id: STORE_B, net_target_amount: 125_000_000 }],
			error: null,
		}));
		const rows = await createRpcAnalyticsSource(fake.client, "postgres").call(
			"store_targets",
			{
				store_ids: [STORE_A, STORE_B],
				period_kind: "month",
				period_start: "2026-11-01",
			},
		);
		expect(rows).toEqual([
			{ store_id: STORE_A, net_target_amount: 250_000_000 },
			{ store_id: STORE_B, net_target_amount: 125_000_000 },
		]);
	});

	it("rejects invalid arguments before calling", async () => {
		const fake = client(() => ({ data: [], error: null }));
		const call = createRpcAnalyticsSource(fake.client).call("period_compare", {
			store_ids: [STORE_A],
			grain: "quarter" as "day",
			anchor: "2026-11-03",
		});
		await expect(call).rejects.toMatchObject({
			name: "AnalyticsCallError",
			functionName: "period_compare",
			code: INVALID_ARGUMENTS_CODE,
		});
		expect(fake.calls).toHaveLength(0);
	});

	it("carries the PostgREST error code", async () => {
		const fake = client(() => ({
			data: null,
			error: {
				message: "period_series returns at most 900 rows",
				code: "22023",
			},
		}));
		const call = createRpcAnalyticsSource(fake.client).call("period_series", {
			store_ids: [STORE_A],
			grain: "day",
			from_date: "2024-01-01",
			to_date: "2026-11-03",
		});
		await expect(call).rejects.toBeInstanceOf(AnalyticsCallError);
		await expect(call).rejects.toMatchObject({
			code: "22023",
			functionName: "period_series",
		});
		const failure = await call.catch((error: unknown) => error);
		expect(isArgumentLimitError(failure)).toBe(true);
		expect(
			isArgumentLimitError(new AnalyticsCallError("period_series", "500")),
		).toBe(false);
		expect(isArgumentLimitError(new Error("network"))).toBe(false);
	});

	it("sends include_stores to period_series only when it is set", async () => {
		const fake = client(() => ({ data: [], error: null }));
		const source = createRpcAnalyticsSource(fake.client);
		await source.call("period_series", {
			store_ids: [STORE_A],
			grain: "week",
			from_date: "2026-01-01",
			to_date: "2026-11-03",
			include_stores: false,
		});
		expect(fake.calls[0]?.args.include_stores).toBe(false);
	});

	it("treats a full page of rows as a possible truncation", async () => {
		const fake = client(() => ({
			data: Array.from({ length: TRUNCATION_ROW_LIMIT }, () => targetRow),
			error: null,
		}));
		await expect(
			createRpcAnalyticsSource(fake.client).call("store_targets", {
				store_ids: [STORE_A],
				period_kind: "month",
				period_start: "2026-11-01",
			}),
		).rejects.toMatchObject({ code: POSSIBLE_TRUNCATION_CODE });
	});

	it("rejects rows of the wrong shape and accepts no data as no rows", async () => {
		const wrong = client(() => ({
			data: [{ store_id: STORE_A, net_target_amount: null }],
			error: null,
		}));
		await expect(
			createRpcAnalyticsSource(wrong.client).call("store_targets", {
				store_ids: [STORE_A],
				period_kind: "month",
				period_start: "2026-11-01",
			}),
		).rejects.toMatchObject({ code: INVALID_ROWS_CODE });
		const empty = client(() => ({ data: null, error: null }));
		expect(
			await createRpcAnalyticsSource(empty.client).call("store_targets", {
				store_ids: [STORE_A],
				period_kind: "month",
				period_start: "2026-11-01",
			}),
		).toEqual([]);
	});
});
