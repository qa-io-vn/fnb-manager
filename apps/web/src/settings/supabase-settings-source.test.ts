import { DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SettingsWriteError, writeCodeOf } from "./source";
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

function statusRow(from: string | null, to: string | null, days: number) {
	return {
		tenant_id: TENANT,
		inputs_changed_at: CHANGED_AT,
		history_from: "2026-01-01",
		history_to: "2026-11-15",
		pending_from: from,
		pending_to: to,
		pending_days: days,
		can_refresh: true,
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
			"is",
			"gte",
			"lte",
			"update",
			"insert",
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
								updated_at: CHANGED_AT,
								updated_by: USER,
							},
						],
						error: null,
					},
		);
		const source = createSupabaseSettingsSource(client);
		const types = await source.itemTypes(TENANT);
		expect(
			types.map((type) => [type.itemTypeExternalId, type.role, type.audit]),
		).toEqual([
			["T1", null, null],
			["T2", "topping", { changedAt: CHANGED_AT, author: { kind: "you" } }],
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

	it("deletes a cleared role per POS account, after one upsert of the assigned ones", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.calls.some(([method]) => method === "delete")
				? {
						data: [{ item_type_external_id: "T2" }],
						error: null,
					}
				: { data: null, error: null },
		);
		await createSupabaseSettingsSource(client).saveRoles(TENANT, [
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T1", role: "drink" },
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T2", role: null },
		]);
		expect(log).toHaveLength(2);
		expect(log[0]?.calls[0]).toEqual([
			"upsert",
			[
				[
					{
						tenant_id: TENANT,
						pos_account_id: ACCOUNT,
						item_type_external_id: "T1",
						role: "drink",
					},
				],
				{ onConflict: "pos_account_id,item_type_external_id" },
			],
		]);
		expect(log[1]?.calls).toEqual([
			["delete", []],
			["eq", ["tenant_id", TENANT]],
			["eq", ["pos_account_id", ACCOUNT]],
			["in", ["item_type_external_id", ["T2"]]],
			["select", ["item_type_external_id"]],
		]);
	});

	it("deletes the cleared roles of each POS account under its own account", async () => {
		const OTHER_ACCOUNT = "77777777-7777-4777-8777-777777777777";
		const { client, log } = fakeClient((recorded) => {
			const ids = recorded.calls.find(([method]) => method === "in")?.[1][1];
			return {
				data: (ids as string[]).map((id) => ({ item_type_external_id: id })),
				error: null,
			};
		});
		await createSupabaseSettingsSource(client).saveRoles(TENANT, [
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T1", role: null },
			{ posAccountId: OTHER_ACCOUNT, itemTypeExternalId: "T1", role: null },
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T3", role: null },
		]);
		const deletes = log.map((entry) => [
			entry.calls.find(
				([method, args]) => method === "eq" && args[0] === "pos_account_id",
			)?.[1][1],
			entry.calls.find(([method]) => method === "in")?.[1][1],
		]);
		expect(deletes).toEqual([
			[ACCOUNT, ["T1", "T3"]],
			[OTHER_ACCOUNT, ["T1"]],
		]);
	});

	it("sends nothing for no change and no upsert when roles are only cleared", async () => {
		const none = fakeClient(() => ({ data: [], error: null }));
		await createSupabaseSettingsSource(none.client).saveRoles(TENANT, []);
		expect(none.log).toHaveLength(0);
		const cleared = fakeClient(() => ({
			data: [{ item_type_external_id: "T2" }],
			error: null,
		}));
		await createSupabaseSettingsSource(cleared.client).saveRoles(TENANT, [
			{ posAccountId: ACCOUNT, itemTypeExternalId: "T2", role: null },
		]);
		expect(cleared.log.map((entry) => entry.calls[0]?.[0])).toEqual(["delete"]);
	});

	it("reports a cleared role that row-level security kept, and accepts one that was already gone", async () => {
		const isDelete = (recorded: Recorded) =>
			recorded.calls.some(([method]) => method === "delete");
		const kept = fakeClient((recorded) =>
			isDelete(recorded)
				? { data: [], error: null }
				: { data: [{ item_type_external_id: "T2" }], error: null },
		);
		await expect(
			createSupabaseSettingsSource(kept.client).saveRoles(TENANT, [
				{ posAccountId: ACCOUNT, itemTypeExternalId: "T2", role: null },
			]),
		).rejects.toEqual(new SettingsWriteError("forbidden"));
		const gone = fakeClient(() => ({ data: [], error: null }));
		await expect(
			createSupabaseSettingsSource(gone.client).saveRoles(TENANT, [
				{ posAccountId: ACCOUNT, itemTypeExternalId: "T2", role: null },
			]),
		).resolves.toBeUndefined();
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

	it("refreshes the newest pending days first, at most 92 days at a time", () => {
		const pending = (from: string | null, to: string | null, days: number) => ({
			inputsChangedAt: null,
			pendingFrom: from,
			pendingTo: to,
			pendingDays: days,
			canRefresh: true,
		});
		expect(refreshWindow(pending("2026-01-01", "2026-11-14", 318))).toEqual({
			from: "2026-08-15",
			to: "2026-11-14",
		});
		expect(REFRESH_CHUNK_DAYS).toBe(92);
		expect(refreshWindow(pending("2026-11-01", "2026-11-14", 14))).toEqual({
			from: "2026-11-01",
			to: "2026-11-14",
		});
		expect(refreshWindow(pending(null, null, 0))).toBeNull();
	});

	it("reads the catch-up status with when the mappings last changed", async () => {
		const { client, log } = fakeClient(() => ({
			data: [statusRow("2026-01-01", "2026-11-16", 320)],
			error: null,
		}));
		expect(
			await createSupabaseSettingsSource(client).catchUpStatus(TENANT),
		).toEqual({
			inputsChangedAt: CHANGED_AT,
			pendingFrom: "2026-01-01",
			pendingTo: "2026-11-16",
			pendingDays: 320,
			canRefresh: true,
		});
		expect(log[0]?.table).toBe("rpc:analytics_catch_up_status");
		expect(log[0]?.calls).toContainEqual(["rpc", [{ p_tenant_id: TENANT }]]);
	});

	it("reports nothing pending for a member who is not in the tenant", async () => {
		const { client } = fakeClient(() => ({ data: [], error: null }));
		expect(
			await createSupabaseSettingsSource(client).catchUpStatus(TENANT),
		).toEqual({
			inputsChangedAt: null,
			pendingFrom: null,
			pendingTo: null,
			pendingDays: 0,
			canRefresh: false,
		});
	});

	it("refreshes the newest chunk of the status it has just read, then reads the status again", async () => {
		const statuses = [
			statusRow("2026-01-01", "2026-11-16", 320),
			statusRow("2026-01-01", "2026-08-16", 228),
		];
		let reads = 0;
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table !== "rpc:analytics_catch_up_status") {
				return { data: 12, error: null };
			}
			const row = statuses[Math.min(reads, statuses.length - 1)];
			reads += 1;
			return { data: [row], error: null };
		});
		const after =
			await createSupabaseSettingsSource(client).refreshChunk(TENANT);
		expect(log.map((entry) => entry.table)).toEqual([
			"rpc:analytics_catch_up_status",
			"rpc:refresh_my_analytics",
			"rpc:analytics_catch_up_status",
		]);
		expect(log[1]?.calls).toContainEqual([
			"rpc",
			[{ p_from: "2026-08-17", p_to: "2026-11-16", p_tenant: TENANT }],
		]);
		expect(after.pendingTo).toBe("2026-08-16");
		expect(after.pendingDays).toBe(228);
	});

	it("calls no refresh when nothing is pending or the member may not refresh", async () => {
		const caughtUp = fakeClient(() => ({
			data: [statusRow(null, null, 0)],
			error: null,
		}));
		await createSupabaseSettingsSource(caughtUp.client).refreshChunk(TENANT);
		expect(caughtUp.log.map((entry) => entry.table)).toEqual([
			"rpc:analytics_catch_up_status",
		]);

		const viewer = fakeClient(() => ({
			data: [
				{ ...statusRow("2026-01-01", "2026-11-16", 320), can_refresh: false },
			],
			error: null,
		}));
		const status = await createSupabaseSettingsSource(
			viewer.client,
		).refreshChunk(TENANT);
		expect(viewer.log.map((entry) => entry.table)).toEqual([
			"rpc:analytics_catch_up_status",
		]);
		expect(status.canRefresh).toBe(false);
	});

	it("turns a refused refresh into a settings error", async () => {
		const { client } = fakeClient((recorded) =>
			recorded.table === "rpc:analytics_catch_up_status"
				? { data: [statusRow("2026-01-01", "2026-11-16", 320)], error: null }
				: {
						data: null,
						error: { code: "42501", message: "limited to owners and managers" },
					},
		);
		await expect(
			createSupabaseSettingsSource(client).refreshChunk(TENANT),
		).rejects.toEqual(new SettingsWriteError("forbidden"));
	});
});

