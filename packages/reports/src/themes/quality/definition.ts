import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { qualityComplianceCard } from "./cards/compliance.js";
import { qualityCostsCard } from "./cards/costs.js";
import { qualityCustomersCard } from "./cards/customers.js";
import { qualityModifiersCard } from "./cards/modifiers.js";
import { qualityPaymentsCard } from "./cards/payments.js";
import { qualityUncategorisedCard } from "./cards/uncategorised.js";
import { qualityVerificationCard } from "./cards/verification.js";
import { qualityKeys } from "./keys.js";
import {
	QUALITY_SLUG,
	qualityFollowUpCalls,
	qualityPrimaryCalls,
} from "./support.js";

export const qualityCards: readonly ThemeCardDefinition[] = [
	qualityComplianceCard,
	qualityUncategorisedCard,
	qualityCostsCard,
	qualityVerificationCard,
	qualityPaymentsCard,
	qualityModifiersCard,
	qualityCustomersCard,
];

export const qualityTheme: ThemeDefinition = {
	kind: "quality",
	slug: QUALITY_SLUG,
	titleKey: qualityKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: qualityCards,
	primaryCalls: qualityPrimaryCalls,
	followUpCalls: qualityFollowUpCalls,
};
