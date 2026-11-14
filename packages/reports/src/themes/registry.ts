import type { ThemeKind } from "./context.js";
import type { ThemeDefinition } from "./definition.js";
import { hoursTheme } from "./hours/definition.js";
import { menuTheme } from "./menu/definition.js";
import { revenueTheme } from "./revenue/definition.js";

export const themeDefinitions: Readonly<
	Partial<Record<ThemeKind, ThemeDefinition>>
> = {
	revenue: revenueTheme,
	hours: hoursTheme,
	menu: menuTheme,
};

export function themeDefinitionOf(kind: ThemeKind): ThemeDefinition | null {
	return themeDefinitions[kind] ?? null;
}