const STORE = "77777777-7777-4777-8777-777777777777";
const FEE_ID = "88888888-8888-4888-8888-888888888888";
const HOLIDAY_ID = "99999999-9999-4999-8999-999999999990";

function membersAnswer(recorded: Recorded): Result | null {
	return recorded.table === "tenant_members"
		? {
				data: [
					{ user_id: USER, role: "owner" },
					{ user_id: OTHER_USER, role: "manager" },
				],
				error: null,
			}
		: null;
}

function called(recorded: Recorded | undefined, method: string): unknown[][] {
	return (recorded?.calls ?? [])
		.filter(([name]) => name === method)
		.map(([, args]) => args);
}

function storeRowOf(overrides: Record<string, unknown> = {}) {
	return {
		id: STORE,
		pos_account_id: ACCOUNT,
		name: "Cửa hàng 1",
		address: null,
		timezone: "Asia/Ho_Chi_Minh",
		business_day_start_minutes: 0,
		code: "CH1",
		opening_hours: { mon: [["07:00", "22:00"]] },
		seat_count: 40,
		opened_on: "2024-12-02",
		e_invoice_status: "configured",
		tran_no_reset_period: "daily",
		member_capture_status: "enabled",
		profile_updated_at: CHANGED_AT,
		profile_updated_by: OTHER_USER,
		...overrides,
	};
}

