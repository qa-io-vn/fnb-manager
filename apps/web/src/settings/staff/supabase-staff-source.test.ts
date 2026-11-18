import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SettingsWriteError, writeCodeOf } from "../source";
import { PAIRING_CODE_TTL_MS } from "./source";
import {
	createSupabaseStaffSource,
	IDENTITY_SELECT,
	ROSTER_SELECT,
	STAFF_APP_SELECT,
} from "./supabase-staff-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const STORE = "77777777-7777-4777-8777-777777777777";
const ROSTER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PAIRED_USER = "66666666-6666-4666-8666-666666666666";
const UNPAIRED_USER = "88888888-8888-4888-8888-888888888888";
const BRAND_ID = "55555555-5555-4555-8555-555555555555";
const CHANGED_AT = "2026-11-14T17:30:00+00:00";

interface Recorded {
	table: string;
	calls: [string, unknown[]][];
}

type Result = { data: unknown; error: unknown };

function fakeClient(answer: (recorded: Recorded) => Result | Error) {
	const log: Recorded[] = [];
	const builder = (table: string) => {
		const recorded: Recorded = { table, calls: [] };
		log.push(recorded);
		const chain = Object.assign(
			Promise.resolve().then(() => {
				const reply = answer(recorded);
				if (reply instanceof Error) throw reply;
				return reply;
			}),
			{},
		) as Promise<Result> & Record<string, unknown>;
		for (const method of ["select", "eq", "order", "range"]) {
			chain[method] = (...args: unknown[]) => {
				recorded.calls.push([method, args]);
				return chain;
			};
		}
		return chain;
	};
	const client = {
		auth: {
			getUser: async () => ({ data: { user: { id: USER } }, error: null }),
		},
		from: builder,
		rpc: (name: string, args: unknown) => {
			const chain = builder(`rpc:${name}`);
			log.at(-1)?.calls.push(["rpc", [args]]);
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, log };
}

function called(recorded: Recorded | undefined, method: string): unknown[][] {
	return (recorded?.calls ?? [])
		.filter(([name]) => name === method)
		.map(([, args]) => args);
}

function members(recorded: Recorded): Result | null {
	return recorded.table === "tenant_members"
		? { data: [{ user_id: USER, role: "owner" }], error: null }
		: null;
}

const rosterRow = {
	id: ROSTER_ID,
	display_name: "Nhân viên 1",
	role: "staff",
	store_ids: [STORE],
	status: "active",
	user_id: PAIRED_USER,
	paired_at: CHANGED_AT,
	phone_hint: "…678",
	deactivated_at: null,
	updated_at: CHANGED_AT,
	updated_by: USER,
};

describe("the Supabase staff source", () => {
	it("reads the roster through row-level security without the phone or any Zalo id, in a stable order, paired only while a Zalo identity of the login remains", async () => {
		const unpaired = {
			...rosterRow,
			id: OTHER_ID,
			display_name: "Nhân viên 2",
			user_id: UNPAIRED_USER,
			phone_hint: null,
		};
		const { client, log } = fakeClient(
			(recorded) =>
				members(recorded) ??
				(recorded.table === "zalo_identities"
					? { data: [{ id: "identity-1", user_id: PAIRED_USER }], error: null }
					: { data: [rosterRow, unpaired], error: null }),
		);
		const source = createSupabaseStaffSource(client);
		expect(await source.roster(TENANT)).toEqual([
			{
				id: ROSTER_ID,
				displayName: "Nhân viên 1",
				role: "staff",
				storeIds: [STORE],
				status: "active",
				paired: true,
				pairedAt: CHANGED_AT,
				phoneHint: "…678",
				deactivatedAt: null,
				audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
			},
			{
				id: OTHER_ID,
				displayName: "Nhân viên 2",
				role: "staff",
				storeIds: [STORE],
				status: "active",
				paired: false,
				pairedAt: CHANGED_AT,
				phoneHint: null,
				deactivatedAt: null,
				audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
			},
		]);
		const read = log.find((entry) => entry.table === "staff_roster");
		expect(called(read, "select")).toEqual([[ROSTER_SELECT]]);
		expect(called(read, "eq")).toEqual([["tenant_id", TENANT]]);
		expect(called(read, "order")).toEqual([["display_name"], ["id"]]);
		const columns = ROSTER_SELECT.split(",");
		expect(columns).not.toContain("phone");
		expect(columns.some((column) => column.includes("zalo"))).toBe(false);
		const identities = log.find((entry) => entry.table === "zalo_identities");
		expect(called(identities, "select")).toEqual([[IDENTITY_SELECT]]);
		expect(called(identities, "eq")).toEqual([["tenant_id", TENANT]]);
		expect(IDENTITY_SELECT.split(",")).toEqual(["id", "user_id"]);
	});

	it("adds, updates, deactivates and reactivates through the four roster functions with their arguments", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.table === "rpc:add_staff"
				? { data: ROSTER_ID, error: null }
				: { data: null, error: null },
		);
		const source = createSupabaseStaffSource(client);
		expect(
			await source.addStaff(TENANT, {
				displayName: "Nhân viên 2",
				role: "manager",
				storeIds: [STORE],
			}),
		).toBe(ROSTER_ID);
		await source.updateStaff(TENANT, ROSTER_ID, {
			displayName: "Nhân viên 2",
			role: "staff",
			storeIds: null,
		});
		await source.deactivateStaff(TENANT, ROSTER_ID);
		await source.reactivateStaff(TENANT, ROSTER_ID);
		expect(
			log.map((entry) => [entry.table, called(entry, "rpc")[0]?.[0]]),
		).toEqual([
			[
				"rpc:add_staff",
				{
					p_tenant_id: TENANT,
					p_display_name: "Nhân viên 2",
					p_role: "manager",
					p_store_ids: [STORE],
				},
			],
			[
				"rpc:update_staff",
				{
					p_roster_id: ROSTER_ID,
					p_display_name: "Nhân viên 2",
					p_role: "staff",
					p_store_ids: null,
				},
			],
			["rpc:deactivate_staff", { p_roster_id: ROSTER_ID }],
			["rpc:reactivate_staff", { p_roster_id: ROSTER_ID }],
		]);
	});

	it.each([
		["42501", "forbidden"],
		["22023", "invalid"],
		["23514", "invalid"],
		["23503", "invalid"],
		["PGRST301", "forbidden"],
	] as const)(
		"reports a roster function's %s refusal as %s",
		async (code, expected) => {
			const { client } = fakeClient(() => ({
				data: null,
				error: { code, message: "refused" },
			}));
			const source = createSupabaseStaffSource(client);
			const failure = await source
				.addStaff(TENANT, {
					displayName: "Nhân viên 2",
					role: "staff",
					storeIds: [STORE],
				})
				.catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(SettingsWriteError);
			expect(writeCodeOf(failure)).toBe(expected);
		},
	);

	it("reports a request that never reached the server as a lost connection", async () => {
		const { client } = fakeClient(() => new TypeError("Failed to fetch"));
		const source = createSupabaseStaffSource(client);
		const failure = await source
			.deactivateStaff(TENANT, ROSTER_ID)
			.catch((error: unknown) => error);
		expect(writeCodeOf(failure)).toBe("network");
	});

	it("reads and sets the staff revenue visibility of the tenant", async () => {
		const { client, log } = fakeClient((recorded) =>
			recorded.table === "tenants"
				? { data: [{ staff_revenue_visibility: "all" }], error: null }
				: { data: "store_totals", error: null },
		);
		const source = createSupabaseStaffSource(client);
		expect(await source.staffRevenueVisibility(TENANT)).toBe("all");
		expect(await source.setStaffRevenueVisibility(TENANT, "store_totals")).toBe(
			"store_totals",
		);
		const [read, write] = log;
		expect(called(read, "select")).toEqual([["staff_revenue_visibility"]]);
		expect(called(read, "eq")).toEqual([["id", TENANT]]);
		expect(write?.table).toBe("rpc:set_staff_revenue_visibility");
		expect(called(write, "rpc")).toEqual([
			[{ p_tenant_id: TENANT, p_visibility: "store_totals" }],
		]);
	});

	it("refuses the visibility of anyone but an owner with every store as forbidden", async () => {
		const { client } = fakeClient(() => ({
			data: null,
			error: { code: "42501", message: "only an owner" },
		}));
		const failure = await createSupabaseStaffSource(client)
			.setStaffRevenueVisibility(TENANT, "none")
			.catch((error: unknown) => error);
		expect(writeCodeOf(failure)).toBe("forbidden");
	});

	it("reads the staff Mini Apps of the tenant with the stores of their brand", async () => {
		const { client, log } = fakeClient(() => ({
			data: [
				{
					brand_id: BRAND_ID,
					external_id: "mock-staff-app",
					title: "Nhân viên mẫu",
					brands: { store_ids: [STORE] },
				},
			],
			error: null,
		}));
		const source = createSupabaseStaffSource(client);
		expect(await source.staffApps(TENANT)).toEqual([
			{
				brandId: BRAND_ID,
				miniAppId: "mock-staff-app",
				title: "Nhân viên mẫu",
				storeIds: [STORE],
			},
		]);
		const [read] = log;
		expect(read?.table).toBe("mini_apps");
		expect(called(read, "select")).toEqual([[STAFF_APP_SELECT]]);
		expect(called(read, "eq")).toEqual([
			["tenant_id", TENANT],
			["kind", "staff"],
		]);
	});

	it("issues a pairing code through issue_pairing_code and counts its ten minutes from the answer", async () => {
		const { client, log } = fakeClient(() => ({ data: "048213", error: null }));
		const before = Date.now();
		const issued = await createSupabaseStaffSource(client).issuePairingCode(
			TENANT,
			ROSTER_ID,
		);
		const after = Date.now();
		expect(issued.rosterId).toBe(ROSTER_ID);
		expect(issued.code).toBe("048213");
		const expires = Date.parse(issued.expiresAt);
		expect(expires).toBeGreaterThanOrEqual(before + PAIRING_CODE_TTL_MS);
		expect(expires).toBeLessThanOrEqual(after + PAIRING_CODE_TTL_MS);
		expect(log.map((entry) => entry.table)).toEqual(["rpc:issue_pairing_code"]);
		expect(called(log[0], "rpc")).toEqual([[{ p_roster_id: ROSTER_ID }]]);
	});

	it.each([
		["42501", "forbidden"],
		["22023", "invalid"],
	] as const)(
		"reports a refused pairing code (%s) as %s",
		async (code, expected) => {
			const { client } = fakeClient(() => ({
				data: null,
				error: { code, message: "refused" },
			}));
			const failure = await createSupabaseStaffSource(client)
				.issuePairingCode(TENANT, ROSTER_ID)
				.catch((error: unknown) => error);
			expect(writeCodeOf(failure)).toBe(expected);
		},
	);

	it("never takes an answer that is not six digits for a code", async () => {
		const { client } = fakeClient(() => ({ data: "12345", error: null }));
		await expect(
			createSupabaseStaffSource(client).issuePairingCode(TENANT, ROSTER_ID),
		).rejects.toBeDefined();
	});
});
