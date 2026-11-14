import {
	type CSSProperties,
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
	snapEndPadding: number;
}

const EDGE_TOLERANCE_PX = 1;

const unmeasured: ScrollEdges = {
	overflowing: false,
	atStart: true,
	atEnd: true,
	stickyInset: 0,
	snapEndPadding: 0,
};

export function measureScrollEdges(element: HTMLElement): ScrollEdges {
	const contentWidth =
		(element.firstElementChild as HTMLElement | null)?.scrollWidth ??
		element.scrollWidth;
	const hiddenWidth = contentWidth - element.clientWidth;
	const overflowing = hiddenWidth > EDGE_TOLERANCE_PX;
	const position = Math.abs(element.scrollLeft);
	const stickyCell = element.querySelector<HTMLElement>("[data-sticky-column]");
	const stickyInset = stickyCell?.offsetWidth ?? 0;
	const lastColumn = element.querySelector<HTMLElement>(
		"thead tr > :last-child",
	);
	const snapEndPadding = overflowing
		? Math.max(
				0,
				element.clientWidth - stickyInset - (lastColumn?.offsetWidth ?? 0),
			)
		: 0;
	return {
		overflowing,
		atStart: position <= EDGE_TOLERANCE_PX,
		atEnd: position >= hiddenWidth - EDGE_TOLERANCE_PX,
		stickyInset,
		snapEndPadding,
	};
}

function sameEdges(left: ScrollEdges, right: ScrollEdges): boolean {
	return (
		left.overflowing === right.overflowing &&
		left.atStart === right.atStart &&
		left.atEnd === right.atEnd &&
		left.stickyInset === right.stickyInset &&
		left.snapEndPadding === right.snapEndPadding
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
				className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain pt-1 pe-(--snap-end-padding) print:snap-none print:overflow-visible print:pe-0"
				style={
					{
						scrollPaddingInlineStart: edges.stickyInset,
						"--snap-end-padding": `${edges.snapEndPadding}px`,
					} as CSSProperties
				}
			>
				{children}
			</div>
			{edges.overflowing && !edges.atEnd ? <MoreColumnsHint /> : null}
		</div>
	);
}
