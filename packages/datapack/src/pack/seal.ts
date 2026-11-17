import { trimToBudget } from "./budget.js";
import { canonicalJson } from "./canonical.js";
import { packIdOf } from "./hash.js";
import type { DataPack } from "./schema.js";

export interface SealedPack {
	readonly pack: DataPack;
	readonly text: string;
	readonly packId: string;
	readonly estimatedTokens: number;
}

export async function sealPack(draft: DataPack): Promise<SealedPack> {
	const trimmed = trimToBudget(draft);
	const packId = await packIdOf(trimmed);
	const pack: DataPack = { ...trimmed, pack_id: packId };
	return {
		pack,
		text: canonicalJson(pack),
		packId,
		estimatedTokens: pack.budget.estimated_tokens,
	};
}
