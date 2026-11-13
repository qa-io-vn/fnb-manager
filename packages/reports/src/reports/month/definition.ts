import {
	type CardDefinition,
	type ReportDefinition,
	withNoDataNotice,
} from "../../definition.js";
import { attachRateCard } from "./cards/attach-rate.js";
import { dailyTrendCard } from "./cards/daily-trend.js";
import { discountCostCard } from "./cards/discount-cost.js";
import { monthPaceCard } from "./cards/month-pace.js";
import { newItemsCard } from "./cards/new-items.js";
import { paretoCard } from "./cards/pareto.js";
import { paymentMixCard } from "./cards/payment-mix.js";
import { shiftStatsCard } from "./cards/shift-stats.js";
import { sizeMixCard } from "./cards/size-mix.js";
import { targetProgressCard } from "./cards/target-progress.js";
import { monthKeys } from "./keys.js";
import {
	MONTH_SLUG,
	monthFollowUpCalls,
	monthPrimaryCalls,
} from "./support.js";

export const monthCards: readonly CardDefinition[] = [
	monthPaceCard,
	dailyTrendCard,
	paretoCard,
	sizeMixCard,
	attachRateCard,
	newItemsCard,
	paymentMixCard,
	discountCostCard,
	shiftStatsCard,
	targetProgressCard,
].map((card) => withNoDataNotice(card, monthKeys.noDataNotice));

export const monthReport: ReportDefinition = {
	kind: "month",
	slug: MONTH_SLUG,
	titleKey: monthKeys.title,
	cards: monthCards,
	primaryCalls: monthPrimaryCalls,
	followUpCalls: monthFollowUpCalls,
};
