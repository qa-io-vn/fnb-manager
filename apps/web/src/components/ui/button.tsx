import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";

export const buttonVariants = cva("min-h-11", {
	variants: {
		tone: {
			primary: "rounded-lg bg-accent text-accent-ink",
			secondary: "rounded-lg border border-line hover:bg-surface-sunken",
			warning: "rounded-lg border border-warning bg-warning-soft",
		},
		size: {
			regular: "px-4 font-semibold",
			compact: "px-3 text-sm font-medium",
		},
	},
	defaultVariants: { tone: "primary", size: "regular" },
});

export type ButtonProps = ComponentPropsWithRef<"button"> &
	VariantProps<typeof buttonVariants>;

export function Button({
	tone,
	size,
	className,
	type = "button",
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			className={cn(buttonVariants({ tone, size }), className)}
			{...props}
		/>
	);
}
