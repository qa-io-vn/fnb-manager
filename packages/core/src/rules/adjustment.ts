import type { CanonicalAdjustment } from "../schemas/adjustment.js";

export type AdjustmentIdentity = Pick<
	CanonicalAdjustment,
	"kind" | "saleExternalId" | "lineExternalId" | "occurredAt"
>;

export function adjustmentKey(adjustment: AdjustmentIdentity): string {
	return [
		adjustment.kind,
		adjustment.saleExternalId,
		adjustment.lineExternalId ?? "",
		adjustment.occurredAt.getTime(),
	].join("|");
}
