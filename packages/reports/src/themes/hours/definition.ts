import type { ThemeCardDefinition, ThemeDefinition } from "../definition.js";
import { MAX_THEME_RANGE_DAYS } from "../range.js";
import { hoursHeatmapCard } from "./cards/heatmap.js";
import { hoursPeakDeadCard } from "./cards/peak-dead.js";
import { hoursProductivityCard } from "./cards/productivity.js";
import { hoursShiftWindowsCard } from "./cards/shift-windows.js";
import { hoursWeekdayCard } from "./cards/weekday.js";
import { hoursKeys } from "./keys.js";
import {
	HOURS_SLUG,
	hoursFollowUpCalls,
	hoursPrimaryCalls,
} from "./support.js";

export const hoursCards: readonly ThemeCardDefinition[] = [
	hoursHeatmapCard,
	hoursPeakDeadCard,
	hoursWeekdayCard,
	hoursProductivityCard,
	hoursShiftWindowsCard,
];

export const hoursTheme: ThemeDefinition = {
	kind: "hours",
	slug: HOURS_SLUG,
	titleKey: hoursKeys.title,
	defaultPreset: "28d",
	maxRangeDays: MAX_THEME_RANGE_DAYS,
	params: [],
	cards: hoursCards,
	primaryCalls: hoursPrimaryCalls,
	followUpCalls: hoursFollowUpCalls,
};
