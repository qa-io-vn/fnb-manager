import { lintPlan, planRecord } from "@fnb/datapack";
import { miniPack, samplePlan } from "@fnb/datapack/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoPlanSource, DEMO_PLANS_KEY } from "./demo-plan-source";
import {
	createSupabasePlanSource,
	keysetFilter,
	PLAN_DETAIL_COLUMNS,
	PLAN_LIST_COLUMNS,
	type PlanDetail,
	PlanSourceError,
	summaryOf,
} from "./source";

const pack = miniPack();
const lint = lintPlan(samplePlan(pack), pack);
if (lint.plan === null) throw new Error("the sample plan does not parse");
const record = planRecord(lint.plan, pack, lint, "pasted");

function detail(
	id: string,
	createdAt: string,
	extra: Partial<PlanDetail> = {},
): PlanDetail {
	return {
		id,
		title: `Plan ${id}`,
		storeIds: record.p_store_ids,
		createdAt,
		asOf: record.p_as_of_date,
		horizon: record.p_horizon,
		language: record.p_language,
		via: "pasted",
		kpis: record.p_kpis,
		lint: record.p_lint,
		archivedAt: null,
		promptVersion: record.p_prompt_version,
		packId: record.p_pack_id,
		content: `${record.p_content_markdown}${id}`,
		pack,
		...extra,
	};
}

afterEach(() => {
	window.sessionStorage.clear();
});

describe("the list query", () => {
	it("reads only the list columns, never the body or the pack", () => {
		expect(PLAN_LIST_COLUMNS).not.toContain("content_markdown");
		expect(PLAN_LIST_COLUMNS).not.toContain("data_pack");
		expect(PLAN_DETAIL_COLUMNS).toContain("content_markdown");
	});

	it("builds a keyset filter on created_at then id, quoting the timestamp", () => {
		expect(
			keysetFilter({ createdAt: "2026-11-20T10:00:00.5+00:00", id: "abc" }),
		).toBe(
			'created_at.lt."2026-11-20T10:00:00.5+00:00",and(created_at.eq."2026-11-20T10:00:00.5+00:00",id.lt.abc)',
		);
	});

	it("maps a row and defaults missing JSON to empty values", () => {
		const summary = summaryOf({
			id: "p",
			title: "T",
			store_ids: null,
			created_at: "2026-11-20T00:00:00Z",
			as_of_date: "2026-11-19",
			horizon: "90d",
			language: "vi",
			generated_via: "routine",
			kpis: null,
			lint: null,
			archived_at: null,
			prompt_version: "1.0.0",
			pack_id: "a".repeat(64),
		});
		expect(summary.storeIds).toEqual([]);
		expect(summary.kpis).toEqual({});
		expect(summary.via).toBe("routine");
	});

	it("sends the supabase query newest first, 50 at a time, unarchived unless asked, after the cursor", async () => {
		const calls: [string, unknown[]][] = [];
		const builder = Object.assign(
			Promise.resolve({ data: [], error: null }),
		) as Promise<unknown> & Record<string, unknown>;
		for (const name of ["select", "eq", "order", "limit", "is", "or"]) {
			builder[name] = (...args: unknown[]) => {
				calls.push([name, args]);
				return builder;
			};
		}
		const client = { from: vi.fn(() => builder) };
		const source = createSupabasePlanSource(client as never);
		await source.list({
			tenantId: "t",
			archived: false,
			after: { createdAt: "2026-11-20T00:00:00Z", id: "x" },
		});
		expect(client.from).toHaveBeenCalledWith("strategy_reports");
		expect(calls).toEqual([
			["select", [PLAN_LIST_COLUMNS]],
			["eq", ["tenant_id", "t"]],
			["order", ["created_at", { ascending: false }]],
			["order", ["id", { ascending: false }]],
			["limit", [50]],
			["is", ["archived_at", null]],
			["or", [keysetFilter({ createdAt: "2026-11-20T00:00:00Z", id: "x" })]],
		]);
		calls.length = 0;
		await source.list({ tenantId: "t", archived: true, after: null });
		expect(calls.map(([name]) => name)).toEqual([
			"select",
			"eq",
			"order",
			"order",
			"limit",
		]);
	});

	it("publishes through the RPC and turns its errors into PlanSourceError with code and details", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValueOnce({
				data: [{ plan_id: "p1", already_published: true }],
				error: null,
			})
			.mockResolvedValueOnce({
				data: null,
				error: {
					code: "22023",
					details: "section_missing:7",
					message: "plan_rejected",
				},
			});
		const source = createSupabasePlanSource({ rpc } as never);
		await expect(source.publish(record)).resolves.toEqual({
			planId: "p1",
			alreadyPublished: true,
		});
		expect(rpc).toHaveBeenCalledWith("publish_strategy_plan", { ...record });
		const failure = await source
			.publish(record)
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(PlanSourceError);
		expect(failure).toMatchObject({
			code: "22023",
			details: "section_missing:7",
		});
	});
});

