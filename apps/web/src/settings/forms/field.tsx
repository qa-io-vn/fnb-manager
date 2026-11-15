import type { ReactNode } from "react";
import { cn } from "../../components/ui/cn";

export interface FieldControlProps {
	readonly id: string;
	readonly "aria-describedby": string | undefined;
	readonly "aria-invalid": true | undefined;
	readonly readOnly: boolean | undefined;
}

export interface FieldProps {
	readonly id: string;
	readonly label: string;
	readonly hint?: string | null;
	readonly error?: string | null;
	readonly readOnly?: boolean;
	readonly className?: string;
	readonly children: (control: FieldControlProps) => ReactNode;
}

export function fieldIds(id: string): { hint: string; error: string } {
	return { hint: `${id}-hint`, error: `${id}-error` };
}

export function Field({
	id,
	label,
	hint,
	error,
	readOnly,
	className,
	children,
}: FieldProps) {
	const ids = fieldIds(id);
	const describedBy = [hint ? ids.hint : null, error ? ids.error : null]
		.filter((value) => value !== null)
		.join(" ");
	return (
		<div
			className={cn("flex min-w-0 flex-col gap-1", className)}
			data-testid="settings-field"
			data-invalid={error ? "true" : undefined}
		>
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			{children({
				id,
				"aria-describedby": describedBy === "" ? undefined : describedBy,
				"aria-invalid": error ? true : undefined,
				readOnly,
			})}
			{hint ? (
				<p id={ids.hint} className="text-xs text-ink-muted">
					{hint}
				</p>
			) : null}
			{error ? (
				<p
					id={ids.error}
					className="text-sm text-negative"
					data-testid="settings-field-error"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}

export const controlClass =
	"min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface-raised px-3 text-base read-only:bg-surface-sunken read-only:text-ink-muted aria-invalid:border-negative disabled:bg-surface-sunken disabled:text-ink-muted";
