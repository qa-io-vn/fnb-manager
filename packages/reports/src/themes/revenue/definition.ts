import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { revenueTicketCard } from "./cards/avg-ticket.js";
import { revenueByMonthCard } from "./cards/by-month.js";
import { revenueInvoicesCard } from "./cards/invoices.js";
import { revenueNetCard } from "./cards/net-revenue.js";
import { revenueStoreShareCard } from "./cards/store-share.js";
import { revenueTrendCard } from "./cards/trend.js";
import { revenueKeys } from "./keys.js";
import {
	REVENUE_SLUG,
	revenueFollowUpCalls,
	revenuePrimaryCalls,
} from "./support.js";

export const revenueCards: readonly ThemeCardDefinition[] = [
	revenueNetCard,
	revenueTrendCard,
	revenueInvoicesCard,
	revenueTicketCard,
	revenueByMonthCard,
	revenueStoreShareCard,
];

export const revenueTheme: ThemeDefinition = {
	kind: "revenue",
	slug: REVENUE_SLUG,
	titleKey: revenueKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: revenueCards,
	primaryCalls: revenuePrimaryCalls,
	followUpCalls: revenueFollowUpCalls,
};
