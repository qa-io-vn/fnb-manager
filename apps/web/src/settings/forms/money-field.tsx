import { hasAtMostFractionDigits } from "@fnb/reports";
import type { z } from "zod";
import { currencySymbol, type Formatters } from "../../lib/format";
import {
	formatNumberText,
	type NumberDraft,
	type NumberTextOptions,
	readNumberDraft,
	reformatNumberText,
} from "../number-text";
import { MONEY_COLUMN_SCALE, money } from "../validation";
import type { FieldProps } from "./field";
import { NumberTextField } from "./number-text-field";

const DONG_SPELLINGS = ["VNĐ", "VND", "vnđ", "vnd", "đ", "Đ"] as const;

export function moneyAffixes(
	formatters: Formatters,
	currencyCode: string,
): string[] {
	const affixes = [
		currencySymbol(formatters.locale, currencyCode),
		currencyCode,
	];
	if (currencyCode.toUpperCase() === "VND") affixes.push(...DONG_SPELLINGS);
	return affixes;
}

function moneyTextOptions(
	formatters: Formatters,
	currencyCode: string,
): NumberTextOptions {
	return {
		affixes: moneyAffixes(formatters, currencyCode),
		whole: formatters.moneyFractionDigits === 0,
	};
}

export function formatMoneyText(value: number, formatters: Formatters): string {
	const fractionDigits = hasAtMostFractionDigits(
		value,
		formatters.moneyFractionDigits,
	)
		? formatters.moneyFractionDigits
		: MONEY_COLUMN_SCALE;
	return formatNumberText(value, formatters.locale, fractionDigits);
}

export function readMoneyDraft(
	text: string,
	formatters: Formatters,
	currencyCode: string,
	{
		schema = money(formatters.moneyFractionDigits),
		required = true,
	}: { schema?: z.ZodType; required?: boolean } = {},
): NumberDraft {
	return readNumberDraft(text, formatters.locale, schema, {
		required,
		...moneyTextOptions(formatters, currencyCode),
	});
}

export interface MoneyFieldProps extends Omit<FieldProps, "children"> {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onBlur?: () => void;
	readonly formatters: Formatters;
	readonly currencyCode: string;
	readonly testId?: string;
}

export function MoneyField({
	formatters,
	currencyCode,
	...props
}: MoneyFieldProps) {
	return (
		<NumberTextField
			{...props}
			inputMode={formatters.moneyFractionDigits === 0 ? "numeric" : "decimal"}
			suffix={currencySymbol(formatters.locale, currencyCode)}
			reformat={(text) =>
				reformatNumberText(
					text,
					formatters.locale,
					formatters.moneyFractionDigits,
					moneyTextOptions(formatters, currencyCode),
				)
			}
		/>
	);
}
