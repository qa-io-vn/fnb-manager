import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SettingsWriteError, writeCodeOf } from "../settings/source";
import {
	createDemoLoyaltySource,
	DEMO_STAFF_MODE_STORE,
} from "./demo-loyalty-source";
import {
	BILL_ANOMALY_FUNCTION,
	billAnomalyRow,
	createSupabaseLoyaltySource,
	REPORT_STORE_CHUNK,
	STORE_SETTINGS_FUNCTION,
	storeSettingsRow,
} from "./supabase-loyalty-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const STORE = "11111111-1111-4111-8111-111111111111";

function settingsRow(overrides: Record<string, unknown> = {}) {
	return {
		store_id: STORE,
		confirmation: "staff",
		max_bill_amount: "2000000.00",
		bill_evidence_required_level: 2,
		bill_manager_approval_above: "1000000.00",
		bill_amount_tolerance: "1000.00",
		bill_unconfirmed_hours: 24,
		bill_silence_outcome: "reverse",
		bill_staff_shift_cap: 25,
		staff_amount_per_day: "30000000.00",
		store_earns_per_day: 400,
		staff_redemptions_per_day: 50,
		reverse_window_minutes: 480,
		bill_audit_sample_pct: "2.00",
		self_claim: false,
		counter_code_ttl_seconds: 90,
		auto_approve_max_amount: "0.00",
		auto_approve_per_day: 0,
		bill_photo_retention_days: 90,
		bill_reader_mode: "off",
		shadow_reconcile: true,
		updated_at: "2026-11-20T02:00:00+00:00",
		...overrides,
	};
}

function anomalyRow(overrides: Record<string, unknown> = {}) {
	return {
		store_id: STORE,
		business_date: "2026-11-19",
		staff_user_id: "44444444-4444-4444-8444-444444444444",
		staff_name: "Lan",
		bills: 12,
		bills_total: "1080000.00",
		level0: 0,
		level2: 11,
		confirmed: 11,
		queued: 1,
		disagreements: 0,
		disputes: 0,
		timed_out: 0,
		reversals: 0,
		audits_failed: 0,
		redemptions_confirmed: 2,
		top_member_share: "0.167",
		amount_outliers: 0,
		max_bills_in_hour: 3,
		peer_median_bills: "10",
		flags: [],
		...overrides,
	};
}

interface Call {
	readonly kind: "from" | "rpc";
	readonly name: string;
	readonly steps: [string, unknown[]][];
	readonly args?: unknown;
}

type Answer = { data: unknown; error: unknown } | Error;

function fakeClient(answer: (call: Call) => Answer) {
	const calls: Call[] = [];
	const settle = (call: Call) =>
		Promise.resolve().then(() => {
			const result = answer(call);
			if (result instanceof Error) throw result;
			return result;
		});
	const client = {
		from(name: string) {
			const call: Call = { kind: "from", name, steps: [] };
			calls.push(call);
			const methods: Record<string, unknown> = {};
			const chain = Object.assign(settle(call), methods);
			for (const method of ["select", "eq", "in", "order", "limit"]) {
				methods[method] = (...args: unknown[]) => {
					call.steps.push([method, args]);
					return chain;
				};
			}
			Object.assign(chain, methods);
			return chain;
		},
		rpc(name: string, args: unknown) {
			const call: Call = { kind: "rpc", name, steps: [], args };
			calls.push(call);
			return settle(call);
		},
	};
	return { client: client as unknown as SupabaseClient, calls };
}

describe("the readers of the counter confirmation", () => {
	it("reads a row of loyalty_store_settings with numerics sent as text", () => {
		const parsed = storeSettingsRow.parse(settingsRow());
		expect(parsed.max_bill_amount).toBe(2_000_000);
		expect(parsed.bill_audit_sample_pct).toBe(2);
	});

	// Negative tests (equivalence partitions of malformed rows): an unknown
	// enum value, a level out of the ladder, a missing column, a negative or
	// fractional count, a share above 100 %, a value of the wrong type.
	it.each([
		["an unknown mode", { confirmation: "manual" }],
		["level 3", { bill_evidence_required_level: 3 }],
		["a missing column", { shadow_reconcile: undefined }],
		["a negative cap", { bill_staff_shift_cap: -1 }],
		["a fractional cap", { store_earns_per_day: 2.5 }],
		["an audit share above 100", { bill_audit_sample_pct: "100.01" }],
		["a zero largest bill", { max_bill_amount: "0" }],
		["a text flag for a boolean", { self_claim: "yes" }],
		["an unknown silence outcome", { bill_silence_outcome: "ignore" }],
		["an unknown reader", { bill_reader_mode: "live" }],
		["an empty store id", { store_id: "" }],
	])("refuses a settings row with %s", (_name, overrides) => {
		expect(storeSettingsRow.safeParse(settingsRow(overrides)).success).toBe(
			false,
		);
	});

	it("reads a report row and keeps flags it does not know", () => {
		const parsed = billAnomalyRow.parse(
			anomalyRow({ flags: ["burst", "new_signal"], staff_name: null }),
		);
		expect(parsed.flags).toEqual(["burst", "new_signal"]);
		expect(parsed.top_member_share).toBe(0.167);
		expect(parsed.staff_name).toBeNull();
	});

	it.each([
		["a date that is not ISO", { business_date: "19/11/2026" }],
		["flags that are not a list", { flags: "burst" }],
		["a negative count", { disputes: -1 }],
		["a missing count", { reversals: undefined }],
		["a flag that is not text", { flags: [1] }],
	])("refuses a report row with %s", (_name, overrides) => {
		expect(billAnomalyRow.safeParse(anomalyRow(overrides)).success).toBe(false);
	});
});

