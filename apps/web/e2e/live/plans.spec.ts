import { buildDataPack, type DataPack, lintPlan } from "@fnb/datapack";
import { samplePlan } from "@fnb/datapack/testing";
import { addDays, createRpcReportSource } from "@fnb/reports";
import { expect, type Page, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPage } from "../support/checks";
import { isLocalStackConfigured } from "../support/local-stack";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	createSettingsFixture,
	FIXTURE_SLUG_PREFIX,
	type SettingsFixture,
} from "../support/settings-fixture";

test.skip(
	!isLocalStackConfigured,
	"the local Supabase stack is not configured in .env.local",
);

test.describe.configure({ mode: "serial" });

const BUILD_TIMEOUT = 120_000;

let fixture: SettingsFixture;
let pack: DataPack;
let planText: string;

function fenceOf(client: SupabaseClient, storeIds: readonly string[]) {
	return async () => {
		const { data, error } = await client.rpc("pack_fence", {
			store_ids: [...storeIds],
		});
		if (error) throw error;
		return data as string;
	};
}

test.beforeAll(async () => {
	fixture = await createSettingsFixture();
	if (!fixture.slug.startsWith(FIXTURE_SLUG_PREFIX)) {
		throw new Error(
			"plans.spec.ts creates and deletes plans: it runs only on its own seeded fixture tenant",
		);
	}
	const owner = await fixture.clientAs("owner");
	const built = await buildDataPack(
		{
			storeIds: [...fixture.storeIds],
			asOf: fixture.sales.to,
			horizon: "90d",
			language: "vi",
			focus: null,
			ownerNote: null,
			sample: false,
		},
		{
			source: createRpcReportSource(
				{ rpc: (fn, args) => owner.rpc(fn, args) },
				"supabase",
			),
			clock: { now: () => new Date() },
			fence: fenceOf(owner, fixture.storeIds),
		},
	);
	pack = built.pack;
	planText = samplePlan(pack);
	expect(lintPlan(planText, pack).ok).toBe(true);
});

test.afterAll(async () => {
	await fixture?.teardown();
});

async function pasteWithPack(page: Page): Promise<void> {
	await page.goto("/#/ke-hoach/dan");
	await page
		.getByRole("textbox", { name: "Kế hoạch của trợ lý" })
		.fill(planText);
	await page
		.getByTestId("plan-form")
		.getByRole("button", { name: "Kiểm tra", exact: true })
		.click();
	const missing = page.getByTestId("plan-pack-missing");
	const result = page.getByTestId("plan-result");
	await expect(missing.or(result)).toBeVisible();
	if (await missing.isVisible()) {
		await missing.getByTestId("plan-pack-file").setInputFiles({
			name: "goi-du-lieu.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(pack)),
		});
	}
	await expect(result).toHaveAttribute("data-ok", "true");
}

