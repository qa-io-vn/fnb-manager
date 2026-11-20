import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SettingsWriteError } from "../source";
import { HISTORY_PAGE_SIZE, RATE_LIMITED } from "./source";
import {
	cooldownHoursOf,
	createSupabaseNotifySource,
	EPISODE_SELECT,
	MESSAGE_SELECT,
} from "./supabase-notify-source";

const TENANT = "33333333-3333-4333-8333-333333333333";

interface Recorded {
	table: string;
	calls: [string, unknown[]][];
}

type Reply = { data: unknown; error: unknown };

function fakeClient(answer: (recorded: Recorded) => Reply | Error) {
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
		) as Promise<Reply> & Record<string, unknown>;
		for (const method of [
			"select",
			"eq",
			"is",
			"in",
			"not",
			"order",
			"range",
			"limit",
			"insert",
			"update",
			"delete",
		]) {
			chain[method] = (...args: unknown[]) => {
				recorded.calls.push([method, args]);
				return chain;
			};
		}
		return chain;
	};
	const client = {
		from: builder,
		rpc: (name: string, args: unknown) => {
			const chain = builder(`rpc:${name}`);
			log.at(-1)?.calls.push(["rpc", [args]]);
			return chain;
		},
	};
	return { client: client as unknown as SupabaseClient, log };
}

const OVERVIEW = {
	role: "owner",
	store_limited: false,
	schedule_enabled: false,
	last_tick_at: null,
	last_dispatch_at: null,
	dispatcher_secrets: [],
	destinations: [
		{
			id: "d1",
			kind: "zalo_bot",
			provider: "zalo_bot",
			label: "Zalo Bot",
			status: "active",
			enabled: true,
			disabled_reason: null,
			address_hint: "…3f7a",
			mine: true,
			has_member: true,
			member_role: "owner",
			member_email: null,
			store_ids: null,
			muted_rules: [],
			timezone: null,
			linked_at: "2026-11-01T00:00:00Z",
			last_ok_at: null,
			last_error_code: null,
			last_error_at: null,
			consecutive_failures: 0,
			secret_reported: null,
		},
	],
	held_24h: 0,
	uncertain_24h: "1",
	failed_24h: 0,
	pending_links: 0,
	zalo_bot_month: 12,
	zalo_bot_quota: 3000,
};

