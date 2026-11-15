import type { Membership } from "./source";

export type SettingsArea = "roles" | "thresholds";

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

function rolesAccess(membership: Membership): SettingsAccess {
	if (membership.role !== "owner" && membership.role !== "manager") {
		return denied("role");
	}
	return membership.storeIds === null ? ALLOWED : denied("scope");
}

function thresholdsAccess(membership: Membership): SettingsAccess {
	return membership.role === "owner" && membership.storeIds === null
		? ALLOWED
		: denied("ownerOnly");
}

export function settingsAccess(
	area: SettingsArea,
	membership: Membership | null | undefined,
): SettingsAccess {
	if (membership === undefined) return denied("unknown");
	if (membership === null) return denied("notMember");
	return area === "roles"
		? rolesAccess(membership)
		: thresholdsAccess(membership);
}
