import { DemoSettingsStore, demoSettings } from "@fnb/demo-analytics";
import { describe, expect, it } from "vitest";
import { SettingsWriteError } from "../source";
import { writeErrorKey } from "../use-settings-mutation";
import { createDemoManualSource } from "./demo-manual-source";

const TENANT = "demo";
const AS_OF = "2026-11-03";

function clock(): () => Date {
	let minute = 0;
	return () => {
		minute += 1;
		return new Date(Date.UTC(2026, 10, 3, 8, minute));
	};
}

function fresh() {
	const store = new DemoSettingsStore(demoSettings(AS_OF));
	return { store, source: createDemoManualSource(store, clock()) };
}

describe("the demo manual settings source", () => {
	it("keeps a tenant-wide and a store cost of the same item and date as two rows, and updates a row saved again", async () => {
		const { store, source } = fresh();
		const cost = {
			storeId: null,
			itemExternalId: "DR-001-M",
			costAmount: 15_000,
			effectiveFrom: "2023-01-01",
		};
		const saved = await source.saveItemCosts(TENANT, [
			cost,
			{ ...cost, storeId: "MOCK-S1", costAmount: 16_000 },
		]);
		expect(saved.map((row) => [row.storeId, row.costAmount])).toEqual([
			[null, 15_000],
			["MOCK-S1", 16_000],
		]);
		await source.saveItemCosts(TENANT, [{ ...cost, costAmount: 14_500 }]);
		const rows = await source.itemCosts(TENANT);
		expect(rows.map((row) => [row.storeId, row.costAmount])).toEqual([
			[null, 14_500],
			["MOCK-S1", 16_000],
		]);
		expect(rows.every((row) => row.audit?.author.kind === "you")).toBe(true);
		expect(store.costsConfigured("MOCK-S2")).toBe(true);
		await source.deleteItemCost(TENANT, rows[1]?.id ?? "");
		expect((await source.itemCosts(TENANT)).map((row) => row.storeId)).toEqual([
			null,
		]);
	});

	it("saves a batch of costs whole or not at all", async () => {
		const { source } = fresh();
		await expect(
			source.saveItemCosts(TENANT, [
				{
					storeId: null,
					itemExternalId: "DR-001-M",
					costAmount: 15_000,
					effectiveFrom: "2023-01-01",
				},
				{
					storeId: null,
					itemExternalId: "DR-002-M",
					costAmount: -5,
					effectiveFrom: "2023-01-01",
				},
			]),
		).rejects.toMatchObject({
			code: "invalid",
			constraint: "item_costs_amount_whole_dong",
		});
		expect(await source.itemCosts(TENANT)).toEqual([]);
	});

	it.each([
		["a fraction of a đồng", 15_000.5],
		["more than 100,000,000", 100_000_001],
		["a negative cost", -1],
	])(
		"refuses %s like the database check, worded as the amount refusal",
		async (_name, costAmount) => {
			const { source } = fresh();
			const refusal = await source
				.saveItemCosts(TENANT, [
					{
						storeId: null,
						itemExternalId: "DR-001-M",
						costAmount,
						effectiveFrom: "2023-01-01",
					},
				])
				.catch((error: unknown) => error);
			expect(refusal).toBeInstanceOf(SettingsWriteError);
			const { code, constraint } = refusal as SettingsWriteError;
			expect(writeErrorKey(code, constraint)).toBe(
				"settings.manual.costs.amountRefused",
			);
			expect(await source.itemCosts(TENANT)).toEqual([]);
		},
	);

	it("keeps a cost of exactly 100,000,000 and of 0", async () => {
		const { source } = fresh();
		await source.saveItemCosts(TENANT, [
			{
				storeId: null,
				itemExternalId: "DR-001-M",
				costAmount: 100_000_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: null,
				itemExternalId: "DR-002-M",
				costAmount: 0,
				effectiveFrom: "2023-01-01",
			},
		]);
		expect(
			(await source.itemCosts(TENANT)).map((row) => row.costAmount),
		).toEqual([100_000_000, 0]);
	});

	it("reads the demo's monthly targets and upserts one on its store, period and start", async () => {
		const { source } = fresh();
		const before = await source.targets(TENANT);
		expect(before.length).toBeGreaterThan(0);
		const [first] = before;
		if (first === undefined) throw new Error("no demo target");
		expect(first.audit).toBeNull();
		await source.saveTargets(TENANT, [
			{
				storeId: first.storeId,
				periodKind: first.periodKind,
				periodStart: first.periodStart,
				netTargetAmount: 99_000_000,
			},
			{
				storeId: "MOCK-S2",
				periodKind: "month",
				periodStart: "2026-12-01",
				netTargetAmount: 50_000_000,
			},
		]);
		const after = await source.targets(TENANT);
		expect(after).toHaveLength(before.length + 1);
		expect(after.find((row) => row.id === first.id)).toMatchObject({
			netTargetAmount: 99_000_000,
			audit: { author: { kind: "you" } },
		});
	});

	it("drafts, edits, publishes, replaces and retires legal texts as the database's functions do", async () => {
		const { source } = fresh();
		const [skeleton] = await source.legalDocuments(TENANT);
		expect(skeleton).toMatchObject({
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-notice-2026-11",
			status: "draft",
			publishedAt: null,
		});
		if (skeleton === undefined) throw new Error("no draft");
		const edited = await source.saveLegalDraft(TENANT, {
			id: skeleton.id,
			kind: "privacy_notice",
			language: "vi",
			version: skeleton.version,
			title: skeleton.title,
			bodyMarkdown: `${skeleton.bodyMarkdown}\n\nNội dung.`,
		});
		expect(edited.bodyMarkdown.endsWith("Nội dung.")).toBe(true);
		await source.publishLegalDocument(TENANT, edited.id);
		const second = await source.saveLegalDraft(TENANT, {
			kind: "privacy_notice",
			language: "vi",
			version: "privacy-notice-2026-12",
			title: "Thông báo bảo mật",
			bodyMarkdown: "Bản mới.",
		});
		expect(second.status).toBe("draft");
		await source.publishLegalDocument(TENANT, second.id);
		const statuses = await source.legalDocuments(TENANT);
		expect(statuses.map((row) => [row.version, row.status])).toEqual([
			["privacy-notice-2026-11", "retired"],
			["privacy-notice-2026-12", "published"],
		]);
		const retired = statuses[0];
		expect(retired?.retiredAt).toBe(statuses[1]?.publishedAt);
		await source.retireLegalDocument(TENANT, second.id);
		expect(
			(await source.legalDocuments(TENANT)).map((row) => row.status),
		).toEqual(["retired", "retired"]);
	});

	it("refuses what the database refuses on a legal text", async () => {
		const { source } = fresh();
		const [skeleton] = await source.legalDocuments(TENANT);
		if (skeleton === undefined) throw new Error("no draft");
		await expect(
			source.retireLegalDocument(TENANT, skeleton.id),
		).rejects.toMatchObject({ code: "invalid" });
		await source.publishLegalDocument(TENANT, skeleton.id);
		await expect(
			source.publishLegalDocument(TENANT, skeleton.id),
		).rejects.toMatchObject({ code: "invalid" });
		await expect(
			source.saveLegalDraft(TENANT, {
				id: skeleton.id,
				kind: "privacy_notice",
				language: "vi",
				version: skeleton.version,
				title: "Sửa sau khi công bố",
				bodyMarkdown: skeleton.bodyMarkdown,
			}),
		).rejects.toMatchObject({ code: "frozen" });
		await expect(
			source.deleteLegalDraft(TENANT, skeleton.id),
		).rejects.toMatchObject({ code: "frozen" });
		await expect(
			source.publishLegalDocument(TENANT, "legal:none"),
		).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			source.saveLegalDraft(TENANT, {
				kind: "staff_notice",
				language: "vi",
				version: "Bản 1",
				title: "Thông báo cho nhân viên",
				bodyMarkdown: "Nội dung.",
			}),
		).rejects.toMatchObject({ code: "invalid", constraint: "versionLabel" });
		const draft = await source.saveLegalDraft(TENANT, {
			kind: "staff_notice",
			language: "en",
			version: "staff-notice-2026-11",
			title: "Staff notice",
			bodyMarkdown: "Text.",
		});
		await source.deleteLegalDraft(TENANT, draft.id);
		expect(
			(await source.legalDocuments(TENANT)).map((row) => row.kind),
		).toEqual(["privacy_notice"]);
	});

	it("lists costs, targets and legal texts in the live order and refuses a batch that names one key twice", async () => {
		const { source } = fresh();
		const cost = {
			storeId: "MOCK-S1",
			itemExternalId: "TP-001",
			costAmount: 3_000,
			effectiveFrom: "2026-01-01",
		};
		await source.saveItemCosts(TENANT, [cost]);
		await source.saveItemCosts(TENANT, [
			{ ...cost, itemExternalId: "DR-001-M" },
			{ ...cost, storeId: null },
		]);
		expect(
			(await source.itemCosts(TENANT)).map((row) => [
				row.itemExternalId,
				row.storeId,
			]),
		).toEqual([
			["DR-001-M", "MOCK-S1"],
			["TP-001", null],
			["TP-001", "MOCK-S1"],
		]);
		await expect(
			source.saveItemCosts(TENANT, [cost, { ...cost, costAmount: 4_000 }]),
		).rejects.toMatchObject({ code: "duplicate" });
		const target = {
			storeId: "MOCK-S1",
			periodKind: "week",
			periodStart: "2026-11-02",
			netTargetAmount: 1,
		} as const;
		await expect(
			source.saveTargets(TENANT, [target, target]),
		).rejects.toMatchObject({ code: "duplicate" });
		const targets = await source.targets(TENANT);
		const keys = targets.map(
			(row) => `${row.storeId}|${row.periodKind}|${row.periodStart}`,
		);
		expect(keys).toEqual([...keys].sort());
		await source.saveLegalDraft(TENANT, {
			kind: "data_protection_rules",
			language: "vi",
			version: "data-protection-rules-2026-11",
			title: "Quy định",
			bodyMarkdown: "Nội dung.",
		});
		expect(
			(await source.legalDocuments(TENANT)).map((row) => row.kind),
		).toEqual(["data_protection_rules", "privacy_notice"]);
	});
});