describe("the Supabase source of the counter confirmation", () => {
	it("reads the settings of the tenant's given stores, in chunks", async () => {
		const { client, calls } = fakeClient(() => ({
			data: [settingsRow()],
			error: null,
		}));
		const rows = await createSupabaseLoyaltySource(client).storeSettings(
			TENANT,
			[STORE, STORE],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			storeId: STORE,
			confirmation: "staff",
			maxBillAmount: 2_000_000,
			billEvidenceRequiredLevel: 2,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("loyalty_store_settings");
		expect(calls[0]?.steps).toContainEqual(["eq", ["tenant_id", TENANT]]);
		expect(calls[0]?.steps).toContainEqual(["in", ["store_id", [STORE]]]);
	});

	it("fails the read when a row is malformed rather than showing a wrong mode", async () => {
		const { client } = fakeClient(() => ({
			data: [settingsRow({ confirmation: "manual" })],
			error: null,
		}));
		await expect(
			createSupabaseLoyaltySource(client).storeSettings(TENANT, [STORE]),
		).rejects.toThrow();
	});

	it("sends only the changed keys to set_loyalty_store_settings and reads the row back", async () => {
		const { client, calls } = fakeClient(() => ({
			data: settingsRow({ confirmation: "staff", self_claim: true }),
			error: null,
		}));
		const saved = await createSupabaseLoyaltySource(client).saveStoreSettings(
			TENANT,
			STORE,
			{ confirmation: "staff", selfClaim: true },
		);
		expect(saved.selfClaim).toBe(true);
		expect(calls[0]).toMatchObject({
			kind: "rpc",
			name: STORE_SETTINGS_FUNCTION,
			args: {
				p_store_id: STORE,
				p_settings: { confirmation: "staff", self_claim: true },
			},
		});
	});

	// Security: a refusal of the database is never shown as saved.
	it.each([
		["42501", "forbidden"],
		["22023", "invalid"],
	] as const)("turns error %s into %s", async (code, expected) => {
		const { client } = fakeClient(() => ({
			data: null,
			error: { code, message: "refused" },
		}));
		const outcome = await createSupabaseLoyaltySource(client)
			.saveStoreSettings(TENANT, STORE, { confirmation: "staff" })
			.catch((error: unknown) => error);
		expect(outcome).toBeInstanceOf(SettingsWriteError);
		expect(writeCodeOf(outcome)).toBe(expected);
	});

	it("reports a lost connection as a network failure that can be retried", async () => {
		const { client } = fakeClient(() => new Error("offline"));
		const outcome = await createSupabaseLoyaltySource(client)
			.saveStoreSettings(TENANT, STORE, { confirmation: "staff" })
			.catch((error: unknown) => error);
		expect(writeCodeOf(outcome)).toBe("network");
	});

	it("calls bill_anomaly_report with at most 50 stores a call", async () => {
		const stores = Array.from(
			{ length: REPORT_STORE_CHUNK + 1 },
			(_, index) => `store-${index}`,
		);
		const { client, calls } = fakeClient(() => ({
			data: [anomalyRow()],
			error: null,
		}));
		const rows = await createSupabaseLoyaltySource(client).billAnomalies(
			stores,
			"2026-11-01",
			"2026-11-19",
		);
		expect(rows).toHaveLength(2);
		expect(calls.map((call) => call.name)).toEqual([
			BILL_ANOMALY_FUNCTION,
			BILL_ANOMALY_FUNCTION,
		]);
		expect(calls[0]?.args).toMatchObject({
			p_from: "2026-11-01",
			p_to: "2026-11-19",
		});
		expect(calls[1]?.args).toMatchObject({
			p_store_ids: [`store-${REPORT_STORE_CHUNK}`],
		});
		expect(rows[0]).toMatchObject({ staffName: "Lan", level2: 11 });
	});
});

describe("the demo source of the counter confirmation", () => {
	const demo = createDemoLoyaltySource();

	it("has one store confirming at the counter and refuses every write", async () => {
		const rows = await demo.storeSettings(TENANT, [
			DEMO_STAFF_MODE_STORE,
			"MOCK-S2",
		]);
		expect(rows.map((row) => [row.storeId, row.confirmation])).toEqual([
			[DEMO_STAFF_MODE_STORE, "staff"],
			["MOCK-S2", "pos_sync"],
		]);
		await expect(
			demo.saveStoreSettings(TENANT, "MOCK-S2", { confirmation: "staff" }),
		).rejects.toBeInstanceOf(SettingsWriteError);
	});

	it("reports sample staff days of the staff-mode store inside the range only", async () => {
		const rows = await demo.billAnomalies(
			[DEMO_STAFF_MODE_STORE],
			"2026-11-19",
			"2026-11-19",
		);
		expect(rows.every((row) => row.businessDate === "2026-11-19")).toBe(true);
		expect(rows.some((row) => row.flags.length > 0)).toBe(true);
		expect(rows.some((row) => row.staffName === null)).toBe(true);
		expect(
			await demo.billAnomalies(["MOCK-S2"], "2026-11-01", "2026-11-19"),
		).toEqual([]);
		const two = await demo.billAnomalies(
			[DEMO_STAFF_MODE_STORE],
			"2026-11-01",
			"2026-11-19",
		);
		expect(new Set(two.map((row) => row.businessDate))).toEqual(
			new Set(["2026-11-19", "2026-11-18"]),
		);
	});

	it("never carries a phone number in a staff name", async () => {
		const rows = await demo.billAnomalies(
			[DEMO_STAFF_MODE_STORE],
			"2026-11-01",
			"2026-11-19",
		);
		for (const row of rows) {
			expect(row.staffName ?? "").not.toMatch(/\d{6,}/);
		}
	});
});
