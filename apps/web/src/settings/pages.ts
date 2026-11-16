import type { ComponentType } from "react";

export type SettingsPageId =
	| "store"
	| "manualData"
	| "classification"
	| "holidays"
	| "thresholds"
	| "legal";

export interface SettingsPageEntry {
	readonly id: SettingsPageId;
	readonly slug: string;
	readonly titleKey: string;
	readonly phase: string;
	readonly status: "built" | "planned";
	readonly load: (() => Promise<{ default: ComponentType }>) | null;
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
		status: "planned",
		load: null,
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
		status: "planned",
		load: null,
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
		status: "planned",
		load: null,
	},
];

export const DEFAULT_SETTINGS_SLUG = "cua-hang";

export function settingsPageOf(
	slug: string | undefined,
): SettingsPageEntry | null {
	return SETTINGS_PAGES.find((page) => page.slug === slug) ?? null;
}
