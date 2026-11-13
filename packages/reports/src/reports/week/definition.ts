import type { CardDefinition, ReportDefinition } from "../../definition.js";
import { avgTicketCard } from "./cards/avg-ticket.js";
import { bestWorstDaysCard } from "./cards/best-worst-days.js";
import { categoryMixCard } from "./cards/category-mix.js";
import { invoicesCard } from "./cards/invoices.js";
import { moversCard } from "./cards/movers.js";
import { netRevenueCard } from "./cards/net-revenue.js";
import { promotionsCard } from "./cards/promotions.js";
import { weekdayCurveCard } from "./cards/weekday-curve.js";
import { weekKeys } from "./keys.js";
import { WEEK_SLUG, weekFollowUpCalls, weekPrimaryCalls } from "./support.js";

export const weekCards: readonly CardDefinition[] = [
	netRevenueCard,
	invoicesCard,
	avgTicketCard,
	weekdayCurveCard,
	moversCard,
	categoryMixCard,
	promotionsCard,
	bestWorstDaysCard,
];

export const weekReport: ReportDefinition = {
	kind: "week",
	slug: WEEK_SLUG,
	titleKey: weekKeys.title,
	cards: weekCards,
	primaryCalls: weekPrimaryCalls,
	followUpCalls: weekFollowUpCalls,
};
