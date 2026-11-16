import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { kpisCard } from "./cards/kpis.js";
import { sameDayCard } from "./cards/same-day.js";
import { sinceOpeningCard } from "./cards/since-opening.js";
import { storesKeys } from "./keys.js";
import {
	STORES_SLUG,
	storesFollowUpCalls,
	storesPrimaryCalls,
} from "./support.js";

export const storesCards: readonly ThemeCardDefinition[] = [
	kpisCard,
	sameDayCard,
	sinceOpeningCard,
];

export const storesTheme: ThemeDefinition = {
	kind: "stores",
	slug: STORES_SLUG,
	titleKey: storesKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: storesCards,
	primaryCalls: storesPrimaryCalls,
	followUpCalls: storesFollowUpCalls,
};
