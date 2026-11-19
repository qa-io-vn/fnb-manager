import { describe, expect, it } from "vitest";
import {
	type SettingsArea,
	settingsAccess,
	staffPageAccess,
	staffRowAccess,
} from "./access";
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
		["owner", false, "legal", true, null],
		["owner", true, "legal", false, "ownerOnly"],
		["manager", false, "legal", false, "ownerOnly"],
		["staff", false, "legal", false, "ownerOnly"],
		["viewer", false, "legal", false, "ownerOnly"],
		["publisher", false, "legal", false, "ownerOnly"],
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

	it.each([
		["owner", false, "holidays", true, null],
		["owner", true, "holidays", false, "scope"],
		["manager", false, "holidays", true, null],
		["manager", true, "holidays", false, "scope"],
		["staff", false, "holidays", false, "role"],
		["viewer", false, "holidays", false, "role"],
		["publisher", false, "holidays", false, "role"],
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
		["owner", false, "alertRules", true, null],
		["owner", true, "alertRules", false, "ownerOnly"],
		["manager", false, "alertRules", false, "ownerOnly"],
		["manager", true, "alertRules", false, "ownerOnly"],
		["staff", false, "alertRules", false, "ownerOnly"],
		["owner", false, "alertMutes", true, null],
		["owner", true, "alertMutes", true, null],
		["manager", false, "alertMutes", true, null],
		["manager", true, "alertMutes", true, null],
		["staff", false, "alertMutes", false, "role"],
		["viewer", false, "alertMutes", false, "role"],
		["publisher", false, "alertMutes", false, "role"],
	] as const)(
		"keeps alert rules to unlimited owners and lets %s (store-limited: %s) on %s write %s, reason %s",
		(role, scoped, area, canWrite, reason) => {
			expect(settingsAccess(area, member(role, scoped))).toEqual({
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

	it.each([
		["owner", false, null, true, null],
		["manager", false, null, true, null],
		["owner", true, null, false, "scope"],
		["manager", true, null, false, "scope"],
		["staff", false, null, false, "role"],
		["viewer", false, null, false, "role"],
		["owner", false, store, true, null],
		["manager", false, store, true, null],
		["owner", true, store, true, null],
		["manager", true, store, true, null],
		["manager", true, "22222222-2222-4222-8222-222222222222", false, "scope"],
		["staff", false, store, false, "role"],
		["viewer", true, store, false, "role"],
		["publisher", false, store, false, "role"],
	] as const)(
		"%s (store-limited: %s) on the manual data of %s writes %s, reason %s",
		(role, scoped, storeId, canWrite, reason) => {
			expect(
				settingsAccess("manualData", member(role, scoped), storeId),
			).toEqual({ canWrite, reason });
		},
	);

	const other = "22222222-2222-4222-8222-222222222222";
	const logins = {
		owner: member("owner"),
		"store-limited owner": member("owner", true),
		manager: member("manager"),
		"store-limited manager": member("manager", true),
		staff: member("staff"),
		viewer: member("viewer"),
		publisher: member("publisher"),
	} as const;
	type Login = keyof typeof logins;
	const pages: Readonly<
		Record<
			Exclude<SettingsArea, "alertRules" | "alertMutes">,
			Readonly<Record<Login, string>>
		>
	> = {
		tenantProfile: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
		storeProfile: {
			owner: "write write write",
			"store-limited owner": "scope write scope",
			manager: "write write write",
			"store-limited manager": "scope write scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		openingHours: {
			owner: "write write write",
			"store-limited owner": "scope write scope",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "scope ownerOnly scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		manualData: {
			owner: "write write write",
			"store-limited owner": "scope write scope",
			manager: "write write write",
			"store-limited manager": "scope write scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		holidays: {
			owner: "write write write",
			"store-limited owner": "scope scope scope",
			manager: "write write write",
			"store-limited manager": "scope scope scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		legal: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
		roles: {
			owner: "write write write",
			"store-limited owner": "scope scope scope",
			manager: "write write write",
			"store-limited manager": "scope scope scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		thresholds: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
		staff: {
			owner: "write write write",
			"store-limited owner": "scope write scope",
			manager: "write write write",
			"store-limited manager": "scope write scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		staffContact: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
		checklists: {
			owner: "write write write",
			"store-limited owner": "scope write scope",
			manager: "write write write",
			"store-limited manager": "scope write scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		loyalty: {
			owner: "write write write",
			"store-limited owner": "scope scope scope",
			manager: "write write write",
			"store-limited manager": "scope scope scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		staffRevenue: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
		rewards: {
			owner: "write write write",
			"store-limited owner": "scope scope scope",
			manager: "write write write",
			"store-limited manager": "scope scope scope",
			staff: "role role role",
			viewer: "role role role",
			publisher: "role role role",
		},
		rewardApproval: {
			owner: "write write write",
			"store-limited owner": "ownerOnly ownerOnly ownerOnly",
			manager: "ownerOnly ownerOnly ownerOnly",
			"store-limited manager": "ownerOnly ownerOnly ownerOnly",
			staff: "ownerOnly ownerOnly ownerOnly",
			viewer: "ownerOnly ownerOnly ownerOnly",
			publisher: "ownerOnly ownerOnly ownerOnly",
		},
	};

	it.each(
		Object.entries(pages).flatMap(([area, byLogin]) =>
			Object.entries(byLogin).map(
				([login, outcomes]) =>
					[area as SettingsArea, login as Login, outcomes] as const,
			),
		),
	)(
		"on %s, the %s writes or reads with the reason given for all stores, the store in scope and another store: %s",
		(area, login, outcomes) => {
			const outcome = (storeId: string | null) => {
				const access = settingsAccess(area, logins[login], storeId);
				return access.canWrite ? "write" : access.reason;
			};
			expect([outcome(null), outcome(store), outcome(other)].join(" ")).toBe(
				outcomes,
			);
		},
	);

	it("keeps staff and viewers read-only on every page and every scope, and a manager off opening hours everywhere", () => {
		for (const area of Object.keys(pages) as SettingsArea[]) {
			for (const login of ["staff", "viewer"] as const) {
				for (const storeId of [null, store, other]) {
					expect(
						settingsAccess(area, logins[login], storeId).canWrite,
						`${login} on ${area}`,
					).toBe(false);
				}
			}
		}
		for (const login of ["manager", "store-limited manager"] as const) {
			for (const storeId of [null, store, other]) {
				expect(
					settingsAccess("openingHours", logins[login], storeId).canWrite,
				).toBe(false);
			}
		}
	});

	it.each([
		["owner", "write"],
		["store-limited owner", "write"],
		["manager", "write"],
		["store-limited manager", "write"],
		["staff", "role"],
		["viewer", "role"],
		["publisher", "role"],
	] as const)("opens the Nhân viên page to the %s: %s", (login, outcome) => {
		const access = staffPageAccess(logins[login]);
		expect(access.canWrite ? "write" : access.reason).toBe(outcome);
	});

	it.each([
		["owner", null, "write"],
		["owner", [store, other], "write"],
		["store-limited owner", [store], "write"],
		["store-limited owner", null, "scope"],
		["manager", null, "write"],
		["store-limited manager", [store], "write"],
		["store-limited manager", [store, other], "scope"],
		["store-limited manager", [other], "scope"],
		["store-limited manager", null, "scope"],
		["store-limited manager", [], "scope"],
		["staff", [store], "role"],
		["viewer", null, "role"],
		["publisher", [store], "role"],
	] as const)(
		"lets the %s change a roster row of the stores %j: %s",
		(login, storeIds, outcome) => {
			const access = staffRowAccess(logins[login], storeIds);
			expect(access.canWrite ? "write" : access.reason).toBe(outcome);
		},
	);

	it("keeps the Nhân viên page from a login without membership and while it loads", () => {
		expect(staffPageAccess(null)).toEqual({
			canWrite: false,
			reason: "notMember",
		});
		expect(staffRowAccess(undefined, [store])).toEqual({
			canWrite: false,
			reason: "unknown",
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
