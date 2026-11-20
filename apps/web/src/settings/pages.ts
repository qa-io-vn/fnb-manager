import type { ComponentType } from "react";

export type SettingsPageId =
	| "store"
	| "manualData"
	| "classification"
	| "holidays"
	| "thresholds"
	| "legal"
	| "staff"
	| "checklists"
	| "loyalty"
	| "alerts"
	| "digests";

export interface SettingsPageEntry {
	readonly id: SettingsPageId;
	readonly slug: string;
	readonly titleKey: string;
	readonly phase: string;
	readonly status: "built" | "planned" | "slot";
	readonly load: (() => Promise<{ default: ComponentType }>) | null;
	readonly slotKey?: string;
	readonly managersOnly?: boolean;
}

export const SETTINGS_PAGES: readonly SettingsPageEntry[] = [
	{
		id: "store",
		slug: "cua-hang",
		titleKey: "settings.page.store",
		phase: "10b",
		status: "built",
		load: () => import("../pages/settings/cua-hang-page"),
	},
	{
		id: "manualData",
		slug: "du-lieu-nhap-tay",
		titleKey: "settings.page.manualData",
		phase: "10b",
		status: "built",
		load: () => import("../pages/settings/du-lieu-nhap-tay-page"),
	},
	{
		id: "classification",
		slug: "phan-loai",
		titleKey: "settings.page.classification",
		phase: "10a",
		status: "built",
		load: () => import("../pages/settings/phan-loai-page"),
	},
	{
		id: "holidays",
		slug: "ngay-le",
		titleKey: "settings.page.holidays",
		phase: "10b",
		status: "built",
		load: () => import("../pages/settings/ngay-le-page"),
	},
	{
		id: "thresholds",
		slug: "bao-cao",
		titleKey: "settings.page.thresholds",
		phase: "10a",
		status: "built",
		load: () => import("../pages/settings/bao-cao-page"),
	},
	{
		id: "legal",
		slug: "phap-ly",
		titleKey: "settings.page.legal",
		phase: "10b",
		status: "built",
		load: () => import("../pages/settings/phap-ly-page"),
	},
	{
		id: "staff",
		slug: "nhan-vien",
		titleKey: "settings.staff.title",
		phase: "14a",
		status: "built",
		load: () => import("../pages/settings/nhan-vien-page"),
		managersOnly: true,
	},
	{
		id: "checklists",
		slug: "checklist",
		titleKey: "settings.checklists.title",
		phase: "14b",
		status: "built",
		load: () => import("../pages/settings/checklist-page"),
		managersOnly: true,
	},
	{
		id: "loyalty",
		slug: "khach-hang-than-thiet",
		titleKey: "settings.loyalty.title",
		phase: "16a",
		status: "built",
		load: () => import("../pages/settings/khach-hang-than-thiet-page"),
	},
	{
		id: "alerts",
		slug: "canh-bao",
		titleKey: "settings.alerts.title",
		phase: "12",
		status: "built",
		load: () => import("../pages/settings/canh-bao-page"),
	},
	{
		id: "digests",
		slug: "ban-tin",
		titleKey: "settings.digests.title",
		phase: "12",
		status: "built",
		load: () => import("../pages/settings/ban-tin-page"),
	},
];

export const DEFAULT_SETTINGS_SLUG = "cua-hang";

export function settingsPageOf(
	slug: string | undefined,
): SettingsPageEntry | null {
	return SETTINGS_PAGES.find((page) => page.slug === slug) ?? null;
}
