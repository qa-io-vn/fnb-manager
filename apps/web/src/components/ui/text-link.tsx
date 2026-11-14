import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { cn } from "./cn";

export const textLinkClass =
	"inline-flex min-h-11 items-center text-accent underline underline-offset-2";

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
	return <Link className={cn(textLinkClass, className)} {...props} />;
}
