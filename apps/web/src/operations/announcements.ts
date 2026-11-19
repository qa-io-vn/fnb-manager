import {
	addDays,
	businessDayStartOf,
	type IsoDate,
	isIsoDate,
} from "../lib/business-dates";
import type { Membership } from "../settings/source";
import {
	ANNOUNCEMENT_BODY_MAX,
	ANNOUNCEMENT_PIN_MAX_DAYS,
	ANNOUNCEMENT_STORES_MAX,
	ANNOUNCEMENT_TITLE_MAX,
	type Announcement,
	type AnnouncementDraft,
	type AnnouncementReader,
} from "./announcements-source";

export const ANNOUNCEMENTS_PAGE_SIZE = 20;
export const DEFAULT_PIN_DAYS = 7;

export type TextIssue = "required" | "tooLong" | "control";
export type StoresIssue = "none" | "tooMany";
export type PinIssue = "required" | "range" | "afterExpiry";
export type StoreChoice = "every" | "chosen";

const CONTROL = /\p{Cc}/u;
const BODY_ENDS = /^[ \n\t]+|[ \n\t]+$/g;

export function textLength(text: string): number {
	return [...text].length;
}

export function normalisedTitle(text: string): string {
	return text.normalize("NFC").trim();
}

export function normalisedBody(text: string): string {
	return text.normalize("NFC").replace(/\r\n?/g, "\n").replace(BODY_ENDS, "");
}

export function titleIssue(text: string): TextIssue | null {
	const title = normalisedTitle(text);
	if (title === "") return "required";
	if (textLength(title) > ANNOUNCEMENT_TITLE_MAX) return "tooLong";
	return CONTROL.test(title) ? "control" : null;
}

export function bodyIssue(text: string): TextIssue | null {
	const body = normalisedBody(text);
	if (body === "") return "required";
	if (textLength(body) > ANNOUNCEMENT_BODY_MAX) return "tooLong";
	return CONTROL.test(body.replace(/[\n\t]/g, "")) ? "control" : null;
}

export function pinBounds(today: IsoDate): {
	readonly min: IsoDate;
	readonly max: IsoDate;
} {
	return { min: today, max: addDays(today, ANNOUNCEMENT_PIN_MAX_DAYS - 1) };
}

export function defaultPinDate(today: IsoDate): IsoDate {
	return addDays(today, DEFAULT_PIN_DAYS - 1);
}

export function pinUntilOf(date: IsoDate, timeZone: string): string {
	return businessDayStartOf(addDays(date, 1), {
		timeZone,
		businessDayStartMinutes: 0,
	}).toISOString();
}

export function pinIssue(
	text: string,
	today: IsoDate,
	timeZone: string,
	{
		required,
		expiresAt = null,
	}: { readonly required: boolean; readonly expiresAt?: string | null },
): PinIssue | null {
	if (text === "") return required ? "required" : null;
	const bounds = pinBounds(today);
	if (!isIsoDate(text) || text < bounds.min || text > bounds.max) {
		return "range";
	}
	if (
		expiresAt !== null &&
		Date.parse(pinUntilOf(text, timeZone)) > Date.parse(expiresAt)
	) {
		return "afterExpiry";
	}
	return null;
}

export function sendsToEveryStore(
	membership: Membership | null | undefined,
): boolean {
	return (
		membership != null &&
		(membership.role === "owner" || membership.role === "manager") &&
		membership.storeIds === null
	);
}

export function publishableStores<Store extends { readonly id: string }>(
	stores: readonly Store[],
	membership: Membership | null | undefined,
): Store[] {
	if (
		membership == null ||
		(membership.role !== "owner" && membership.role !== "manager")
	) {
		return [];
	}
	const scope = membership.storeIds;
	return scope === null
		? [...stores]
		: stores.filter((store) => scope.includes(store.id));
}

export function canManageAnnouncement(
	membership: Membership | null | undefined,
	storeIds: readonly string[] | null,
): boolean {
	if (
		membership == null ||
		(membership.role !== "owner" && membership.role !== "manager")
	) {
		return false;
	}
	const scope = membership.storeIds;
	if (scope === null) return true;
	return (
		storeIds !== null &&
		storeIds.length > 0 &&
		storeIds.every((storeId) => scope.includes(storeId))
	);
}

export function announcementsInScope(
	announcements: readonly Announcement[],
	tenantId: string,
	storeIds: readonly string[],
): Announcement[] {
	const wanted = new Set(storeIds);
	return announcements.filter(
		(announcement) =>
			announcement.tenantId === tenantId &&
			(announcement.storeIds === null ||
				announcement.storeIds.some((storeId) => wanted.has(storeId))),
	);
}

export function isExpired(announcement: Announcement, now: number): boolean {
	return (
		announcement.expiresAt !== null && Date.parse(announcement.expiresAt) <= now
	);
}

export type StoresLabel =
	| { readonly every: true }
	| {
			readonly every: false;
			readonly names: readonly string[];
			readonly others: number;
	  };

export function storesLabelOf(
	stores: readonly { readonly id: string; readonly name: string }[],
	storeIds: readonly string[] | null,
): StoresLabel {
	if (storeIds === null) return { every: true };
	const names: string[] = [];
	let others = 0;
	for (const storeId of storeIds) {
		const store = stores.find((candidate) => candidate.id === storeId);
		if (store === undefined) others += 1;
		else names.push(store.name);
	}
	return { every: false, names, others };
}

export function splitReaders(readers: readonly AnnouncementReader[]): {
	readonly unread: AnnouncementReader[];
	readonly read: AnnouncementReader[];
} {
	return {
		unread: readers.filter((reader) => reader.readAt === null),
		read: readers
			.filter((reader) => reader.readAt !== null)
			.sort((left, right) =>
				(left.readAt ?? "").localeCompare(right.readAt ?? ""),
			),
	};
}

export interface ComposeValues {
	readonly title: string;
	readonly body: string;
	readonly storeChoice: StoreChoice;
	readonly storeIds: readonly string[];
	readonly pinDate: string;
}

export interface ComposeIssues {
	readonly title: TextIssue | null;
	readonly body: TextIssue | null;
	readonly stores: StoresIssue | null;
	readonly pin: PinIssue | null;
}

export function emptyCompose(
	storeChoice: StoreChoice,
	storeIds: readonly string[],
): ComposeValues {
	return { title: "", body: "", storeChoice, storeIds, pinDate: "" };
}

export function composeIssues(
	values: ComposeValues,
	today: IsoDate,
	timeZone: string,
): ComposeIssues {
	const chosen = values.storeChoice === "chosen";
	return {
		title: titleIssue(values.title),
		body: bodyIssue(values.body),
		stores: !chosen
			? null
			: values.storeIds.length === 0
				? "none"
				: values.storeIds.length > ANNOUNCEMENT_STORES_MAX
					? "tooMany"
					: null,
		pin: pinIssue(values.pinDate, today, timeZone, { required: false }),
	};
}

export function hasIssues(issues: ComposeIssues): boolean {
	return Object.values(issues).some((issue) => issue !== null);
}

export function composeRequest(
	values: ComposeValues,
	timeZone: string,
): AnnouncementDraft {
	return {
		title: normalisedTitle(values.title),
		body: normalisedBody(values.body),
		storeIds:
			values.storeChoice === "every" ? null : [...new Set(values.storeIds)],
		pinnedUntil:
			values.pinDate === "" ? null : pinUntilOf(values.pinDate, timeZone),
	};
}
