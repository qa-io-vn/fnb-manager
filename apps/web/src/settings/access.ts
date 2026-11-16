import type { Membership } from "./source";

export type SettingsArea =
	| "roles"
	| "thresholds"
	| "tenantProfile"
	| "storeProfile"
	| "openingHours"
	| "holidays"
	| "alertRules"
	| "alertMutes";

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

function openingHoursAccess(
	membership: Membership,
	storeId: string | null,
): SettingsAccess {
	const store = storeProfileAccess(membership, storeId);
	if (!store.canWrite) return store;
	return membership.role === "owner" ? ALLOWED : denied("ownerOnly");
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