test("a pasted plan lands in Kế hoạch as Dán, its KPI values equal metric_windows for the same user, a repeat finds it, and it archives and deletes", async ({
	page,
}) => {
	test.setTimeout(BUILD_TIMEOUT * 2);
	watchConsoleErrors(page);
	await fixture.signIn(page, "owner");
	await pasteWithPack(page);
	await page.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();
	await expect(page).toHaveURL(/#\/ke-hoach\/[0-9a-f-]{36}$/);
	const planId = page.url().split("/").pop() as string;
	await expect(page.getByTestId("plan-saved-note")).toHaveText(
		"Đã lưu kế hoạch.",
	);
	await expect(page.getByTestId("plan-pack-badge")).toHaveText("Mã gói khớp");

	const table = page.getByTestId("kpi-table");
	await expect(page.getByTestId("kpi-row")).toHaveCount(3, {
		timeout: BUILD_TIMEOUT,
	});
	const asOf = (await table.getAttribute("data-as-of")) as string;
	const owner = await fixture.clientAs("owner");
	const { data: stored } = await owner
		.from("strategy_reports")
		.select("kpis,generated_via,created_by")
		.eq("id", planId)
		.single();
	expect(stored?.generated_via).toBe("pasted");
	expect(stored?.created_by).toBe(fixture.logins.owner.userId);
	const kpis = stored?.kpis as Record<string, { store_ids: string[] }>;
	for (const [metricId, kpi] of Object.entries(kpis)) {
		const { data, error } = await owner.rpc("metric_windows", {
			store_ids: kpi.store_ids,
			metric_ids: [metricId],
			from_dates: [addDays(asOf, -27)],
			to_dates: [asOf],
		});
		expect(error).toBeNull();
		const expected = (data as { value: number | null }[])[0]?.value ?? null;
		const cell = page.locator(
			`[data-testid=kpi-row][data-metric=${metricId}] [data-testid=kpi-current]`,
		);
		const shown = await cell.getAttribute("data-value");
		if (expected === null) expect(shown).toBe("");
		else expect(Number(shown)).toBeCloseTo(Number(expected), 6);
	}
	await checkPage(page);

	await page.goto("/#/ke-hoach");
	const card = page.locator(
		`[data-testid=plan-card][data-plan-id="${planId}"]`,
	);
	await expect(card.getByTestId("plan-via")).toHaveText("Dán");
	await expect(card.getByTestId("plan-version")).toHaveText("Bản 1");
	await expect(card.getByTestId("plan-follow-up")).toHaveText(
		/^\d+\/3 KPI đúng tiến độ$/,
		{ timeout: BUILD_TIMEOUT },
	);
	await checkPage(page);

	await pasteWithPack(page);
	await page.getByRole("button", { name: "Lưu kế hoạch", exact: true }).click();
	await expect(page.getByTestId("plan-saved-note")).toHaveText(
		"Kế hoạch này đã được lưu.",
	);
	expect(page.url().endsWith(planId)).toBe(true);

	await page.getByTestId("plan-archive").click();
	await expect(page.getByTestId("plan-archive")).toHaveText("Bỏ lưu trữ");
	await page.goto("/#/ke-hoach");
	await expect(page.getByTestId("plans-empty")).toBeVisible();
	await page.getByTestId("plans-show-archived").check();
	await expect(card).toBeVisible();
	await page.goto(`/#/ke-hoach/${planId}`);
	await page.getByTestId("plan-delete").click();
	await page.getByTestId("plan-delete-confirm").click();
	await expect(page).toHaveURL(/#\/ke-hoach$/);
	const { count } = await owner
		.from("strategy_reports")
		.select("id", { count: "exact", head: true })
		.eq("id", planId);
	expect(count).toBe(0);
	expectNoConsoleErrors(page);
});

test("a viewer reads the plan without actions, and the publisher reads no plan and cannot insert one directly", async ({
	page,
}) => {
	const owner = await fixture.clientAs("owner");
	const { data: published, error } = await owner.rpc("publish_strategy_plan", {
		...(await import("@fnb/datapack")).planRecord(
			lintPlan(planText, pack).plan as NonNullable<
				ReturnType<typeof lintPlan>["plan"]
			>,
			pack,
			lintPlan(planText, pack),
			"pasted",
		),
	});
	expect(error).toBeNull();
	const planId = (published as { plan_id: string }[])[0]?.plan_id as string;
	await fixture.signIn(page, "viewer");
	await page.goto(`/#/ke-hoach/${planId}`);
	await expect(page.getByTestId("plan-detail")).toBeVisible();
	await expect(page.getByTestId("plan-actions")).toHaveCount(0);

	const publisherLogin = await fixture.addPublisher();
	const { anonymousClient } = await import("../support/local-stack");
	const publisher = anonymousClient();
	await publisher.auth.signInWithPassword({
		email: publisherLogin.email,
		password: publisherLogin.password,
	});
	const { data: seen } = await publisher.from("strategy_reports").select("id");
	expect(seen).toEqual([]);
	const { error: insertError } = await publisher
		.from("strategy_reports")
		.insert({
			tenant_id: fixture.tenantId,
			store_ids: [...fixture.storeIds],
			horizon: "90d",
			language: "vi",
			generated_via: "skill",
			title: "Planted",
			content_markdown: "x",
		});
	expect(insertError?.code).toBe("42501");
	await owner.from("strategy_reports").delete().eq("id", planId);
});
