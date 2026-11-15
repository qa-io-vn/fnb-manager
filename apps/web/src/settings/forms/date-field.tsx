import type { IsoDate } from "../../lib/business-dates";
import {
	businessDate,
	dateBounds,
	issueOf,
	type ValidationIssue,
} from "../validation";
import { controlClass, Field, type FieldProps } from "./field";

export function readDateDraft(
	text: string,
	today: IsoDate,
	{ required = true }: { required?: boolean } = {},
): ValidationIssue | null {
	if (text === "") return required ? { key: "required" } : null;
	return issueOf(businessDate(today), text, "date");
}

export interface DateFieldProps extends Omit<FieldProps, "children"> {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly onBlur?: () => void;
	readonly today: IsoDate;
	readonly testId?: string;
}

export function DateField({
	value,
	onChange,
	onBlur,
	today,
	testId,
	...field
}: DateFieldProps) {
	const bounds = dateBounds(today);
	return (
		<Field {...field}>
			{(control) => (
				<input
					{...control}
					type="date"
					min={bounds.min}
					max={bounds.max}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onBlur}
					className={controlClass}
					data-testid={testId}
				/>
			)}
		</Field>
	);
}
