import type { Membership } from "../settings/source";

export interface PrivacyAccess {
	/** Look up, record, export, correct and close: owners and managers with every store. */
	readonly canHandle: boolean;
	/** Delete a data subject: owners with every store. */
	readonly canDelete: boolean;
}

const NONE: PrivacyAccess = { canHandle: false, canDelete: false };

export function privacyAccess(
	membership: Membership | null | undefined,
): PrivacyAccess {
	if (membership === undefined || membership === null) return NONE;
	if (membership.storeIds !== null) return NONE;
	if (membership.role === "owner") return { canHandle: true, canDelete: true };
	if (membership.role === "manager") {
		return { canHandle: true, canDelete: false };
	}
	return NONE;
}
