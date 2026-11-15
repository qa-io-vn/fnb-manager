import { cn } from "../../components/ui/cn";
import {
	controlClass,
	Field,
	type FieldControlProps,
	type FieldProps,
} from "./field";

function unitIdOf(id: string): string {
	return `${id}-unit`;
}

function describedByWithUnit(
	control: FieldControlProps,
	suffix: string | undefined,
): string | undefined {
	const ids = [
		suffix ? unitIdOf(control.id) : null,
		control["aria-describedby"],
	]
		.filter((value) => value !== null && value !== undefined)
		.join(" ");
	return ids === "" ? undefined : ids;
}

export interface NumberTextFieldProps extends Omit<FieldProps, "children"> {
	readonly value: string;
	readonly onChange: (text: string) => void;
	readonly inputMode: "numeric" | "decimal";
	readonly suffix?: string | undefined;
	readonly reformat: (text: string) => string | null;
	readonly onBlur?: () => void;
	readonly testId?: string;
}

export function NumberTextField({
	value,
	onChange,
	inputMode,
	suffix,
	reformat,
	onBlur,
	testId,
	...field
}: NumberTextFieldProps) {
	return (
		<Field {...field}>
			{(control) => (
				<div className="flex items-center gap-2">
					<input
						{...control}
						aria-describedby={describedByWithUnit(control, suffix)}
						type="text"
						inputMode={inputMode}
						autoComplete="off"
						spellCheck={false}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onBlur={() => {
							const formatted = control.readOnly ? null : reformat(value);
							if (formatted !== null && formatted !== value)
								onChange(formatted);
							onBlur?.();
						}}
						className={cn(controlClass, "tabular-nums")}
						data-testid={testId}
					/>
					{suffix ? (
						<span id={unitIdOf(control.id)} className="shrink-0 text-ink-muted">
							{suffix}
						</span>
					) : null}
				</div>
			)}
		</Field>
	);
}
