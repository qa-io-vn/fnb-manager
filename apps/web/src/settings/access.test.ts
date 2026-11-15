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
