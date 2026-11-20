import type { Membership } from "./source";

export type SettingsArea =
	| "roles"
	| "thresholds"
	| "tenantProfile"
	| "storeProfile"
	| "openingHours"
	| "holidays"
	| "alertRules"
	| "alertMutes"
	| "manualData"
	| "legal"
	| "staff"
	| "staffRevenue"
	| "staffContact"
	| "checklists"
	| "loyalty"
	| "rewards"
	| "rewardApproval"
	| "loyaltyConfirmation";

export type ReadOnlyReason =
	| "notMember"
	| "role"
	| "scope"
	| "ownerOnly"
	| "unknown"
	| "unavailable";

export interface SettingsAccess {
	readonly canWrite: boolean;
	readonly reason: ReadOnlyReason | null;
}

function denied(reason: ReadOnlyReason): SettingsAccess {
	return { canWrite: false, reason };
}

const ALLOWED: SettingsAccess = { canWrite: true, reason: null };

function managesData(membership: Membership): boolean {
	return membership.role === "owner" || membership.role === "manager";
}

function rolesAccess(membership: Membership): SettingsAccess {
	if (!managesData(membership)) return denied("role");
	return membership.storeIds === null ? ALLOWED : denied("scope");
}

function unlimitedOwnerAccess(membership: Membership): SettingsAccess {
	return membership.role === "owner" && membership.storeIds === null
		? ALLOWED
		: denied("ownerOnly");
}

function ownDestinationsAccess(membership: Membership): SettingsAccess {
	return managesData(membership) ? ALLOWED : denied("role");
}

function storeProfileAccess(
	membership: Membership,
	storeId: string | null,
): SettingsAccess {
	if (!managesData(membership)) return denied("role");
	if (membership.storeIds === null) return ALLOWED;
	return storeId !== null && membership.storeIds.includes(storeId)
		? ALLOWED
		: denied("scope");
}

function manualDataAccess(
	membership: Membership,
	storeId: string | null,
): SettingsAccess {
	return storeId === null
		? rolesAccess(membership)
		: storeProfileAccess(membership, storeId);
}

function openingHoursAccess(
	membership: Membership,
	storeId: string | null,
): SettingsAccess {
	const store = storeProfileAccess(membership, storeId);
	if (!store.canWrite) return store;
	return membership.role === "owner" ? ALLOWED : denied("ownerOnly");
}

/** set_loyalty_store_settings: an owner of the whole tenant or of that store. */
function storeOwnerAccess(
	membership: Membership,
	storeId: string | null,
): SettingsAccess {
	if (membership.role !== "owner") return denied("ownerOnly");
	if (membership.storeIds === null) return ALLOWED;
	return storeId !== null && membership.storeIds.includes(storeId)
		? ALLOWED
		: denied("scope");
}

const AREA_ACCESS: Readonly<
	Record<
		SettingsArea,
		(membership: Membership, storeId: string | null) => SettingsAccess
	>
> = {
	roles: rolesAccess,
	thresholds: unlimitedOwnerAccess,
	tenantProfile: unlimitedOwnerAccess,
	storeProfile: storeProfileAccess,
	openingHours: openingHoursAccess,
	holidays: rolesAccess,
	alertRules: unlimitedOwnerAccess,
	alertMutes: ownDestinationsAccess,
	manualData: manualDataAccess,
	legal: unlimitedOwnerAccess,
	staff: manualDataAccess,
	staffRevenue: unlimitedOwnerAccess,
	staffContact: unlimitedOwnerAccess,
	checklists: manualDataAccess,
	loyalty: rolesAccess,
	rewards: rolesAccess,
	rewardApproval: unlimitedOwnerAccess,
	loyaltyConfirmation: storeOwnerAccess,
};

export function settingsAccess(
	area: SettingsArea,
	membership: Membership | null | undefined,
	storeId: string | null = null,
): SettingsAccess {
	if (membership === undefined) return denied("unknown");
	if (membership === null) return denied("notMember");
	return AREA_ACCESS[area](membership, storeId);
}

export function staffPageAccess(
	membership: Membership | null | undefined,
): SettingsAccess {
	if (membership === undefined) return denied("unknown");
	if (membership === null) return denied("notMember");
	return managesData(membership) ? ALLOWED : denied("role");
}

export function staffRowAccess(
	membership: Membership | null | undefined,
	storeIds: readonly string[] | null,
): SettingsAccess {
	if (storeIds === null) return settingsAccess("staff", membership, null);
	const page = staffPageAccess(membership);
	if (!page.canWrite) return page;
	if (storeIds.length === 0) return denied("scope");
	for (const storeId of storeIds) {
		const store = settingsAccess("staff", membership, storeId);
		if (!store.canWrite) return store;
	}
	return ALLOWED;
}

export function seesLoyaltyStaffPhones(
	membership: Membership | null | undefined,
): boolean {
	return membership != null && managesData(membership);
}
