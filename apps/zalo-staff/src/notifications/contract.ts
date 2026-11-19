import {
	type IsoInstant,
	instantOrNull,
	knownOrNull,
	oneOf,
	rows,
	text,
	textOrNull,
} from "../team/read";

export const DESTINATION_TABLE = "notification_channels";
export const DESTINATION_COLUMNS =
	"id,kind,label,address_hint,status,enabled,muted_rules,linked_at,disabled_reason";

export const DESTINATION_STATUSES = [
	"pending",
	"active",
	"failing",
	"disabled",
] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const DESTINATION_KINDS = [
	"zalo_bot",
	"telegram",
	"email",
	"zalo_oa",
	"zalo_gmf",
	"mini_app",
] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DISABLED_REASONS = [
	"blocked_by_user",
	"member_request",
	"owner_request",
	"consent_withdrawn",
] as const;
export type DisabledReason = (typeof DISABLED_REASONS)[number];

export interface Destination {
	readonly id: string;
	readonly kind: DestinationKind | null;
	readonly label: string;
	readonly hint: string | null;
	readonly status: DestinationStatus;
	readonly paused: boolean;
	readonly mutedRules: number;
	readonly linkedAt: IsoInstant | null;
	readonly disabledReason: DisabledReason | null;
}

export interface NotificationsApi {
	destinations(): Promise<Destination[]>;
	followTarget(): Promise<string | null>;
}

export function destinationQuery(memberId: string): Record<string, string> {
	return {
		select: DESTINATION_COLUMNS,
		user_id: `eq.${memberId}`,
		order: "created_at.asc,id.asc",
	};
}

export function readDestinations(value: unknown): Destination[] {
	return rows(value, "destinations").map((row) => ({
		id: text(row.id, "destination id"),
		kind: knownOrNull(DESTINATION_KINDS, row.kind),
		label: text(row.label, "destination label"),
		hint: textOrNull(row.address_hint, "destination hint"),
		status: oneOf(DESTINATION_STATUSES, row.status, "destination status"),
		paused: row.enabled === false,
		mutedRules: Array.isArray(row.muted_rules) ? row.muted_rules.length : 0,
		linkedAt: instantOrNull(row.linked_at, "link time"),
		disabledReason: knownOrNull(DISABLED_REASONS, row.disabled_reason),
	}));
}

export const DESTINATION_STATES_SHOWN = [
	"receiving",
	"waiting",
	"failing",
	"stopped",
] as const;
export type DestinationState = (typeof DESTINATION_STATES_SHOWN)[number];

export function destinationState(destination: Destination): DestinationState {
	if (destination.status === "disabled" || destination.paused) return "stopped";
	if (destination.status === "pending") return "waiting";
	if (destination.status === "failing") return "failing";
	return "receiving";
}
