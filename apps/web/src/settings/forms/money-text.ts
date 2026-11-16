import type { z } from "zod";
import type { Formatters } from "../../lib/format";
import { type NumberDraft, withoutAffixes } from "../number-text";
import { moneyAffixes, readMoneyDraft } from "./money-field";

const LOOSE_FRACTION = /^-?\d+[.,]\d+$/;

export function readMoneyText(
	text: string,
	formatters: Formatters,
	currencyCode: string,
	schema: z.ZodType,
	{ required = false }: { required?: boolean } = {},
): NumberDraft {
	const draft = readMoneyDraft(text, formatters, currencyCode, {
		schema,
		required,
	});
	if (
		draft.issue?.key === "number" &&
		formatters.moneyFractionDigits === 0 &&
		LOOSE_FRACTION.test(
			withoutAffixes(text, moneyAffixes(formatters, currencyCode)),
		)
	) {
		return { value: null, issue: { key: "wholeMoney" } };
	}
	return draft;
}
