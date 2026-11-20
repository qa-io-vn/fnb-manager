import { lintPlan, planRecord } from "@fnb/datapack";
import { miniPack, samplePlan } from "@fnb/datapack/testing";
import { describe, expect, it } from "vitest";
import { type Translate, translate } from "../../i18n";
import type { CheckedPlan } from "../../plans/paste-check";
import { type PlanDetail, PlanSourceError } from "../../plans/source";
import {
	canManagePlan,
	canPublishPlans,
	canReadPlans,
} from "../../plans/use-plans";
import { vndFormatters } from "../../test/render";
import { publishInput, saveStateOf } from "./paste-page";
import {
	comparisonCalls,
	comparisonInput,
	orderedPair,
} from "./plan-compare-page";
import { kpiRowView, packIdMatches, previousPlanOf } from "./plan-detail-page";
import { groupPlans } from "./plans-list-page";

const pack = miniPack();
const lint = lintPlan(samplePlan(pack), pack);
if (lint.plan === null) throw new Error("the sample plan does not parse");
const record = planRecord(lint.plan, pack, lint, "pasted");
const [S1, S2] = pack.request.stores.map((store) => store.id) as [
	string,
	string,
];

function plan(
	id: string,
	createdAt: string,
	storeIds: string[],
	extra: Partial<PlanDetail> = {},
): PlanDetail {
	return {
		id,
		title: `Plan ${id}`,
		storeIds,
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
		content: record.p_content_markdown,
		pack,
		...extra,
	};
}

describe("the plan list", () => {
	const plans = [
		plan("c", "2026-11-03T00:00:00Z", [S2, S1]),
		plan("a", "2026-11-01T00:00:00Z", [S1, S2]),
		plan("s", "2026-11-04T00:00:00Z", [S1]),
		plan("b", "2026-11-02T00:00:00Z", [S1, S2]),
	];

	it("groups by sorted store set, newest group and newest plan first, numbered by creation within the set", () => {
		const groups = groupPlans(plans);
		expect(groups.map((group) => group.key)).toEqual([
			S1,
			[S1, S2].sort().join(","),
		]);
		expect(
			groups[1]?.plans.map(({ plan: p, version }) => `${p.id}:${version}`),
		).toEqual(["c:3", "b:2", "a:1"]);
		expect(groups[0]?.plans[0]?.version).toBe(1);
	});

	it("gives no group for no plan", () => {
		expect(groupPlans([])).toEqual([]);
	});
});

describe("the plan detail", () => {
	it("finds the previous plan of the same store set only", () => {
		const list = [
			plan("old", "2026-10-01T00:00:00Z", [S2, S1]),
			plan("other", "2026-10-15T00:00:00Z", [S1]),
			plan("mid", "2026-10-20T00:00:00Z", [S1, S2]),
			plan("new", "2026-11-01T00:00:00Z", [S1, S2]),
		];
		expect(previousPlanOf(list[3] as PlanDetail, list)?.id).toBe("mid");
		expect(previousPlanOf(list[0] as PlanDetail, list)).toBeNull();
	});

	it("says Mã gói khớp for the stored pack and not for an altered one", async () => {
		expect(await packIdMatches(pack)).toBe(true);
		expect(await packIdMatches({ ...pack, sample: !pack.sample })).toBe(false);
	});

	it("formats the KPI row in the metric's unit and shows ≠ for a baseline that changed", () => {
		const t: Translate = (key, params) => translate("vi", key, params);
		const formatters = vndFormatters();
		const kpi = record.p_kpis.avg_ticket ?? Object.values(record.p_kpis)[0];
		if (kpi === undefined) throw new Error("no KPI");
		const metricId = Object.keys(record.p_kpis).find(
			(id) => record.p_kpis[id] === kpi,
		) as string;
		const base = {
			metricId,
			key: metricId,
			kpi,
			current: kpi.baseline * 1.02,
			remeasured: kpi.baseline,
			baselineChanged: false,
			status: "on_track" as const,
			progress: 0.4,
			withinBand: false,
		};
		const same = kpiRowView(base, formatters, t, () => "ALL");
		expect(same.baseline).not.toContain("≠");
		expect(same.label).toBe(t(`metric.${metricId}.label` as never));
		const changed = kpiRowView(
			{ ...base, remeasured: kpi.baseline * 1.5, baselineChanged: true },
			formatters,
			t,
			() => "ALL",
		);
		expect(changed.baseline).toContain("≠");
		expect(
			kpiRowView({ ...base, current: null }, formatters, t, () => "ALL")
				.current,
		).toBe("—");
	});
});

