import { type ReactNode, useRef } from "react";
import { useBottomBar } from "../bottom-bars";

export interface StickyActionBarProps {
	/** One primary action, usually, with a quantity stepper beside it. */
	readonly children: ReactNode;
	readonly testId?: string;
}

/**
 * The bar of a flow screen that keeps its main action in reach: stuck to the bottom of the page, a card with a hairline
 * on top, the safe area under it. It sits in the page's own flow, so it takes no padding, but it tells the shell its
 * height so that a focused control is scrolled clear of it, and it marks itself `data-bottom-bar`.
 */
export function StickyActionBar({ children, testId }: StickyActionBarProps) {
	const ref = useRef<HTMLDivElement>(null);
	useBottomBar(ref, true, true);
	return (
		<div
			ref={ref}
			data-bottom-bar="action"
			data-testid={testId}
			className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-line bg-surface-raised px-4 pt-2 pb-[calc(0.5rem+var(--zaui-safe-area-inset-bottom,0px))]"
		>
			{children}
		</div>
	);
}
