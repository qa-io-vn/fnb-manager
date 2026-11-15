import type { ReportSettingLimit } from "@fnb/reports";
import type { z } from "zod";
import {
	formatNumberText,
	type NumberDraft,
	readNumberDraft,
	reformatNumberText,
} from "../number-text";
import { PERCENT_LIMIT, percentage } from "../validation";
import type { FieldProps } from "./field";
import { NumberTextField } from "./number-text-field";

const PERCENT_TEXT = { affixes: ["%"], grouping: false } as const;
const PERCENT_SIGN = "%";

export function formatPercentText(
	value: number,
	locale: string,
	limit: ReportSettingLimit = PERCENT_LIMIT,
): string {
	return formatNumberText(value, locale, limit.fractionDigits, false);
}

export function formatPercentBound(
	value: number,
	locale: string,
	limit: ReportSettingLimit = PERCENT_LIMIT,
): string {
	return `${formatPercentText(value, locale, limit)}${PERCENT_SIGN}`;
}

export function readPercentDraft(
	text: string,
	locale: string,
	{
		limit = PERCENT_LIMIT,
		schema = percentage(limit),
		required = true,
	}: {
		limit?: ReportSettingLimit;
		schema?: z.ZodType;
		required?: boolean;
	} = {},
): NumberDraft {
	return readNumberDraft(text, locale, schema, { required, ...PERCENT_TEXT });
}

export interface PercentFieldProps extends Omit<FieldProps, "children"> {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onBlur?: () => void;
	readonly locale: string;
	readonly limit?: ReportSettingLimit;
	readonly testId?: string;
}

export function PercentField({
	locale,
	limit = PERCENT_LIMIT,
	...props
}: PercentFieldProps) {
	return (
		<NumberTextField
			{...props}
			inputMode="decimal"
			suffix={PERCENT_SIGN}
			reformat={(text) =>
				reformatNumberText(text, locale, limit.fractionDigits, PERCENT_TEXT)
			}
		/>
	);
}
