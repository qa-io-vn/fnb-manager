import {
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

export interface ScrollEdges {
	overflowing: boolean;
	atStart: boolean;
	atEnd: boolean;
	stickyInset: number;
}

const EDGE_TOLERANCE_PX = 1;

const unmeasured: ScrollEdges = {
	overflowing: false,
	atStart: true,
	atEnd: true,
	stickyInset: 0,
};

export function measureScrollEdges(element: HTMLElement): ScrollEdges {
	const hiddenWidth = element.scrollWidth - element.clientWidth;
	const position = Math.abs(element.scrollLeft);
	const stickyCell = element.querySelector<HTMLElement>("[data-sticky-column]");
	return {
		overflowing: hiddenWidth > EDGE_TOLERANCE_PX,
		atStart: position <= EDGE_TOLERANCE_PX,
		atEnd: position >= hiddenWidth - EDGE_TOLERANCE_PX,
		stickyInset: stickyCell?.offsetWidth ?? 0,
	};
}

function sameEdges(left: ScrollEdges, right: ScrollEdges): boolean {
	return (
		left.overflowing === right.overflowing &&
		left.atStart === right.atStart &&
		left.atEnd === right.atEnd &&
		left.stickyInset === right.stickyInset
	);
}

export function useScrollEdges(
	scroller: RefObject<HTMLElement | null>,
): ScrollEdges {
	const [edges, setEdges] = useState(unmeasured);
	useEffect(() => {
		const element = scroller.current;
		if (!element) return;
		const update = () => {
			const next = measureScrollEdges(element);
			setEdges((current) => (sameEdges(current, next) ? current : next));
		};
		update();
		element.addEventListener("scroll", update, { passive: true });
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		observer?.observe(element);
		if (element.firstElementChild) observer?.observe(element.firstElementChild);
		return () => {
			element.removeEventListener("scroll", update);
			observer?.disconnect();
		};
	}, [scroller]);
	return edges;
}

function MoreColumnsHint() {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-0 right-0 flex w-9 items-center justify-end bg-linear-to-l from-surface-raised from-30% to-transparent text-ink-muted print:hidden"
			data-testid="table-scroll-hint"
		>
			<svg
				viewBox="0 0 24 24"
				aria-hidden="true"
				className="size-5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M9 5l7 7-7 7" />
			</svg>
		</div>
	);
}

export function TableScroller({ children }: { children: ReactNode }) {
	const scroller = useRef<HTMLDivElement>(null);
	const edges = useScrollEdges(scroller);
	return (
		<div
			className="group/scroller relative"
			data-testid="table-scroll"
			data-overflowing={edges.overflowing}
			data-scrolled={!edges.atStart}
		>
			<div
				ref={scroller}
				className="overflow-x-auto overscroll-x-contain pt-1 print:overflow-visible"
				style={{ scrollPaddingInlineStart: edges.stickyInset }}
			>
				{children}
			</div>
			{edges.overflowing && !edges.atEnd ? <MoreColumnsHint /> : null}
		</div>
	);
}