describe("who may read, publish and manage plans", () => {
	it.each([
		{ role: "owner", storeIds: null, read: true, publish: true, manage: true },
		{
			role: "manager",
			storeIds: null,
			read: true,
			publish: true,
			manage: true,
		},
		{
			role: "manager",
			storeIds: ["S1-only"],
			read: true,
			publish: true,
			manage: false,
		},
		{
			role: "staff",
			storeIds: null,
			read: true,
			publish: false,
			manage: false,
		},
		{
			role: "viewer",
			storeIds: null,
			read: true,
			publish: false,
			manage: false,
		},
		{
			role: "publisher",
			storeIds: null,
			read: false,
			publish: false,
			manage: false,
		},
	] as const)(
		"$role with stores $storeIds",
		({ role, storeIds, read, publish, manage }) => {
			const membership = { role, storeIds };
			expect(canReadPlans(membership)).toBe(read);
			expect(canPublishPlans(membership)).toBe(publish);
			expect(canManagePlan(membership, ["a", "b"])).toBe(manage);
		},
	);

	it("lets a one-store manager manage a plan of that store only", () => {
		expect(canManagePlan({ role: "manager", storeIds: ["a"] }, ["a"])).toBe(
			true,
		);
		expect(canManagePlan(null, ["a"])).toBe(false);
		expect(canReadPlans(null)).toBe(false);
	});
});

describe("saving from the paste box", () => {
	const checked = (sample: boolean, ok = true) =>
		({
			lint: { ...lint, ok },
			pack: { packId: pack.pack_id, pack: { ...pack, sample }, text: "" },
		}) as unknown as CheckedPlan;

	it("builds the publish arguments with the source pasted", () => {
		const input = publishInput(checked(false), false);
		expect(input?.p_generated_via).toBe("pasted");
		expect(input?.p_store_ids).toEqual([S1, S2]);
		expect(input?.p_data_pack.sample).toBe(false);
	});

	it("never sends a sample pack outside the demo, and keeps it in the demo", () => {
		expect(publishInput(checked(true), false)).toBeNull();
		expect(publishInput(checked(true), true)?.p_data_pack.sample).toBe(true);
	});

	it("never sends a plan with lint errors", () => {
		expect(publishInput(checked(false, false), false)).toBeNull();
	});

	it.each([
		{
			error: new PlanSourceError("42501", null, "plan_scope_denied"),
			kind: "denied",
		},
		{
			error: new PlanSourceError("22023", "section_missing:7", "plan_rejected"),
			kind: "rejected",
		},
		{
			error: new PlanSourceError("22023", "plan_rate_limited", "plan_rejected"),
			kind: "limited",
		},
		{ error: new TypeError("network"), kind: "failed" },
	])("maps $kind", ({ error, kind }) => {
		expect(saveStateOf(error).kind).toBe(kind);
	});

	it("keeps the codes of a rejection", () => {
		expect(
			saveStateOf(new PlanSourceError("22023", "kpi_unknown:net_sales", "x")),
		).toEqual({
			kind: "rejected",
			codes: "kpi_unknown:net_sales",
		});
	});
});

describe("the comparison", () => {
	it("orders the two plans older first whatever the URL says", () => {
		const older = plan("o", "2026-10-01T00:00:00Z", [S1, S2]);
		const newer = plan("n", "2026-11-01T00:00:00Z", [S1, S2]);
		expect(orderedPair(newer, older).map((p) => p.id)).toEqual(["o", "n"]);
	});

	it("needs one metric_windows call per store set across both plans", () => {
		const one = plan("o", "2026-10-01T00:00:00Z", [S1, S2]);
		const kpi = Object.values(record.p_kpis)[0];
		if (kpi === undefined) throw new Error("no KPI");
		const two = plan("n", "2026-11-01T00:00:00Z", [S1, S2], {
			kpis: { invoices: { ...kpi, store_ids: [S1] } },
		});
		const calls = comparisonCalls([one, two], "2026-11-20");
		expect(calls).toHaveLength(2);
		expect(calls.every((call) => call.fromDates.length === 1)).toBe(true);
	});

	it("reads the initiative titles from the stored text", () => {
		expect(
			comparisonInput(plan("o", "2026-10-01T00:00:00Z", [S1, S2]))
				.initiativeTitles,
		).toHaveLength(lint.plan?.initiatives.length ?? -1);
	});
});
