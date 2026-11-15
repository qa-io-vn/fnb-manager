import { DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SettingsWriteError } from "./source";
import {
	createSupabaseSettingsSource,
	REFRESH_CHUNK_DAYS,
	refreshWindow,
	writeErrorOf,
} from "./supabase-settings-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "55555555-5555-4555-8555-555555555555";

interface Recorded {
	table: string;
	calls: [string, unknown[]][];
}

type Result = { data: unknown; error: unknown };

function fakeClient(answer: (recorded: Recorded) => Result) {
	const log: Recorded[] = [];
	const builder = (table: string) => {
		const recorded: Recorded = { table, calls: [] };
		log.push(recorded);
		const result = Promise.resolve().then(() => answer(recorded));
		const methods: Record<string, unknown> = {};
		const chain = Object.assign(result, methods);
		for (const method of ["select", "eq", "order", "range", "upsert", "in"]) {
			methods[method] = (...args: unknown[]) => {
				recorded.calls.push([method, args]);
				return chain;
			};
		}
		Object.assign(chain, methods);
		return chain;
	};
	const client = {
		auth: {
			getUser: async () => ({ data: { user: { id: USER } }, error: null }),
		},
		from: builder,
		rpc: (name: string, args: unknown) => {
			const recorded = builder(`rpc:${name}`) as Record<string, unknown>;
			(log.at(-1) as Recorded).calls.push(["rpc", [args]]);
			return recorded;
		},
	};
	return { client: client as unknown as SupabaseClient, log };
}

describe("the Supabase settings source", () => {
	it("reads the member's role and scope for the tenant", async () => {
		const { client, log } = fakeClient(() => ({
			data: [{ role: "manager", store_ids: ["s1"] }],
			error: null,
		}));
		const source = createSupabaseSettingsSource(client);
		expect(await source.membership(TENANT)).toEqual({
			role: "manager",
			storeIds: ["s1"],
		});
		expect(log[0]?.calls).toContainEqual(["eq", ["user_id", USER]]);
	});

	it("pages item types and roles in a stable order and merges them", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.table === "item_types"
				? {
						data: [
							{
								pos_account_id: ACCOUNT,
								external_id: "T1",
								name: "Trà sữa",
								pos_accounts: { display_name: "POS 1" },
							},
							{
								pos_account_id: ACCOUNT,
								external_id: "T2",
								name: "Topping",
								pos_accounts: { display_name: "POS 1" },
							},
						],
						error: null,
					}
				: {
						data: [
							{
								pos_account_id: ACCOUNT,
								item_type_external_id: "T2",
								role: "topping",
							},
						],
						error: null,
					},
		);
		const source = createSupabaseSettingsSource(client);
		const types = await source.itemTypes(TENANT);
		expect(types.map((type) => [type.itemTypeExternalId, type.role])).toEqual([
			["T1", null],
			["T2", "topping"],
		]);
		const orders = (table: string) =>
			log
				.find((entry) => entry.table === table)
				?.calls.filter(([method]) => method === "order")
				.map(([, args]) => args[0]);
		expect(orders("item_types")).toEqual(["pos_account_id", "external_id"]);
		expect(orders("item_type_roles")).toEqual([
			"pos_account_id",
			"item_type_external_id",
		]);
	});

	it("upserts roles and thresholds on each table's unique key in one statement", async () => {
		const { client, log } = fakeClient(() => ({ data: null, error: null }));
		const source = createSupabaseSettingsSource(client);
		await source.saveRoles(TENANT, [
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T1", role: "drink" },
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T2", role: "snack" },
		]);
		await source.saveReportSettings(TENANT, DEFAULT_REPORT_SETTINGS);
		const upserts = log.map((entry) => [
			entry.table,
			entry.calls.find(([method]) => method === "upsert")?.[1][1],
		]);
		expect(upserts).toEqual([
			[
				"item_type_roles",
				{ onConflict: "pos_account_id,item_type_external_id" },
			],
			["report_settings", { onConflict: "tenant_id" }],
		]);
	});

	it("turns a refused write into a settings error", async () => {
		const { client } = fakeClient(() => ({
			data: null,
			error: {
				code: "42501",
				message: "new row violates row-level security policy",
			},
		}));
		const source = createSupabaseSettingsSource(client);
		await expect(
			source.saveReportSettings(TENANT, DEFAULT_REPORT_SETTINGS),
		).rejects.toEqual(new SettingsWriteError("forbidden"));
	});

	it.each([
		["42501", "forbidden", null],
		["23505", "duplicate", null],
		["23514", "invalid", "report_settings_menu_window_days_check"],
		["22023", "invalid", null],
		["55000", "frozen", null],
		["PGRST301", "forbidden", null],
		["23503", "invalid", null],
		["", "network", null],
		[undefined, "network", null],
	] as const)("maps %j to %s", (code, expected, constraint) => {
		const error = writeErrorOf({
			...(code === undefined ? {} : { code }),
			message:
				constraint === null
					? "refused"
					: `new row for relation "report_settings" violates check constraint "${constraint}"`,
		});
		expect(error.code).toBe(expected);
		expect(error.constraint).toBe(constraint);
	});

	it("refreshes the pending range in chunks of at most 92 days", () => {
		expect(
			refreshWindow({
				pendingFrom: "2026-01-01",
				pendingTo: "2026-11-14",
				pendingDays: 318,
				canRefresh: true,
			}),
		).toEqual({ from: "2026-01-01", to: "2026-04-02" });
		expect(REFRESH_CHUNK_DAYS).toBe(92);
		expect(
			refreshWindow({
				pendingFrom: "2026-11-01",
				pendingTo: "2026-11-14",
				pendingDays: 14,
				canRefresh: true,
			}),
		).toEqual({ from: "2026-11-01", to: "2026-11-14" });
		expect(
			refreshWindow({
				pendingFrom: null,
				pendingTo: null,
				pendingDays: 0,
				canRefresh: true,
			}),
		).toBeNull();
	});
});
