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
const OTHER_USER = "66666666-6666-4666-8666-666666666666";
const CHANGED_AT = "2026-11-14T17:30:00+00:00";

interface Recorded {
	table: string;
	calls: [string, unknown[]][];
}

type Result = { data: unknown; error: unknown };

function storedRow(overrides: Record<string, unknown> = {}) {
	return {
		menu_window_days: 28,
		menu_popularity_factor: "0.700",
		menu_low_sample_items: 10,
		cash_abs_threshold: "50000.00",
		cash_rel_threshold: "0.0050",
		peak_hours: 3,
		dead_hour_ratio: "0.500",
		busy_hour_ratio: "1.250",
		promo_pre_weeks: 4,
		updated_at: CHANGED_AT,
		updated_by: USER,
		...overrides,
	};
}

function fakeClient(answer: (recorded: Recorded) => Result, signedIn = true) {
	const log: Recorded[] = [];
	const builder = (table: string) => {
		const recorded: Recorded = { table, calls: [] };
		log.push(recorded);
		const result = Promise.resolve().then(() => answer(recorded));
		const methods: Record<string, unknown> = {};
		const chain = Object.assign(result, methods);
		for (const method of [
			"select",
			"eq",
			"order",
			"range",
			"upsert",
			"in",
			"delete",
		]) {
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
			getUser: async () =>
				signedIn
					? { data: { user: { id: USER } }, error: null }
					: { data: { user: null }, error: { message: "offline" } },
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

	it("reads the thresholds with when they last changed and the role of who changed them", async () => {
		const row = (updatedBy: string | null) => ({
			menu_window_days: 21,
			menu_popularity_factor: "0.650",
			menu_low_sample_items: 8,
			cash_abs_threshold: "80000.00",
			cash_rel_threshold: "0.0075",
			peak_hours: 4,
			dead_hour_ratio: "0.400",
			busy_hour_ratio: "1.300",
			promo_pre_weeks: 4,
			updated_at: CHANGED_AT,
			updated_by: updatedBy,
		});
		const answering = (updatedBy: string | null) => (recorded: Recorded) =>
			recorded.table === "tenant_members"
				? {
						data: [
							{ user_id: USER, role: "owner" },
							{ user_id: OTHER_USER, role: "manager" },
						],
						error: null,
					}
				: { data: [row(updatedBy)], error: null };

		const byManager = fakeClient(answering(OTHER_USER));
		expect(
			await createSupabaseSettingsSource(byManager.client).reportSettings(
				TENANT,
			),
		).toEqual({
			hasRow: true,
			settings: {
				menuWindowDays: 21,
				menuPopularityFactor: 0.65,
				menuLowSampleItems: 8,
				cashAbsThreshold: 80_000,
				cashRelThreshold: 0.0075,
				peakHours: 4,
				deadHourRatio: 0.4,
				busyHourRatio: 1.3,
				promoPreWeeks: 4,
			},
			audit: {
				changedAt: CHANGED_AT,
				author: { kind: "member", role: "manager" },
			},
		});
		expect(byManager.log.map((entry) => entry.table)).toEqual([
			"report_settings",
			"tenant_members",
		]);
		expect(byManager.log[1]?.calls).toContainEqual([
			"select",
			["user_id,role"],
		]);

		const byMe = fakeClient(answering(USER));
		expect(
			(await createSupabaseSettingsSource(byMe.client).reportSettings(TENANT))
				.audit,
		).toEqual({ changedAt: CHANGED_AT, author: { kind: "you" } });
		expect(byMe.log.map((entry) => entry.table)).toEqual(["report_settings"]);

		const byService = fakeClient(answering(null));
		expect(
			(
				await createSupabaseSettingsSource(byService.client).reportSettings(
					TENANT,
				)
			).audit,
		).toEqual({ changedAt: CHANGED_AT, author: { kind: "unknown" } });
		expect(byService.log.map((entry) => entry.table)).toEqual([
			"report_settings",
		]);
	});

	it("reads the defaults, without an audit line, for a tenant without a row", async () => {
		const { client } = fakeClient(() => ({ data: [], error: null }));
		expect(
			await createSupabaseSettingsSource(client).reportSettings(TENANT),
		).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		});
	});

	it("still reads the thresholds when the members cannot be read, naming no author", async () => {
		const { client } = fakeClient((recorded) =>
			recorded.table === "tenant_members"
				? { data: null, error: { message: "timeout" } }
				: {
						data: [
							{
								menu_window_days: 28,
								menu_popularity_factor: "0.700",
								menu_low_sample_items: 10,
								cash_abs_threshold: "50000.00",
								cash_rel_threshold: "0.0050",
								peak_hours: 3,
								dead_hour_ratio: "0.500",
								busy_hour_ratio: "1.250",
								promo_pre_weeks: 4,
								updated_at: CHANGED_AT,
								updated_by: OTHER_USER,
							},
						],
						error: null,
					},
		);
		const state =
			await createSupabaseSettingsSource(client).reportSettings(TENANT);
		expect(state.settings).toEqual(DEFAULT_REPORT_SETTINGS);
		expect(state.audit).toEqual({
			changedAt: CHANGED_AT,
			author: { kind: "unknown" },
		});
	});

	it("still reads the thresholds when the signed-in member cannot be read, naming no author", async () => {
		const { client } = fakeClient(
			() => ({ data: [storedRow({ updated_by: OTHER_USER })], error: null }),
			false,
		);
		const state =
			await createSupabaseSettingsSource(client).reportSettings(TENANT);
		expect(state.settings).toEqual(DEFAULT_REPORT_SETTINGS);
		expect(state.audit).toEqual({
			changedAt: CHANGED_AT,
			author: { kind: "unknown" },
		});
	});

	it("writes only the changed thresholds, in one upsert that hands the row back", async () => {
		const { client, log } = fakeClient(() => ({
			data: [storedRow({ peak_hours: 4, cash_abs_threshold: "80000.00" })],
			error: null,
		}));
		await createSupabaseSettingsSource(client).saveReportSettings(TENANT, {
			peakHours: 4,
		});
		expect(log).toHaveLength(1);
		expect(log[0]?.table).toBe("report_settings");
		expect(log[0]?.calls[0]).toEqual([
			"upsert",
			[{ tenant_id: TENANT, peak_hours: 4 }, { onConflict: "tenant_id" }],
		]);
		expect(log[0]?.calls[1]?.[0]).toBe("select");
	});

	it("removes the tenant's row, only while it still holds the defaults, when the save leaves every threshold at its default", async () => {
		const { client, log } = fakeClient(() => ({
			data: [storedRow()],
			error: null,
		}));
		await createSupabaseSettingsSource(client).saveReportSettings(TENANT, {
			peakHours: 3,
		});
		expect(log.map((entry) => entry.calls[0]?.[0])).toEqual([
			"upsert",
			"delete",
		]);
		expect(log[1]?.calls).toEqual([
			["delete", []],
			["eq", ["tenant_id", TENANT]],
			["eq", ["menu_window_days", 28]],
			["eq", ["menu_popularity_factor", 0.7]],
			["eq", ["menu_low_sample_items", 10]],
			["eq", ["cash_abs_threshold", 50_000]],
			["eq", ["cash_rel_threshold", 0.005]],
			["eq", ["peak_hours", 3]],
			["eq", ["dead_hour_ratio", 0.5]],
			["eq", ["busy_hour_ratio", 1.25]],
			["eq", ["promo_pre_weeks", 4]],
		]);
	});

	it("keeps a row that still holds a value of another page", async () => {
		const { client, log } = fakeClient(() => ({
			data: [storedRow({ promo_pre_weeks: 6 })],
			error: null,
		}));
		await createSupabaseSettingsSource(client).saveReportSettings(TENANT, {
			peakHours: 3,
		});
		expect(log).toHaveLength(1);
	});

	it("counts the save as done when only the removal of the default row failed", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.calls.some(([method]) => method === "delete")
				? { data: null, error: { message: "timeout" } }
				: { data: [storedRow()], error: null },
		);
		await expect(
			createSupabaseSettingsSource(client).saveReportSettings(TENANT, {
				peakHours: 3,
			}),
		).resolves.toBeUndefined();
		expect(log).toHaveLength(2);
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
