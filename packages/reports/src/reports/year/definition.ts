import type { CardDefinition, ReportDefinition } from "../../definition.js";
import { growthCard } from "./cards/growth.js";
import { itemLifecycleCard } from "./cards/item-lifecycle.js";
import { monthMatrixCard } from "./cards/month-matrix.js";
import { seasonalityCard } from "./cards/seasonality.js";
import { sinceOpeningCard } from "./cards/since-opening.js";
import { ticketTrendCard } from "./cards/ticket-trend.js";
import { yearOverYearCard } from "./cards/year-over-year.js";
import { yearKeys } from "./keys.js";
import { YEAR_SLUG, yearFollowUpCalls, yearPrimaryCalls } from "./support.js";

export const yearCards: readonly CardDefinition[] = [
	monthMatrixCard,
	growthCard,
	seasonalityCard,
	ticketTrendCard,
	itemLifecycleCard,
	yearOverYearCard,
	sinceOpeningCard,
];

export const yearReport: ReportDefinition = {
	kind: "year",
	slug: YEAR_SLUG,
	titleKey: yearKeys.title,
	cards: yearCards,
	primaryCalls: yearPrimaryCalls,
	followUpCalls: yearFollowUpCalls,
};
