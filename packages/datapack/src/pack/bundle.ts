import { canonicalJson } from "./canonical.js";
import type { PackLanguage } from "./request.js";
import type { DataPack } from "./schema.js";

export const BUNDLE_PROMPT_POINTER: Readonly<Record<PackLanguage, string>> = {
	vi: "Lời nhắc nằm ở đầu văn bản này, ngay trước gói dữ liệu.",
	en: "The instructions are at the top of this text, just before this data pack.",
};

export const BUNDLE_FENCE_OPEN = "```json";
export const BUNDLE_FENCE_CLOSE = "```";

export function chatBundle(pack: DataPack): string {
	const pointed: DataPack = {
		...pack,
		prompt: {
			...pack.prompt,
			text: BUNDLE_PROMPT_POINTER[pack.prompt.language],
		},
	};
	const body = canonicalJson(pointed);
	return `${pack.prompt.text}\n\n${BUNDLE_FENCE_OPEN}\n${body}${BUNDLE_FENCE_CLOSE}\n`;
}
