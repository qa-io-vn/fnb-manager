import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { SHIFT_THEME_RANGE_DAYS } from "../range.js";
import { adjustmentsCard } from "./cards/adjustments.js";
import { cashiersCard } from "./cards/cashiers.js";
import { shiftDrawerCard } from "./cards/drawer.js";
import { shiftSalesCard } from "./cards/shift-sales.js";
import { shiftsKeys } from "./keys.js";
import {
	SHIFTS_SLUG,
	shiftsFollowUpCalls,
	shiftsPrimaryCalls,
} from "./support.js";

export const shiftsCards: readonly ThemeCardDefinition[] = [
	shiftSalesCard,
	shiftDrawerCard,
	adjustmentsCard,
	cashiersCard,
];

export const shiftsTheme: ThemeDefinition = {
	kind: "shifts",
	slug: SHIFTS_SLUG,
	titleKey: shiftsKeys.title,
	defaultPreset: "28d",
	maxRangeDays: SHIFT_THEME_RANGE_DAYS,
	params: [],
	cards: shiftsCards,
	primaryCalls: shiftsPrimaryCalls,
	followUpCalls: shiftsFollowUpCalls,
};
