import type { ThemeKind } from "./context.js";
import type { ThemeDefinition } from "./definition.js";
import { hoursTheme } from "./hours/definition.js";
import { menuTheme } from "./menu/definition.js";
import { paymentsTheme } from "./payments/definition.js";
import { promotionsTheme } from "./promotions/definition.js";
import { qualityTheme } from "./quality/definition.js";
import { revenueTheme } from "./revenue/definition.js";
import { shiftsTheme } from "./shifts/definition.js";
import { storesTheme } from "./stores/definition.js";

export const themeDefinitions: Readonly<Record<ThemeKind, ThemeDefinition>> = {
	revenue: revenueTheme,
	hours: hoursTheme,
	menu: menuTheme,
	payments: paymentsTheme,
	promotions: promotionsTheme,
	shifts: shiftsTheme,
	stores: storesTheme,
	quality: qualityTheme,
};

export function themeDefinitionOf(kind: ThemeKind): ThemeDefinition {
	return themeDefinitions[kind];
}
