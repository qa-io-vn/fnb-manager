import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { cashTrendCard } from "./cards/cash-trend.js";
import { drawerCard } from "./cards/drawer.js";
import { feesCard } from "./cards/fees.js";
import { paymentMixCard } from "./cards/payment-mix.js";
import { paymentsKeys } from "./keys.js";
import {
	PAYMENTS_SLUG,
	paymentsFollowUpCalls,
	paymentsPrimaryCalls,
} from "./support.js";

export const paymentsCards: readonly ThemeCardDefinition[] = [
	paymentMixCard,
	cashTrendCard,
	drawerCard,
	feesCard,
];

export const paymentsTheme: ThemeDefinition = {
	kind: "payments",
	slug: PAYMENTS_SLUG,
	titleKey: paymentsKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: paymentsCards,
	primaryCalls: paymentsPrimaryCalls,
	followUpCalls: paymentsFollowUpCalls,
};
