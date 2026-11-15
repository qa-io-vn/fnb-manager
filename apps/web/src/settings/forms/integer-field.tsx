import type { z } from "zod";
import {
	formatNumberText,
	type NumberDraft,
	readNumberDraft,
	reformatNumberText,
} from "../number-text";
import type { FieldProps } from "./field";
import { NumberTextField } from "./number-text-field";

const WHOLE_NUMBER = { whole: true } as const;

export function formatIntegerText(value: number, locale: string): string {
	return formatNumberText(value, locale, 0);
}

export function readIntegerDraft(
	text: string,
	locale: string,
	schema: z.ZodType,
	{ required = true }: { required?: boolean } = {},
): NumberDraft {
	return readNumberDraft(text, locale, schema, { required, ...WHOLE_NUMBER });
}

export interface IntegerFieldProps extends Omit<FieldProps, "children"> {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onBlur?: () => void;
	readonly locale: string;
	readonly unit?: string;
	readonly testId?: string;
}

export function IntegerField({ locale, unit, ...props }: IntegerFieldProps) {
	return (
		<NumberTextField
			{...props}
			inputMode="numeric"
			suffix={unit}
			reformat={(text) => reformatNumberText(text, locale, 0, WHOLE_NUMBER)}
		/>
	);
}
