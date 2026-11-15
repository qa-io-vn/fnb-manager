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
		});
		const saved = { ...DEFAULT_REPORT_SETTINGS, cashAbsThreshold: 80_000 };
		await source.saveReportSettings(TENANT, saved);
		expect(await source.reportSettings(TENANT)).toEqual({
			settings: saved,
			hasRow: true,
		});
		expect((await source.catchUpStatus(TENANT)).pendingDays).toBe(0);
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
