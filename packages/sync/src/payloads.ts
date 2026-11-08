import { stableJson } from "./json.js";
import type { JsonObject, JsonValue, SaleWrite } from "./rows.js";

function isJsonObject(value: JsonValue | null): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function withoutParentFields(
	raw: JsonValue | null,
	parent: JsonValue | null,
): JsonValue | null {
	if (!isJsonObject(raw) || !isJsonObject(parent)) {
		return raw;
	}
	return Object.fromEntries(
		Object.entries(raw).filter(
			([key, value]) =>
				!(
					Object.hasOwn(parent, key) &&
					stableJson(parent[key]) === stableJson(value)
				),
		),
	);
}

export function salePayloadRecord(sale: SaleWrite): string {
	return JSON.stringify({
		external_id: sale.invoice.external_id,
		invoice: sale.invoice.raw,
		lines: Object.fromEntries(
			sale.lines.map((line) => [line.external_id, line.raw]),
		),
		payments: Object.fromEntries(
			sale.payments.map((payment) => [
				String(payment.sequence_no),
				payment.raw,
			]),
		),
	});
}
