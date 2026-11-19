import { describe, expect, it } from "vitest";
import type { Membership, TenantRole } from "../settings/source";
import { visibleSecondaryItems } from "./navigation";

function sections(role: TenantRole): string[] {
	const membership: Membership = { role, storeIds: null };
	return visibleSecondaryItems(membership).map((item) => item.section);
}

describe("the side rail's secondary entries", () => {
	it("offers Khách hàng and Vận hành to owners and managers", () => {
		expect(sections("owner")).toEqual(["khach-hang", "van-hanh"]);
		expect(sections("manager")).toEqual(["khach-hang", "van-hanh"]);
	});

	it("offers a viewer Khách hàng only, since Vận hành is for owners and managers", () => {
		expect(sections("viewer")).toEqual(["khach-hang"]);
	});

	it("offers staff and the publisher neither", () => {
		expect(sections("staff")).toEqual([]);
		expect(sections("publisher")).toEqual([]);
	});

	it("offers nothing while the role is unknown or the login is no member", () => {
		expect(visibleSecondaryItems(undefined)).toEqual([]);
		expect(visibleSecondaryItems(null)).toEqual([]);
	});
});
