import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

export const fieldVariants = cva("min-h-11 rounded-lg border border-line", {
	variants: {
		kind: {
			control: "bg-surface-raised px-2 text-sm",
			trigger: "inline-flex items-center gap-2 bg-surface-raised px-3 text-sm",
			form: "bg-surface px-3",
		},
	},
	defaultVariants: { kind: "control" },
});

export type FieldKind = NonNullable<VariantProps<typeof fieldVariants>["kind"]>;

export function TextField({
	id,
	label,
	type,
	value,
	onChange,
	autoComplete,
	className,
}: {
	id: string;
	label: string;
	type: "email" | "password";
	value: string;
	onChange: (value: string) => void;
	autoComplete: string;
	className?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			<input
				id={id}
				type={type}
				required
				value={value}
				autoComplete={autoComplete}
				onChange={(event) => onChange(event.target.value)}
				className={cn(fieldVariants({ kind: "form" }), className)}
			/>
		</div>
	);
}
