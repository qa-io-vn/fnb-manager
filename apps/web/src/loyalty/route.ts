import type { MessageKey } from "../i18n";

export const CUSTOMER_SECTION = "khach-hang";

export const CUSTOMER_PAGES = ["thanh-vien", "doi-soat", "bat-thuong"] as const;

export type CustomerPage = (typeof CUSTOMER_PAGES)[number];

export const CUSTOMER_TAB_KEYS: Readonly<Record<CustomerPage, MessageKey>> = {
	"thanh-vien": "loyalty.tab.members",
	"doi-soat": "loyalty.tab.queue",
	"bat-thuong": "loyalty.tab.anomalies",
};

export function customerHref(page: CustomerPage, search = ""): string {
	return `/${CUSTOMER_SECTION}/${page}${search === "" ? "" : `?${search}`}`;
}

export function memberHref(membershipId: string): string {
	return `/${CUSTOMER_SECTION}/thanh-vien/${encodeURIComponent(membershipId)}`;
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMembershipId(value: string | undefined): value is string {
	return value !== undefined && UUID_PATTERN.test(value);
}