describe("the Supabase notify source", () => {
	it("reads the overview through notify_overview and never asks for an address", async () => {
		const { client, log } = fakeClient(() => ({ data: OVERVIEW, error: null }));
		const overview = await createSupabaseNotifySource(client).overview(TENANT);
		expect(log[0]?.table).toBe("rpc:notify_overview");
		expect(log[0]?.calls[0]).toEqual(["rpc", [{ p_tenant_id: TENANT }]]);
		expect(overview.uncertain24h).toBe(1);
		expect(overview.destinations[0]?.addressHint).toBe("…3f7a");
		expect(JSON.stringify(overview)).not.toContain('address"');
	});

	it("pages the alert history and the message log with named columns and a stable order", async () => {
		const { client, log } = fakeClient(() => ({ data: [], error: null }));
		const source = createSupabaseNotifySource(client);
		await source.alertHistory(TENANT, 2);
		await source.messageLog(TENANT, 0);
		const [history, messages] = log;
		expect(history?.table).toBe("alert_events");
		expect(history?.calls).toContainEqual(["select", [EPISODE_SELECT]]);
		expect(history?.calls).toContainEqual([
			"order",
			["opened_at", { ascending: false }],
		]);
		expect(history?.calls).toContainEqual([
			"order",
			["id", { ascending: true }],
		]);
		expect(history?.calls).toContainEqual([
			"range",
			[2 * HISTORY_PAGE_SIZE, 3 * HISTORY_PAGE_SIZE - 1],
		]);
		expect(messages?.table).toBe("outbound_messages");
		expect(messages?.calls).toContainEqual(["select", [MESSAGE_SELECT]]);
		expect(messages?.calls).toContainEqual([
			"range",
			[0, HISTORY_PAGE_SIZE - 1],
		]);
		for (const entry of log) {
			for (const [method, args] of entry.calls) {
				if (method === "select") expect(String(args[0])).not.toContain("*");
			}
		}
	});

	it("maps a rate-limit answer, a refusal and a lost connection to their codes", async () => {
		const cases: [Reply | Error, string, string | null][] = [
			[
				{
					data: null,
					error: { code: "22023", message: "x", hint: RATE_LIMITED },
				},
				"invalid",
				RATE_LIMITED,
			],
			[
				{ data: null, error: { code: "42501", message: "x" } },
				"forbidden",
				null,
			],
			[
				{ data: null, error: { code: "23505", message: "x" } },
				"duplicate",
				null,
			],
			[new Error("offline"), "network", null],
		];
		for (const [reply, code, constraint] of cases) {
			const { client } = fakeClient(() => reply);
			const error = await createSupabaseNotifySource(client)
				.sendTest("d1")
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(SettingsWriteError);
			expect((error as SettingsWriteError).code).toBe(code);
			expect((error as SettingsWriteError).constraint).toBe(constraint);
		}
	});

	it("starts a link with the kind and returns the code once, without storing it", async () => {
		const { client, log } = fakeClient(() => ({
			data: {
				channel_id: "c1",
				status: "pending",
				link_code: "FNB-ABCDEFGH",
				expires_at: "2026-11-20T10:15:00Z",
				bot_name: null,
			},
			error: null,
		}));
		const link = await createSupabaseNotifySource(client).startLink(
			TENANT,
			"zalo_bot",
			null,
		);
		expect(link.linkCode).toBe("FNB-ABCDEFGH");
		expect(log[0]?.calls[0]).toEqual([
			"rpc",
			[{ p_tenant_id: TENANT, p_kind: "zalo_bot", p_label: null }],
		]);
	});

	it("passes a store narrowing, or its removal, to update_destination", async () => {
		const { client, log } = fakeClient(() => ({ data: {}, error: null }));
		const source = createSupabaseNotifySource(client);
		await source.updateDestination("c1", { storeIds: ["s1"] });
		await source.updateDestination("c1", { storeIds: null });
		await source.updateDestination("c1", { label: "Ca sáng" });
		const args = log.map(
			(entry) => entry.calls[0]?.[1][0] as Record<string, unknown>,
		);
		expect(args[0]).toMatchObject({
			p_store_ids: ["s1"],
			p_clear_store_ids: false,
		});
		expect(args[1]).toMatchObject({
			p_store_ids: null,
			p_clear_store_ids: true,
		});
		expect(args[2]).toMatchObject({
			p_label: "Ca sáng",
			p_store_ids: null,
			p_clear_store_ids: false,
			p_enabled: null,
		});
	});

	it("inserts a rule override with the rule's key or updates the existing one by id", async () => {
		const { client, log } = fakeClient(() => ({ data: null, error: null }));
		const source = createSupabaseNotifySource(client);
		const change = {
			ruleKey: "revenue_below_baseline",
			storeId: "s1",
			enabled: false,
			severity: "warning" as const,
			params: { ratio: 0.5 },
			cooldownHours: 0,
		};
		await source.saveRule(TENANT, { ...change, overrideId: null });
		await source.saveRule(TENANT, { ...change, overrideId: "o1" });
		expect(log[0]?.calls[0]?.[0]).toBe("insert");
		expect(log[0]?.calls[0]?.[1][0]).toMatchObject({
			tenant_id: TENANT,
			store_id: "s1",
			rule_key: "revenue_below_baseline",
			cooldown: "0 hours",
		});
		expect(log[1]?.calls).toContainEqual(["eq", ["id", "o1"]]);
		expect(log[1]?.calls).toContainEqual(["eq", ["tenant_id", TENANT]]);
	});

	it("reads interval texts as hours", () => {
		expect(cooldownHoursOf("00:00:00")).toBe(0);
		expect(cooldownHoursOf("24:00:00")).toBe(24);
		expect(cooldownHoursOf("1 day 02:00:00")).toBe(26);
		expect(cooldownHoursOf("7 days")).toBe(168);
	});
});
