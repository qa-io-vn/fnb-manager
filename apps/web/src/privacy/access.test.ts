import { describe, expect, it } from "vitest";
import type { TenantRole } from "../settings/source";
import { privacyAccess } from "./access";

const member = (role: TenantRole, storeIds: readonly string[] | null) => ({
	role,
	storeIds,
});

describe("who handles data-subject requests (decision table)", () => {
	it("lets an owner with every store handle and delete", () => {
		expect(privacyAccess(member("owner", null))).toEqual({
			canHandle: true,
			canDelete: true,
		});
	});

	it("lets a manager with every store handle but not delete", () => {
		expect(privacyAccess(member("manager", null))).toEqual({
			canHandle: true,
			canDelete: false,
		});
	});

	it("gives nothing to a store-limited owner or manager", () => {
		for (const role of ["owner", "manager"] as const) {
			expect(privacyAccess(member(role, ["s1"]))).toEqual({
				canHandle: false,
				canDelete: false,
			});
		}
	});

	it("gives nothing to staff, viewers, publishers, non-members or an unknown membership", () => {
		for (const role of ["staff", "viewer", "publisher"] as const) {
			expect(privacyAccess(member(role, null)).canHandle).toBe(false);
		}
		expect(privacyAccess(null).canHandle).toBe(false);
		expect(privacyAccess(undefined).canHandle).toBe(false);
	});
});
