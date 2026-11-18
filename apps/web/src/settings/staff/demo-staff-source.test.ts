import { DemoSettingsStore, demoStoreIds } from "@fnb/demo-analytics";
import { describe, expect, it } from "vitest";
import { writeCodeOf } from "../source";
import { createDemoStaffSource, demoStaffRows } from "./demo-staff-source";

const TENANT = "demo";

async function refusal(promise: Promise<unknown>) {
	return writeCodeOf(
		await promise.then(
			() => null,
			(error: unknown) => error,
		),
	);
}

describe("the demo staff source", () => {
	it("starts the session with neutral sample staff in every status, across the demo stores", async () => {
		const source = createDemoStaffSource(new DemoSettingsStore());
		const roster = await source.roster(TENANT);
		expect(
			roster.map((row) => [row.displayName, row.role, row.status]),
		).toEqual([
			["Nhân viên 1", "staff", "active"],
			["Nhân viên 2", "staff", "invited"],
			["Nhân viên 3", "staff", "inactive"],
			["Quản lý 1", "manager", "active"],
		]);
		const stores = new Set<string>(demoStoreIds());
		for (const row of roster) {
			for (const storeId of row.storeIds ?? []) {
				expect(stores.has(storeId)).toBe(true);
			}
			expect(row.audit).toBeNull();
		}
		expect(await source.staffRevenueVisibility(TENANT)).toBe("all");
		expect(await source.staffApps(TENANT)).toEqual([]);
	});

	it("dates the sample pairing and deactivation before the demo's day", () => {
		const rows = demoStaffRows("2026-11-03");
		expect(rows.find((row) => row.id === "demo-staff-1")?.pairedAt).toBe(
			"2026-10-13T02:30:00.000Z",
		);
		expect(rows.find((row) => row.id === "demo-staff-4")?.deactivatedAt).toBe(
			"2026-10-25T02:30:00.000Z",
		);
	});

	it("adds, updates, deactivates and reactivates for the session, stamping each row's audit", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoStaffSource(store);
		const [first = "", second = ""] = demoStoreIds();
		const id = await source.addStaff(TENANT, {
			displayName: "Nhân viên 5",
			role: "staff",
			storeIds: [first],
		});
		let added = (await source.roster(TENANT)).find((row) => row.id === id);
		expect(added).toMatchObject({
			status: "invited",
			pairedAt: null,
			audit: { author: { kind: "you" } },
		});
		await source.updateStaff(TENANT, id, {
			displayName: "Nhân viên 5",
			role: "manager",
			storeIds: [first, second],
		});
		await source.deactivateStaff(TENANT, id);
		added = (await source.roster(TENANT)).find((row) => row.id === id);
		expect(added).toMatchObject({
			role: "manager",
			storeIds: [first, second],
			status: "inactive",
		});
		expect(added?.deactivatedAt).not.toBeNull();
		await source.deactivateStaff(TENANT, id);
		await source.reactivateStaff(TENANT, id);
		added = (await source.roster(TENANT)).find((row) => row.id === id);
		expect(added).toMatchObject({
			status: "invited",
			deactivatedAt: null,
			pairedAt: null,
		});
		const other = createDemoStaffSource(new DemoSettingsStore());
		expect((await other.roster(TENANT)).some((row) => row.id === id)).toBe(
			false,
		);
	});

	it("drops the phone of a deactivated person and asks them to pair again after a reactivation", async () => {
		const source = createDemoStaffSource(new DemoSettingsStore());
		await source.deactivateStaff(TENANT, "demo-staff-1");
		let row = (await source.roster(TENANT)).find(
			(candidate) => candidate.id === "demo-staff-1",
		);
		expect(row?.phoneHint).toBeNull();
		await source.reactivateStaff(TENANT, "demo-staff-1");
		row = (await source.roster(TENANT)).find(
			(candidate) => candidate.id === "demo-staff-1",
		);
		expect(row).toMatchObject({ status: "invited", pairedAt: null });
	});

	it("refuses what the database refuses with the same codes", async () => {
		const source = createDemoStaffSource(new DemoSettingsStore());
		const [first = ""] = demoStoreIds();
		expect(
			await refusal(
				source.addStaff(TENANT, {
					displayName: " ",
					role: "staff",
					storeIds: [first],
				}),
			),
		).toBe("invalid");
		expect(
			await refusal(
				source.addStaff(TENANT, {
					displayName: "Nhân viên 6",
					role: "staff",
					storeIds: [],
				}),
			),
		).toBe("invalid");
		expect(
			await refusal(
				source.addStaff(TENANT, {
					displayName: "Nhân viên 6",
					role: "staff",
					storeIds: ["another-store"],
				}),
			),
		).toBe("invalid");
		expect(await refusal(source.deactivateStaff(TENANT, "missing"))).toBe(
			"forbidden",
		);
		expect(
			await refusal(
				source.setStaffRevenueVisibility(
					TENANT,
					"everything" as unknown as "all",
				),
			),
		).toBe("invalid");
	});

	it("issues six-digit pairing codes valid ten minutes, keeps none of them, and refuses a deactivated or unknown person", async () => {
		const source = createDemoStaffSource(new DemoSettingsStore());
		const before = Date.now();
		const first = await source.issuePairingCode(TENANT, "demo-staff-2");
		expect(first.rosterId).toBe("demo-staff-2");
		expect(first.code).toMatch(/^[0-9]{6}$/);
		expect(Date.parse(first.expiresAt)).toBeGreaterThanOrEqual(
			before + 10 * 60 * 1000,
		);
		const codes = new Set<string>();
		for (let index = 0; index < 20; index++) {
			codes.add((await source.issuePairingCode(TENANT, "demo-staff-1")).code);
		}
		expect(codes.size).toBeGreaterThan(1);
		expect(JSON.stringify(await source.roster(TENANT))).not.toContain(
			first.code,
		);
		expect(await refusal(source.issuePairingCode(TENANT, "demo-staff-4"))).toBe(
			"invalid",
		);
		expect(await refusal(source.issuePairingCode(TENANT, "missing"))).toBe(
			"forbidden",
		);
	});

	it("keeps the staff revenue visibility for the session", async () => {
		const store = new DemoSettingsStore();
		const source = createDemoStaffSource(store);
		expect(await source.setStaffRevenueVisibility(TENANT, "store_totals")).toBe(
			"store_totals",
		);
		expect(
			await createDemoStaffSource(store).staffRevenueVisibility(TENANT),
		).toBe("store_totals");
	});
});
