import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { catalogueCard } from "./cards/catalogue.js";
import { discountCostCard } from "./cards/discount-cost.js";
import { liftCard } from "./cards/lift.js";
import { redemptionsCard } from "./cards/redemptions.js";
import { ruleCapCard } from "./cards/rule-cap.js";
import { ruleDaysCard } from "./cards/rule-days.js";
import { vouchersCard } from "./cards/vouchers.js";
import { promotionsKeys } from "./keys.js";
import { promotionParams } from "./params.js";
import {
	PROMOTIONS_SLUG,
	promotionsFollowUpCalls,
	promotionsPrimaryCalls,
} from "./support.js";

export const promotionsCards: readonly ThemeCardDefinition[] = [
	discountCostCard,
	vouchersCard,
	liftCard,
	catalogueCard,
	ruleCapCard,
	ruleDaysCard,
	redemptionsCard,
];

export const promotionsTheme: ThemeDefinition = {
	kind: "promotions",
	slug: PROMOTIONS_SLUG,
	titleKey: promotionsKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: promotionParams,
	cards: promotionsCards,
	primaryCalls: promotionsPrimaryCalls,
	followUpCalls: promotionsFollowUpCalls,
};