describe("the Supabase settings source's 10b areas", () => {
	it("reads and updates the tenant profile's two columns, with the audit columns", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				membersAnswer(recorded) ?? {
					data: [
						{
							legal_form: "household_business",
							default_language: "vi",
							profile_updated_at: CHANGED_AT,
							profile_updated_by: USER,
						},
					],
					error: null,
				},
		);
		const source = createSupabaseSettingsSource(client);
		expect(await source.tenantProfile(TENANT)).toEqual({
			legalForm: "household_business",
			defaultLanguage: "vi",
			audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
		});
		await source.updateTenantProfile(TENANT, { defaultLanguage: "en" });
		const update = log.find((entry) => called(entry, "update").length > 0);
		expect(update?.table).toBe("tenants");
		expect(called(update, "update")).toEqual([[{ default_language: "en" }]]);
		expect(called(update, "eq")).toEqual([["id", TENANT]]);
	});

	it("refuses an update that row-level security answered with no row", async () => {
		const { client } = fakeClient(
			(recorded) => membersAnswer(recorded) ?? { data: [], error: null },
		);
		const source = createSupabaseSettingsSource(client);
		await expect(
			source.updateTenantProfile(TENANT, { legalForm: "enterprise" }),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			source.updateStoreProfile(TENANT, STORE, { seatCount: 12 }),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("pages the store profiles in a stable order and writes only the profile columns given", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				membersAnswer(recorded) ?? { data: [storeRowOf()], error: null },
		);
		const source = createSupabaseSettingsSource(client);
		const [store] = await source.storeProfiles(TENANT);
		expect(store).toMatchObject({
			storeId: STORE,
			code: "CH1",
			seatCount: 40,
			openingHours: { mon: [["07:00", "22:00"]] },
			eInvoiceStatus: "configured",
			audit: {
				changedAt: CHANGED_AT,
				author: { kind: "member", role: "manager" },
			},
		});
		const read = log.find((entry) => entry.table === "stores");
		expect(called(read, "order").map(([column]) => column)).toEqual([
			"name",
			"id",
		]);
		expect(called(read, "range")).toEqual([[0, 999]]);
		await source.updateStoreProfile(TENANT, STORE, {
			code: "CH9",
			openingHours: null,
			memberCaptureStatus: "disabled",
		});
		const update = log.find((entry) => called(entry, "update").length > 0);
		expect(called(update, "update")).toEqual([
			[{ code: "CH9", opening_hours: null, member_capture_status: "disabled" }],
		]);
		expect(called(update, "eq")).toEqual([
			["tenant_id", TENANT],
			["id", STORE],
		]);
	});

	it("maps the store trigger's refusals to their codes and constraint", async () => {
		const failing = (error: Record<string, unknown>) =>
			createSupabaseSettingsSource(
				fakeClient(
					(recorded) => membersAnswer(recorded) ?? { data: null, error },
				).client,
			);
		await expect(
			failing({
				code: "23505",
				message:
					'duplicate key value violates unique constraint "stores_code_unique_in_tenant"',
			}).updateStoreProfile(TENANT, STORE, { code: "CH2" }),
		).rejects.toMatchObject({
			code: "duplicate",
			constraint: "stores_code_unique_in_tenant",
		});
		await expect(
			failing({
				code: "42501",
				message: "opening hours are changed by an owner of the store",
			}).updateStoreProfile(TENANT, STORE, { openingHours: null }),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			failing({
				code: "23514",
				message:
					'new row for relation "stores" violates check constraint "stores_opening_hours_valid"',
			}).updateStoreProfile(TENANT, STORE, { openingHours: {} }),
		).rejects.toMatchObject({
			code: "invalid",
			constraint: "stores_opening_hours_valid",
		});
	});

	it("merges items with their category overrides and upserts or deletes overrides on their unique key", async () => {
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table === "items") {
				return {
					data: [
						{
							pos_account_id: ACCOUNT,
							external_id: "SN-001",
							name: "Hạt bí",
							size_label: null,
							list_price: "15000.00",
							is_modifier: false,
							active: true,
							item_type_external_id: null,
						},
					],
					error: null,
				};
			}
			if (
				recorded.table === "item_category_overrides" &&
				called(recorded, "delete").length > 0
			) {
				return { data: [{ item_external_id: "DR-001" }], error: null };
			}
			if (recorded.table === "item_category_overrides") {
				return {
					data: [
						{
							pos_account_id: ACCOUNT,
							item_external_id: "SN-001",
							item_type_external_id: "TYPE-009",
							updated_at: CHANGED_AT,
							updated_by: USER,
						},
					],
					error: null,
				};
			}
			return membersAnswer(recorded) ?? { data: null, error: null };
		});
		const source = createSupabaseSettingsSource(client);
		expect(await source.items(TENANT)).toEqual([
			{
				posAccountId: ACCOUNT,
				itemExternalId: "SN-001",
				name: "Hạt bí",
				sizeLabel: null,
				listPrice: 15_000,
				isModifier: false,
				active: true,
				inCatalogue: true,
				posItemTypeExternalId: null,
				overrideItemTypeExternalId: "TYPE-009",
				audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
			},
		]);
		await source.saveCategoryOverrides(TENANT, [
			{
				posAccountId: ACCOUNT,
				itemExternalId: "SN-001",
				itemTypeExternalId: "TYPE-009",
			},
			{
				posAccountId: ACCOUNT,
				itemExternalId: "DR-001",
				itemTypeExternalId: null,
			},
		]);
		const upsert = log.find((entry) => called(entry, "upsert").length > 0);
		expect(called(upsert, "upsert")).toEqual([
			[
				[
					{
						tenant_id: TENANT,
						pos_account_id: ACCOUNT,
						item_external_id: "SN-001",
						item_type_external_id: "TYPE-009",
					},
				],
				{ onConflict: "pos_account_id,item_external_id" },
			],
		]);
		const removal = log.find((entry) => called(entry, "delete").length > 0);
		expect(called(removal, "in")).toEqual([["item_external_id", ["DR-001"]]]);
	});

	it("shows each payment method's POS kind, override and effective kind, and writes overrides on their unique key", async () => {
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table === "payment_methods") {
				return {
					data: [
						{
							pos_account_id: ACCOUNT,
							external_id: "pm-04",
							name: "Khác",
							kind: "ewallet",
							pos_kind: "other",
							pos_accounts: { display_name: "POS 1" },
						},
						{
							pos_account_id: ACCOUNT,
							external_id: "pm-01",
							name: "Tiền mặt",
							kind: "cash",
							pos_kind: "cash",
							pos_accounts: { display_name: "POS 1" },
						},
					],
					error: null,
				};
			}
			if (recorded.table === "payment_kind_overrides") {
				return {
					data: [
						{
							pos_account_id: ACCOUNT,
							payment_method_external_id: "pm-04",
							kind: "ewallet",
							updated_at: CHANGED_AT,
							updated_by: OTHER_USER,
						},
					],
					error: null,
				};
			}
			return membersAnswer(recorded) ?? { data: null, error: null };
		});
		const source = createSupabaseSettingsSource(client);
		expect(
			(await source.paymentMethods(TENANT)).map((method) => [
				method.externalId,
				method.posKind,
				method.overrideKind,
				method.kind,
				method.audit?.author,
			]),
		).toEqual([
			[
				"pm-04",
				"other",
				"ewallet",
				"ewallet",
				{ kind: "member", role: "manager" },
			],
			["pm-01", "cash", null, "cash", undefined],
		]);
		await source.saveKindOverrides(TENANT, [
			{ posAccountId: ACCOUNT, paymentMethodExternalId: "pm-04", kind: "card" },
		]);
		const upsert = log.find((entry) => called(entry, "upsert").length > 0);
		expect(upsert?.table).toBe("payment_kind_overrides");
		expect(called(upsert, "upsert")[0]?.[1]).toEqual({
			onConflict: "pos_account_id,payment_method_external_id",
		});
	});

	it("reads fee rates tenant-wide first and saves a batch, null store included, in one upsert on the nulls-not-distinct key", async () => {
		const rate = {
			id: FEE_ID,
			store_id: null,
			payment_method_external_id: "PM-EWALLET",
			fee_pct: "1.237",
			fixed_fee_amount: "200.00",
			effective_from: "2023-01-01",
			updated_at: CHANGED_AT,
			updated_by: USER,
		};
		const { client, log } = fakeClient(
			(recorded) => membersAnswer(recorded) ?? { data: [rate], error: null },
		);
		const source = createSupabaseSettingsSource(client);
		expect(await source.feeRates(TENANT)).toEqual([
			{
				id: FEE_ID,
				storeId: null,
				paymentMethodExternalId: "PM-EWALLET",
				feePct: 1.237,
				fixedFeeAmount: 200,
				effectiveFrom: "2023-01-01",
				audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
			},
		]);
		expect(called(log[0], "order")).toEqual([
			["payment_method_external_id"],
			["store_id", { nullsFirst: true }],
			["effective_from"],
			["id"],
		]);
		const saved = await source.saveFeeRates(TENANT, [
			{
				storeId: null,
				paymentMethodExternalId: "PM-EWALLET",
				feePct: 1.237,
				fixedFeeAmount: 200,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: STORE,
				paymentMethodExternalId: "PM-EWALLET",
				feePct: 0.9,
				fixedFeeAmount: 0,
				effectiveFrom: "2026-11-01",
			},
		]);
		expect(saved).toHaveLength(1);
		const upserts = log.filter((entry) => called(entry, "upsert").length > 0);
		expect(upserts).toHaveLength(1);
		const [[payload, options]] = called(upserts[0], "upsert") as [
			[Record<string, unknown>[], unknown],
		];
		expect(payload.map((row) => row.store_id)).toEqual([null, STORE]);
		expect(options).toEqual({
			onConflict:
				"tenant_id,store_id,payment_method_external_id,effective_from",
		});
		expect(await source.saveFeeRates(TENANT, [])).toEqual([]);
	});

	it("reads a year of the country's holidays and the tenant's own days, adds a custom day and deletes only the tenant's", async () => {
		const holiday = (tenant: string | null, date: string, name: string) => ({
			id: tenant === null ? `g-${date}` : HOLIDAY_ID,
			tenant_id: tenant,
			country_code: "VN",
			holiday_date: date,
			name,
			kind: tenant === null ? "public" : "custom",
			updated_at: CHANGED_AT,
			updated_by: tenant === null ? null : USER,
		});
		const { client, log } = fakeClient((recorded) => {
			if (recorded.table === "tenants") {
				return { data: [{ country_code: "VN" }], error: null };
			}
			if (recorded.table === "holidays" && called(recorded, "insert").length) {
				return {
					data: [holiday(TENANT, "2026-03-08", "Nghỉ riêng")],
					error: null,
				};
			}
			if (recorded.table === "holidays" && called(recorded, "delete").length) {
				return { data: [], error: null };
			}
			if (recorded.table === "holidays" && called(recorded, "is").length) {
				return {
					data: [holiday(null, "2026-04-30", "Giải phóng")],
					error: null,
				};
			}
			if (recorded.table === "holidays") {
				return {
					data: [holiday(TENANT, "2026-03-08", "Nghỉ riêng")],
					error: null,
				};
			}
			return membersAnswer(recorded) ?? { data: null, error: null };
		});
		const source = createSupabaseSettingsSource(client);
		const days = await source.holidays(TENANT, 2026);
		expect(
			days.map((day) => [day.holidayDate, day.custom, day.audit === null]),
		).toEqual([
			["2026-03-08", true, false],
			["2026-04-30", false, true],
		]);
		const global = log.find(
			(entry) => entry.table === "holidays" && called(entry, "is").length > 0,
		);
		expect(called(global, "is")).toEqual([["tenant_id", null]]);
		expect(called(global, "gte")).toEqual([["holiday_date", "2026-01-01"]]);
		expect(called(global, "lte")).toEqual([["holiday_date", "2026-12-31"]]);
		const added = await source.addHoliday(TENANT, {
			holidayDate: "2026-03-08",
			name: "Nghỉ riêng",
		});
		expect(added).toMatchObject({ custom: true, kind: "custom" });
		const insert = log.find((entry) => called(entry, "insert").length > 0);
		expect(called(insert, "insert")).toEqual([
			[
				{
					tenant_id: TENANT,
					country_code: "VN",
					holiday_date: "2026-03-08",
					name: "Nghỉ riêng",
					kind: "custom",
				},
			],
		]);
		await expect(
			source.deleteHoliday(TENANT, HOLIDAY_ID),
		).rejects.toMatchObject({
			code: "forbidden",
		});
	});

	it("turns a request that never reached the server into a network failure", async () => {
		const { client } = fakeClient(() => {
			throw new TypeError("Failed to fetch");
		});
		const failure = await createSupabaseSettingsSource(client)
			.saveFeeRates(TENANT, [
				{
					storeId: null,
					paymentMethodExternalId: "PM-CASH",
					feePct: 0,
					fixedFeeAmount: 0,
					effectiveFrom: "2023-01-01",
				},
			])
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(SettingsWriteError);
		expect(writeCodeOf(failure)).toBe("network");
	});

	it("lists an override whose item the catalogue lacks, so the page can clear it", async () => {
		const { client } = fakeClient((recorded) => {
			if (recorded.table === "items") return { data: [], error: null };
			if (recorded.table === "item_category_overrides") {
				return {
					data: [
						{
							pos_account_id: ACCOUNT,
							item_external_id: "Bánh mì cũ",
							item_type_external_id: "TYPE-SNACK",
							updated_at: CHANGED_AT,
							updated_by: USER,
						},
					],
					error: null,
				};
			}
			return membersAnswer(recorded) ?? { data: null, error: null };
		});
		expect(
			await createSupabaseSettingsSource(client).items(TENANT),
		).toMatchObject([
			{
				itemExternalId: "Bánh mì cũ",
				name: "Bánh mì cũ",
				inCatalogue: false,
				posItemTypeExternalId: null,
				overrideItemTypeExternalId: "TYPE-SNACK",
			},
		]);
	});

	it("sends nothing for an empty profile change and answers the stored profile", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				membersAnswer(recorded) ?? { data: [storeRowOf()], error: null },
		);
		const source = createSupabaseSettingsSource(client);
		expect(await source.updateStoreProfile(TENANT, STORE, {})).toMatchObject({
			storeId: STORE,
			code: "CH1",
		});
		expect(log.some((entry) => called(entry, "update").length > 0)).toBe(false);
		const read = log.find((entry) => entry.table === "stores");
		expect(called(read, "eq")).toEqual([
			["tenant_id", TENANT],
			["id", STORE],
		]);
	});

	it("reads only the tenant's own holidays of its country", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.table === "tenants"
				? { data: [{ country_code: "VN" }], error: null }
				: (membersAnswer(recorded) ?? { data: [], error: null }),
		);
		await createSupabaseSettingsSource(client).holidays(TENANT, 2026);
		const custom = log.find(
			(entry) => entry.table === "holidays" && called(entry, "is").length === 0,
		);
		expect(called(custom, "eq")).toEqual([
			["tenant_id", TENANT],
			["country_code", "VN"],
		]);
	});

	it("reports a batch that names one key twice as a duplicate", async () => {
		const { client } = fakeClient(
			(recorded) =>
				membersAnswer(recorded) ?? {
					data: null,
					error: {
						code: "21000",
						message:
							"ON CONFLICT DO UPDATE command cannot affect row a second time",
					},
				},
		);
		const rate = {
			storeId: null,
			paymentMethodExternalId: "PM-CASH",
			feePct: 0,
			fixedFeeAmount: 0,
			effectiveFrom: "2023-01-01",
		};
		await expect(
			createSupabaseSettingsSource(client).saveFeeRates(TENANT, [rate, rate]),
		).rejects.toMatchObject({ code: "duplicate" });
	});
});
