import { createRpcReportSource } from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../src/pack/build.js";
import { comparePackTexts } from "../../src/pack/invariants.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_FOCUS,
} from "./support/demo.js";
import { rpcClientOver } from "./support/sources.js";

const LIVE_IDS = new Map([
	["MOCK-S1", "22222222-2222-4222-8222-000000000001"],
	["MOCK-S2", "22222222-2222-4222-8222-000000000002"],
]);

const LIVE_REQUEST = demoRequest({
	storeIds: [...LIVE_IDS.values()].reverse(),
	sample: false,
	focus: GOLDEN_FOCUS,
});

describe("the same rows through two transports", () => {
	let postgrest: BuiltPack;
	let jsonb: BuiltPack;

	beforeAll(async () => {
		const base = demoSource();
		postgrest = await buildWith(
			createRpcReportSource(
				rpcClientOver(base, "postgrest", LIVE_IDS),
				"supabase",
			),
			LIVE_REQUEST,
		);
		jsonb = await buildWith(
			createRpcReportSource(rpcClientOver(base, "jsonb", LIVE_IDS), "postgres"),
			LIVE_REQUEST,
		);
	});

	it("serves rows shaped differently, keys in another order and 1.50 for 1.5", async () => {
		const base = demoSource();
		const one = await rpcClientOver(base, "postgrest", LIVE_IDS).rpc(
			"metric_windows",
			{
				store_ids: [...LIVE_IDS.values()],
				metric_ids: ["avg_ticket"],
				from_dates: ["2026-10-15"],
				to_dates: ["2026-11-11"],
			},
		);
		const two = await rpcClientOver(base, "jsonb", LIVE_IDS).rpc(
			"metric_windows",
			{
				store_ids: [...LIVE_IDS.values()],
				metric_ids: ["avg_ticket"],
				from_dates: ["2026-10-15"],
				to_dates: ["2026-11-11"],
			},
		);
		const [first] = one.data as Record<string, unknown>[];
		const [second] = two.data as Record<string, unknown>[];
		expect(Object.keys(first ?? {})).not.toEqual(Object.keys(second ?? {}));
		expect(typeof first?.value).toBe("number");
		expect(second?.value).toBe(`${String(first?.value)}0`);
	});

	it("produces the same bytes and the same pack id", async () => {
		expect(jsonb.text).toBe(postgrest.text);
		expect(jsonb.packId).toBe(postgrest.packId);
		const comparison = await comparePackTexts(postgrest.text, jsonb.text);
		expect(comparison).toEqual({
			valid: true,
			identical_apart_from_generated_at: true,
			pack_id_equal: true,
			tables_differing: [],
		});
	});

	it("records equal rows for every call of both transports", () => {
		expect(jsonb.calls.map((call) => call.key)).toEqual(
			postgrest.calls.map((call) => call.key),
		);
		jsonb.calls.forEach((call, index) => {
			expect(call.args).toEqual(postgrest.calls[index]?.args);
			expect(call.rows).toEqual(postgrest.calls[index]?.rows);
		});
	});

	it("builds a live pack with the UUIDs in request.stores only", () => {
		expect(postgrest.pack.sample).toBe(false);
		expect(postgrest.pack.request.stores.map((store) => store.id)).toEqual([
			...LIVE_IDS.values(),
		]);
		const tablesText = JSON.stringify(postgrest.pack.tables);
		for (const id of LIVE_IDS.values()) expect(tablesText).not.toContain(id);
	});
});
