import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { menuAttachCard } from "./cards/attach.js";
import { menuCategoryMixCard } from "./cards/category-mix.js";
import { menuMarginsCard } from "./cards/margins.js";
import { menuMatrixCard } from "./cards/matrix.js";
import { menuMoversCard } from "./cards/movers.js";
import { menuPairsCard } from "./cards/pairs.js";
import { menuPreferencesCard } from "./cards/preferences.js";
import { menuSizeMixCard } from "./cards/size-mix.js";
import { menuKeys } from "./keys.js";
import { MENU_SLUG, menuFollowUpCalls, menuPrimaryCalls } from "./support.js";

export const menuCards: readonly ThemeCardDefinition[] = [
	menuMatrixCard,
	menuMarginsCard,
	menuMoversCard,
	menuCategoryMixCard,
	menuSizeMixCard,
	menuAttachCard,
	menuPairsCard,
	menuPreferencesCard,
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
	followUpCalls: (context, coverage) => menuFollowUpCalls(context, coverage),
};