describe("the demo plan source", () => {
	const seed = vi.fn(async () => detail("seed", "2026-11-12T00:00:00.000Z"));
	let counter = 0;
	const source = () =>
		createDemoPlanSource({
			tenantId: "demo",
			seed,
			now: () => new Date("2026-11-20T00:00:00.000Z"),
			newId: () => `id-${++counter}`,
		});

	it("seeds the sample plan once per session and lists it", async () => {
		seed.mockClear();
		const plans = source();
		expect(
			(
				await plans.list({ tenantId: "demo", archived: false, after: null })
			).map((p) => p.id),
		).toEqual(["seed"]);
		await source().list({ tenantId: "demo", archived: false, after: null });
		expect(seed).toHaveBeenCalledTimes(1);
		expect(window.sessionStorage.getItem(DEMO_PLANS_KEY)).toContain("seed");
		expect(window.localStorage.getItem(DEMO_PLANS_KEY)).toBeNull();
	});

	it("saves a pasted plan, answers a repeat with the same id, and keeps the list newest first", async () => {
		const plans = source();
		const first = await plans.publish(record);
		expect(first.alreadyPublished).toBe(false);
		expect(await plans.publish(record)).toEqual({
			planId: first.planId,
			alreadyPublished: true,
		});
		const listed = await plans.list({
			tenantId: "demo",
			archived: false,
			after: null,
		});
		expect(listed[0]?.id).toBe(first.planId);
		expect(listed).toHaveLength(2);
		expect(await plans.get(first.planId)).toMatchObject({
			content: record.p_content_markdown,
		});
	});

	it("hides archived plans until asked, renames and deletes", async () => {
		const plans = source();
		await plans.setArchived("seed", true);
		expect(
			await plans.list({ tenantId: "demo", archived: false, after: null }),
		).toEqual([]);
		expect(
			await plans.list({ tenantId: "demo", archived: true, after: null }),
		).toHaveLength(1);
		await plans.rename("seed", "Đổi tên");
		expect((await plans.get("seed"))?.title).toBe("Đổi tên");
		await plans.remove("seed");
		expect(await plans.get("seed")).toBeNull();
	});

	it("pages by the keyset so every plan shows once", async () => {
		const plans = createDemoPlanSource({
			tenantId: "demo",
			seed: async () => null,
			now: () => new Date("2026-11-20T00:00:00.000Z"),
			newId: () => `n-${++counter}`,
		});
		window.sessionStorage.setItem(
			DEMO_PLANS_KEY,
			JSON.stringify(
				Array.from({ length: 5 }, (_, index) => ({
					...detail(`p${index}`, `2026-11-1${index}T00:00:00.000Z`),
					tenantId: "demo",
				})),
			),
		);
		const first = await plans.list({
			tenantId: "demo",
			archived: false,
			after: null,
			limit: 2,
		});
		const last = first[first.length - 1];
		if (last === undefined) throw new Error("empty page");
		const second = await plans.list({
			tenantId: "demo",
			archived: false,
			after: { createdAt: last.createdAt, id: last.id },
			limit: 10,
		});
		expect([...first, ...second].map((plan) => plan.id)).toEqual([
			"p4",
			"p3",
			"p2",
			"p1",
			"p0",
		]);
	});

	it("keeps another tenant's demo plans apart", async () => {
		await source().publish(record);
		const other = createDemoPlanSource({
			tenantId: "other",
			seed: async () => null,
		});
		expect(
			await other.list({ tenantId: "other", archived: true, after: null }),
		).toEqual([]);
	});
});
