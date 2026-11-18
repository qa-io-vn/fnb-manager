import type { MessageKey } from "../../i18n";
import { settingsAccess } from "../access";
import type { Membership, SettingsWriteCode, StoreProfile } from "../source";
import type { ValidationIssue } from "../validation";
import {
	STAFF_ROLES,
	type StaffChange,
	type StaffMember,
	type StaffRole,
	type StaffStatus,
} from "./source";

export const STAFF_NAME_MAX_LENGTH = 100;
export const STAFF_STORES_MAX = 50;

export const STAFF_ROLE_KEYS: Readonly<Record<StaffRole, MessageKey>> = {
	staff: "settings.staff.role.staff",
	manager: "settings.staff.role.manager",
};

export const STAFF_STATUS_KEYS: Readonly<Record<StaffStatus, MessageKey>> = {
	invited: "settings.staff.status.invited",
	active: "settings.staff.status.active",
	inactive: "settings.staff.status.inactive",
};

const CONTROL_CHARACTER = /\p{Cc}/u;

export function staffNameValueOf(text: string): string {
	return text.normalize("NFC").trim();
}

export type StaffNameIssue =
	| { readonly kind: "validation"; readonly issue: ValidationIssue }
	| { readonly kind: "control" };

export function staffNameIssue(text: string): StaffNameIssue | null {
	const name = staffNameValueOf(text);
	const length = [...name].length;
	if (length === 0) {
		return { kind: "validation", issue: { key: "required" } };
	}
	if (length > STAFF_NAME_MAX_LENGTH) {
		return {
			kind: "validation",
			issue: { key: "textLength", max: STAFF_NAME_MAX_LENGTH },
		};
	}
	return CONTROL_CHARACTER.test(name) ? { kind: "control" } : null;
}

export interface StaffStoreChoices {
	readonly allStores: boolean;
	readonly stores: readonly StoreProfile[];
}

export function staffStoreChoices(
	membership: Membership | null | undefined,
	profiles: readonly StoreProfile[],
): StaffStoreChoices {
	return {
		allStores: settingsAccess("staff", membership, null).canWrite,
		stores: profiles.filter(
			(profile) =>
				settingsAccess("staff", membership, profile.storeId).canWrite,
		),
	};
}

export interface StaffDraft {
	readonly name: string;
	readonly role: StaffRole;
	readonly allStores: boolean;
	readonly storeIds: readonly string[];
}

export function staffDraftOf(
	member: StaffMember | null,
	choices: StaffStoreChoices,
): StaffDraft {
	if (member === null) {
		const only = choices.stores.length === 1 ? choices.stores[0] : undefined;
		return {
			name: "",
			role: "staff",
			allStores: false,
			storeIds: only === undefined ? [] : [only.storeId],
		};
	}
	return {
		name: member.displayName,
		role: member.role,
		allStores: member.storeIds === null,
		storeIds: member.storeIds ?? [],
	};
}

export interface StaffDraftReading {
	readonly nameIssue: StaffNameIssue | null;
	readonly storesIssue: boolean;
	readonly change: StaffChange | null;
}

export function readStaffDraft(
	draft: StaffDraft,
	choices: StaffStoreChoices,
): StaffDraftReading {
	const nameIssue = staffNameIssue(draft.name);
	const storeIds = choices.stores
		.map((store) => store.storeId)
		.filter((storeId) => draft.storeIds.includes(storeId));
	const allStores = draft.allStores && choices.allStores;
	const storesIssue =
		!allStores && (storeIds.length === 0 || storeIds.length > STAFF_STORES_MAX);
	return {
		nameIssue,
		storesIssue,
		change:
			nameIssue !== null || storesIssue
				? null
				: {
						displayName: staffNameValueOf(draft.name),
						role: draft.role,
						storeIds: allStores ? null : storeIds,
					},
	};
}

export function sameStaffChange(
	member: StaffMember,
	change: StaffChange,
): boolean {
	return (
		member.displayName === change.displayName &&
		member.role === change.role &&
		JSON.stringify(
			member.storeIds === null ? null : [...member.storeIds].sort(),
		) ===
			JSON.stringify(
				change.storeIds === null ? null : [...change.storeIds].sort(),
			)
	);
}

export type StaffAction =
	| "add"
	| "update"
	| "deactivate"
	| "reactivate"
	| "pairing";

const FORBIDDEN_KEYS: Readonly<Record<StaffAction, MessageKey>> = {
	add: "settings.staff.error.scope",
	update: "settings.staff.error.scope",
	deactivate: "settings.staff.error.rowForbidden",
	reactivate: "settings.staff.error.rowForbidden",
	pairing: "settings.staff.pairing.error.forbidden",
};

const INVALID_KEYS: Readonly<Record<StaffAction, MessageKey>> = {
	add: "settings.staff.error.invalid",
	update: "settings.staff.error.invalid",
	deactivate: "settings.staff.error.invalid",
	reactivate: "settings.staff.error.invalid",
	pairing: "settings.staff.pairing.error.invalid",
};

export function staffErrorKey(
	action: StaffAction,
	code: SettingsWriteCode | null,
	fallback: MessageKey | null,
): MessageKey | null {
	if (code === "forbidden") return FORBIDDEN_KEYS[action];
	if (code === "invalid") return INVALID_KEYS[action];
	return fallback;
}

export function rosterInOrder(
	rows: readonly StaffMember[],
	locale = "vi",
): StaffMember[] {
	return [...rows].sort((left, right) => {
		const leftOut = left.status === "inactive" ? 1 : 0;
		const rightOut = right.status === "inactive" ? 1 : 0;
		if (leftOut !== rightOut) return leftOut - rightOut;
		const byName = left.displayName.localeCompare(right.displayName, locale, {
			numeric: true,
		});
		if (byName !== 0) return byName;
		return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
	});
}

export interface StoreNames {
	readonly all: boolean;
	readonly names: readonly string[];
	readonly others: number;
}

export function storeNamesOf(
	storeIds: readonly string[] | null,
	profiles: readonly StoreProfile[],
): StoreNames {
	if (storeIds === null) return { all: true, names: [], others: 0 };
	const byId = new Map(
		profiles.map((profile) => [profile.storeId, profile.name]),
	);
	const names = storeIds.flatMap((storeId) => byId.get(storeId) ?? []);
	return { all: false, names, others: storeIds.length - names.length };
}

export function staffChangeProblem(
	change: StaffChange,
	knownStoreIds: ReadonlySet<string>,
): string | null {
	const name = change.displayName;
	const length = [...name].length;
	if (
		name !== name.trim() ||
		length < 1 ||
		length > STAFF_NAME_MAX_LENGTH ||
		CONTROL_CHARACTER.test(name)
	) {
		return "displayName";
	}
	if (!(STAFF_ROLES as readonly string[]).includes(change.role)) return "role";
	if (change.storeIds === null) return null;
	if (
		change.storeIds.length === 0 ||
		change.storeIds.length > STAFF_STORES_MAX ||
		new Set(change.storeIds).size !== change.storeIds.length ||
		change.storeIds.some((storeId) => !knownStoreIds.has(storeId))
	) {
		return "storeIds";
	}
	return null;
}
