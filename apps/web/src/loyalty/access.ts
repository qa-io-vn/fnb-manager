import type { Membership, TenantRole } from "../settings/source";

export type LoyaltyDenial = "unknown" | "notMember" | "role";

export interface LoyaltyAccess {
	readonly canRead: boolean;
	readonly canResolve: boolean;
	readonly seesFullPhone: boolean;
	readonly reason: LoyaltyDenial | null;
}

const READERS: readonly TenantRole[] = ["owner", "manager", "viewer"];
const RESOLVERS: readonly TenantRole[] = ["owner", "manager"];

function denied(reason: LoyaltyDenial): LoyaltyAccess {
	return { canRead: false, canResolve: false, seesFullPhone: false, reason };
}

export function loyaltyReadAccess(
	membership: Membership | null | undefined,
): LoyaltyAccess {
	if (membership === undefined) return denied("unknown");
	if (membership === null) return denied("notMember");
	if (!READERS.includes(membership.role)) return denied("role");
	return {
		canRead: true,
		canResolve: RESOLVERS.includes(membership.role),
		seesFullPhone: membership.role === "owner",
		reason: null,
	};
}
