import { notImplemented } from "../pack/errors.js";
import type { PackLanguage } from "../pack/request.js";

export const PROMPT_ID = "fnb-strategy";
export const PROMPT_VERSION = "1.0.0";

export interface StrategyPrompt {
	readonly id: typeof PROMPT_ID;
	readonly version: string;
	readonly language: PackLanguage;
	readonly text: string;
}

export function strategyPrompt(_language: PackLanguage): StrategyPrompt {
	return notImplemented("strategyPrompt");
}
