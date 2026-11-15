import { DEMO_POS_ACCOUNT_ID, DemoSettingsStore } from "@fnb/demo-analytics";
import { DEFAULT_REPORT_SETTINGS } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { createDemoSettingsSource } from "./demo-settings-source";
import { SettingsWriteError } from "./source";

const TENANT = "demo";

describe("the demo settings source", () => {
	it("lets the demo visitor act as an owner of every store", async () => {
		const source = createDemoSettingsSource(new DemoSettingsStore());
		expect(await source.membership(TENANT)).toEqual({
			role: "owner",
			storeIds: null,
		});
	});

	it("lists the demo menu's item types with their roles and saves a change into the shared store", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		const before = await source.itemTypes(TENANT);
		expect(before.length).toBeGreaterThan(5);
		expect(before[0]?.posAccountId).toBe(DEMO_POS_ACCOUNT_ID);
		const target = before.find((entry) => entry.role === "drink");
		expect(target).toBeDefined();
		const version = store.version;
		await source.saveRoles(TENANT, [
			{
				posAccountId: DEMO_POS_ACCOUNT_ID,
				itemTypeExternalId: target?.itemTypeExternalId ?? "",
				role: "food",
			},
		]);
		expect(store.version).toBeGreaterThan(version);
		const after = await source.itemTypes(TENANT);
		expect(
			after.find(
				(entry) => entry.itemTypeExternalId === target?.itemTypeExternalId,
			)?.role,
		).toBe("food");
		expect(after.filter((entry) => entry.role !== null)).toHaveLength(
			before.filter((entry) => entry.role !== null).length,
		);
	});

	it("reads the defaults until thresholds are saved, then the saved row", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		});
		const saved = { ...DEFAULT_REPORT_SETTINGS, cashAbsThreshold: 80_000 };
		await source.saveReportSettings(TENANT, saved);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: saved,
			hasRow: true,
			audit: { changedAt: expect.any(String), author: { kind: "you" } },
		});
		expect((await source.catchUpStatus(TENANT)).pendingDays).toBe(0);
	});

	it("merges a change into the saved thresholds", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await source.saveReportSettings(TENANT, { cashAbsThreshold: 80_000 });
		await source.saveReportSettings(TENANT, { peakHours: 4 });
		expect(store.reportSettings()).toEqual({
			...DEFAULT_REPORT_SETTINGS,
			cashAbsThreshold: 80_000,
			peakHours: 4,
		});
	});

	it("removes the row when a save leaves every threshold at its default", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await source.saveReportSettings(TENANT, { peakHours: 4 });
		expect(store.hasReportSettingsRow()).toBe(true);
		await source.saveReportSettings(TENANT, { peakHours: 3 });
		expect(store.hasReportSettingsRow()).toBe(false);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			hasRow: false,
			audit: null,
		});
	});

	it("remembers when the thresholds were saved for every source of the same store", async () => {
		const store = new DemoSettingsStore();
		await createDemoSettingsSource(store).saveReportSettings(TENANT, {
			...DEFAULT_REPORT_SETTINGS,
			peakHours: 4,
		});
		const reopened =
			await createDemoSettingsSource(store).reportSettings(TENANT);
		expect(reopened.hasRow).toBe(true);
		expect(Number.isNaN(Date.parse(reopened.audit?.changedAt ?? ""))).toBe(
			false,
		);
		const other = await createDemoSettingsSource(
			new DemoSettingsStore(),
		).reportSettings(TENANT);
		expect(other.audit).toBeNull();
	});

	it("leaves a refused save without an audit stamp", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoSettingsSource(store);
		await expect(
			source.saveReportSettings(TENANT, {
				...DEFAULT_REPORT_SETTINGS,
				peakHours: 9,
			}),
		).rejects.toBeInstanceOf(SettingsWriteError);
		expect((await source.reportSettings(TENANT)).audit).toBeNull();
	});

	it("refuses a threshold out of range as invalid, naming the field", async () => {
		const source = createDemoSettingsSource(new DemoSettingsStore());
		await expect(
			source.saveReportSettings(TENANT, {
				...DEFAULT_REPORT_SETTINGS,
				peakHours: 9,
			}),
		).rejects.toEqual(new SettingsWriteError("invalid", "peakHours"));
	});
});
