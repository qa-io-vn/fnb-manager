import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { menuMarginsCard } from "./cards/margins.js";
import { menuMatrixCard } from "./cards/matrix.js";
import { menuKeys } from "./keys.js";
import { MENU_SLUG, menuPrimaryCalls } from "./support.js";

export const menuCards: readonly ThemeCardDefinition[] = [
	menuMatrixCard,
	menuMarginsCard,
];

export const menuTheme: ThemeDefinition = {
	kind: "menu",
	slug: MENU_SLUG,
	titleKey: menuKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: menuCards,
	primaryCalls: menuPrimaryCalls,
	followUpCalls: () => [],
};
