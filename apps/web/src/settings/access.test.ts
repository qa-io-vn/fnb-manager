import { describe, expect, it } from "vitest";
import { settingsAccess } from "./access";
import type { Membership } from "./source";

const store = "11111111-1111-4111-8111-111111111111";

function member(role: Membership["role"], scoped = false): Membership {
	return { role, storeIds: scoped ? [store] : null };
}

describe("settingsAccess", () => {
	it.each([
		["owner", false, "roles", true, null],
		["owner", true, "roles", false, "scope"],
		["manager", false, "roles", true, null],
		["manager", true, "roles", false, "scope"],
		["staff", false, "roles", false, "role"],
		["viewer", false, "roles", false, "role"],
		["publisher", false, "roles", false, "role"],
		["owner", false, "thresholds", true, null],
		["owner", true, "thresholds", false, "ownerOnly"],
		["manager", false, "thresholds", false, "ownerOnly"],
		["manager", true, "thresholds", false, "ownerOnly"],
		["staff", false, "thresholds", false, "ownerOnly"],
		["viewer", true, "thresholds", false, "ownerOnly"],
		["publisher", false, "thresholds", false, "ownerOnly"],
	] as const)(
		"%s (store-limited: %s) on %s writes %s, reason %s",
		(role, scoped, area, canWrite, reason) => {
			expect(settingsAccess(area, member(role, scoped))).toEqual({
				canWrite,
				reason,
			});
		},
	);

	it.each([
		["owner", false, "tenantProfile", true, null],
		["owner", true, "tenantProfile", false, "ownerOnly"],
		["manager", false, "tenantProfile", false, "ownerOnly"],
		["viewer", false, "tenantProfile", false, "ownerOnly"],
		["owner", false, "storeProfile", true, null],
		["owner", true, "storeProfile", true, null],
		["manager", false, "storeProfile", true, null],
		["manager", true, "storeProfile", true, null],
		["staff", false, "storeProfile", false, "role"],
		["viewer", true, "storeProfile", false, "role"],
		["publisher", false, "storeProfile", false, "role"],
		["owner", false, "openingHours", true, null],
		["owner", true, "openingHours", true, null],
		["manager", false, "openingHours", false, "ownerOnly"],
		["manager", true, "openingHours", false, "ownerOnly"],
		["staff", false, "openingHours", false, "role"],
		["viewer", false, "openingHours", false, "role"],
	] as const)(
		"%s (store-limited: %s) on %s of a store in scope writes %s, reason %s",
		(role, scoped, area, canWrite, reason) => {
			expect(settingsAccess(area, member(role, scoped), store)).toEqual({
				canWrite,
				reason,
			});
		},
	);

	it("keeps a store-limited member to the profile and hours of their own stores", () => {
		const other = "22222222-2222-4222-8222-222222222222";
		for (const area of ["storeProfile", "openingHours"] as const) {
			expect(settingsAccess(area, member("owner", true), other)).toEqual({
				canWrite: false,
				reason: "scope",
			});
			expect(settingsAccess(area, member("manager", true), null)).toEqual({
				canWrite: false,
				reason: "scope",
			});
		}
		expect(settingsAccess("storeProfile", member("manager"), other)).toEqual({
			canWrite: true,
			reason: null,
		});
	});

	it("refuses a login without membership and waits while it loads", () => {
		expect(settingsAccess("roles", null)).toEqual({
			canWrite: false,
			reason: "notMember",
		});
		expect(settingsAccess("thresholds", undefined)).toEqual({
			canWrite: false,
			reason: "unknown",
		});
	});
});
