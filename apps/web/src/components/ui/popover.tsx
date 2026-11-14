import * as RadixPopover from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

export function PopoverContent({
	className,
	align = "start",
	sideOffset = 4,
	...props
}: ComponentProps<typeof RadixPopover.Content>) {
	return (
		<RadixPopover.Portal>
			<RadixPopover.Content
				align={align}
				sideOffset={sideOffset}
				collisionPadding={16}
				className={cn(
					"z-30 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-raised p-2 shadow-lg outline-none",
					className,
				)}
				{...props}
			/>
		</RadixPopover.Portal>
	);
}
