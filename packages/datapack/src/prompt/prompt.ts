import { DataPackError } from "../pack/errors.js";
import { PACK_LANGUAGES, type PackLanguage } from "../pack/request.js";
import { STRATEGY_PROMPT_EN } from "./strategy-en.js";
import { STRATEGY_PROMPT_VI } from "./strategy-vi.js";

export const PROMPT_ID = "fnb-strategy";
export const PROMPT_VERSION = "1.0.0";

export interface StrategyPrompt {
	readonly id: typeof PROMPT_ID;
	readonly version: string;
	readonly language: PackLanguage;
	readonly text: string;
}

export const PROMPT_TEXTS: Readonly<Record<PackLanguage, string>> = {
	vi: STRATEGY_PROMPT_VI,
	en: STRATEGY_PROMPT_EN,
};

export const PROMPT_SHA256: Readonly<
	Record<string, Readonly<Record<PackLanguage, string>>>
> = {
	"1.0.0": {
		vi: "28618bc5ba29500220e7ab01b734845e33bd2fd3feddfa4bdfa14c33c177fed9",
		en: "edfb64ccda985e44c30d2d5dc69dfc0edf3da2b2c86028b4f674cfcc42858213",
	},
};

export function strategyPrompt(language: PackLanguage): StrategyPrompt {
	if (!PACK_LANGUAGES.includes(language)) {
		throw new DataPackError(
			"pack_invalid",
			`${String(language)} is not a pack language`,
		);
	}
	return {
		id: PROMPT_ID,
		version: PROMPT_VERSION,
		language,
		text: PROMPT_TEXTS[language],
	};
}
