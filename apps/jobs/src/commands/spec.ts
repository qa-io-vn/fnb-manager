import type { ParseArgsConfig } from "node:util";
import type { CommandContext, OptionValues } from "../context.js";

export type OptionsConfig = NonNullable<ParseArgsConfig["options"]>;

export interface CommandSpec {
	path: readonly string[];
	summary: string;
	usage: string;
	options: OptionsConfig;
	details: readonly string[];
	run: (context: CommandContext, values: OptionValues) => Promise<number>;
}

export const HELP_OPTION: OptionsConfig = {
	help: { type: "boolean", short: "h" },
};
