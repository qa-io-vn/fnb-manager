import { controlClass, Field, type FieldProps } from "./field";

export interface SelectOption<Value extends string> {
	readonly value: Value;
	readonly label: string;
}

export interface SelectFieldProps<Value extends string>
	extends Omit<FieldProps, "children"> {
	readonly value: Value | "";
	readonly onChange: (value: Value) => void;
	readonly options: readonly SelectOption<Value>[];
	readonly placeholder?: string;
	readonly testId?: string;
}

export function SelectField<Value extends string>({
	value,
	onChange,
	options,
	placeholder,
	testId,
	...field
}: SelectFieldProps<Value>) {
	return (
		<Field {...field}>
			{(control) =>
				control.readOnly ? (
					<input
						{...control}
						type="text"
						value={
							options.find((option) => option.value === value)?.label ?? ""
						}
						className={controlClass}
						data-testid={testId}
					/>
				) : (
					<select
						id={control.id}
						aria-describedby={control["aria-describedby"]}
						aria-invalid={control["aria-invalid"]}
						value={value}
						onChange={(event) => {
							const next = options.find(
								(option) => option.value === event.target.value,
							);
							if (next !== undefined) onChange(next.value);
						}}
						className={controlClass}
						data-testid={testId}
					>
						{value === "" || placeholder !== undefined ? (
							<option value="" disabled>
								{placeholder ?? ""}
							</option>
						) : null}
						{options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				)
			}
		</Field>
	);
}
