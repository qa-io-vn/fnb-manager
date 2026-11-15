import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { writeCodeOf } from "../source";
import {
	createSupabaseManualSource,
	ITEM_COSTS_CONFLICT,
	TARGETS_CONFLICT,
} from "./supabase-manual-source";

const TENANT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const STORE = "77777777-7777-4777-8777-777777777777";
const COST_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const CHANGED_AT = "2026-11-14T17:30:00+00:00";

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
		const chain = Object.assign(
			Promise.resolve().then(() => answer(recorded)),
			{},
		) as Promise<Result> & Record<string, unknown>;
		for (const method of [
			"select",
			"eq",
			"order",
			"range",
			"upsert",
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

const costRow = {
	id: COST_ID,
	store_id: null,
	item_external_id: "DR-001-M",
	cost_amount: "15000.00",
	effective_from: "2023-01-01",
	updated_at: CHANGED_AT,
	updated_by: USER,
};

function legalRow(status: string, overrides: Record<string, unknown> = {}) {
	return {
		id: DOCUMENT_ID,
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-notice-2026-11",
		title: "Thông báo bảo mật",
		body_markdown: "## Mục đích",
		status,
		published_at: status === "draft" ? null : CHANGED_AT,
		retired_at: status === "retired" ? CHANGED_AT : null,
		updated_at: CHANGED_AT,
		updated_by: USER,
		...overrides,
	};
}

describe("the Supabase manual settings source", () => {
	it("reads every cost row with its history in a stable order and its audit columns", async () => {
		const { client, log } = fakeClient(
			(recorded) => members(recorded) ?? { data: [costRow], error: null },
		);
		const source = createSupabaseManualSource(client);
		expect(await source.itemCosts(TENANT)).toEqual([
			{
				id: COST_ID,
				storeId: null,
				itemExternalId: "DR-001-M",
				costAmount: 15_000,
				effectiveFrom: "2023-01-01",
				audit: { changedAt: CHANGED_AT, author: { kind: "you" } },
			},
		]);
		const read = log.find((entry) => entry.table === "item_costs");
		expect(called(read, "order")).toEqual([
			["item_external_id"],
			["store_id", { nullsFirst: true }],
			["effective_from"],
			["id"],
		]);
		expect(called(read, "range")).toEqual([[0, 999]]);
	});

	it("saves a batch of costs, tenant-wide and per store, as one upsert on the scope, item and date", async () => {
		const { client, log } = fakeClient(
			(recorded) => members(recorded) ?? { data: [costRow], error: null },
		);
		const source = createSupabaseManualSource(client);
		const rows = Array.from({ length: 2_000 }, (_, index) => ({
			storeId: index % 2 === 0 ? null : STORE,
			itemExternalId: `ITEM-${index}`,
			costAmount: 1_000 + index,
			effectiveFrom: "2023-01-01",
		}));
		await source.saveItemCosts(TENANT, rows);
		const upserts = log.filter((entry) => called(entry, "upsert").length > 0);
		expect(upserts).toHaveLength(1);
		const [[payload, options]] = called(upserts[0], "upsert") as [
			[Record<string, unknown>[], unknown],
		];
		expect(payload).toHaveLength(2_000);
		expect(payload[0]).toEqual({
			tenant_id: TENANT,
			store_id: null,
			item_external_id: "ITEM-0",
			cost_amount: 1_000,
			effective_from: "2023-01-01",
		});
		expect(options).toEqual({ onConflict: ITEM_COSTS_CONFLICT });
		expect(ITEM_COSTS_CONFLICT).toBe(
			"tenant_id,store_id,item_external_id,effective_from",
		);
		expect(await source.saveItemCosts(TENANT, [])).toEqual([]);
	});

	it("reports a refused batch with its code and constraint, and a lost connection as a network failure", async () => {
		const refused = createSupabaseManualSource(
			fakeClient(
				(recorded) =>
					members(recorded) ?? {
						data: null,
						error: {
							code: "23514",
							message:
								'new row for relation "item_costs" violates check constraint "item_costs_cost_amount_check"',
						},
					},
			).client,
		);
		await expect(
			refused.saveItemCosts(TENANT, [
				{
					storeId: null,
					itemExternalId: "DR-001-M",
					costAmount: -1,
					effectiveFrom: "2023-01-01",
				},
			]),
		).rejects.toMatchObject({
			code: "invalid",
			constraint: "item_costs_cost_amount_check",
		});
		const offline = createSupabaseManualSource(
			fakeClient(() => {
				throw new TypeError("Failed to fetch");
			}).client,
		);
		const failure = await offline
			.saveTargets(TENANT, [
				{
					storeId: STORE,
					periodKind: "month",
					periodStart: "2026-11-01",
					netTargetAmount: 1,
				},
			])
			.catch((error: unknown) => error);
		expect(writeCodeOf(failure)).toBe("network");
	});

	it("upserts targets on the store, period kind and start", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				members(recorded) ?? {
					data: [
						{
							id: COST_ID,
							store_id: STORE,
							period_kind: "month",
							period_start: "2026-11-01",
							net_target_amount: "120000000.00",
							updated_at: CHANGED_AT,
							updated_by: USER,
						},
					],
					error: null,
				},
		);
		const source = createSupabaseManualSource(client);
		const [saved] = await source.saveTargets(TENANT, [
			{
				storeId: STORE,
				periodKind: "month",
				periodStart: "2026-11-01",
				netTargetAmount: 120_000_000,
			},
		]);
		expect(saved?.netTargetAmount).toBe(120_000_000);
		const upsert = log.find((entry) => called(entry, "upsert").length > 0);
		expect(called(upsert, "upsert")[0]?.[1]).toEqual({
			onConflict: TARGETS_CONFLICT,
		});
		expect(TARGETS_CONFLICT).toBe("store_id,period_kind,period_start");
	});

	it("inserts a new draft, patches only the title, body and version of an existing one, and publishes and retires through the two functions", async () => {
		const { client, log } = fakeClient(
			(recorded) =>
				members(recorded) ??
				(recorded.table.startsWith("rpc:")
					? { data: DOCUMENT_ID, error: null }
					: { data: [legalRow("draft")], error: null }),
		);
		const source = createSupabaseManualSource(client);
		const draft = {
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-notice-2026-11",
			title: "Thông báo bảo mật",
			bodyMarkdown: "## Mục đích",
		} as const;
		expect(await source.saveLegalDraft(TENANT, draft)).toMatchObject({
			id: DOCUMENT_ID,
			status: "draft",
			bodyMarkdown: "## Mục đích",
		});
		await source.saveLegalDraft(TENANT, { ...draft, id: DOCUMENT_ID });
		const insert = log.find((entry) => called(entry, "insert").length > 0);
		expect(called(insert, "insert")).toEqual([
			[
				{
					tenant_id: TENANT,
					kind: "privacy_notice",
					language: "vi",
					version: "privacy-notice-2026-11",
					title: "Thông báo bảo mật",
					body_markdown: "## Mục đích",
				},
			],
		]);
		const update = log.find((entry) => called(entry, "update").length > 0);
		expect(called(update, "update")).toEqual([
			[
				{
					version: "privacy-notice-2026-11",
					title: "Thông báo bảo mật",
					body_markdown: "## Mục đích",
				},
			],
		]);
		await source.publishLegalDocument(TENANT, DOCUMENT_ID);
		await source.retireLegalDocument(TENANT, DOCUMENT_ID);
		expect(
			log
				.filter((entry) => entry.table.startsWith("rpc:"))
				.map((entry) => [entry.table, called(entry, "rpc")[0]?.[0]]),
		).toEqual([
			["rpc:publish_legal_document", { p_document_id: DOCUMENT_ID }],
			["rpc:retire_legal_document", { p_document_id: DOCUMENT_ID }],
		]);
	});

	it("maps a frozen legal text and the publication refusals", async () => {
		const failing = (code: string) =>
			createSupabaseManualSource(
				fakeClient(
					(recorded) =>
						members(recorded) ?? {
							data: null,
							error: { code, message: "refused" },
						},
				).client,
			);
		await expect(
			failing("55000").saveLegalDraft(TENANT, {
				id: DOCUMENT_ID,
				kind: "privacy_notice",
				language: "vi",
				version: "v2",
				title: "Khác",
				bodyMarkdown: "Khác",
			}),
		).rejects.toMatchObject({ code: "frozen" });
		await expect(
			failing("42501").publishLegalDocument(TENANT, DOCUMENT_ID),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			failing("22023").retireLegalDocument(TENANT, DOCUMENT_ID),
		).rejects.toMatchObject({ code: "invalid" });
	});

	it("deletes a draft, and tells a frozen text from a refused draft when nothing was deleted", async () => {
		const deleting = (remaining: string | null) =>
			createSupabaseManualSource(
				fakeClient((recorded) => {
					if (called(recorded, "delete").length > 0) {
						return { data: [], error: null };
					}
					return {
						data: remaining === null ? [] : [{ status: remaining }],
						error: null,
					};
				}).client,
			);
		await expect(
			deleting(null).deleteLegalDraft(TENANT, DOCUMENT_ID),
		).resolves.toBeUndefined();
		await expect(
			deleting("published").deleteLegalDraft(TENANT, DOCUMENT_ID),
		).rejects.toMatchObject({ code: "frozen" });
		await expect(
			deleting("draft").deleteLegalDraft(TENANT, DOCUMENT_ID),
		).rejects.toMatchObject({ code: "forbidden" });
		const removed = createSupabaseManualSource(
			fakeClient(() => ({ data: [{ id: COST_ID }], error: null })).client,
		);
		await expect(
			removed.deleteItemCost(TENANT, COST_ID),
		).resolves.toBeUndefined();
	});
});
