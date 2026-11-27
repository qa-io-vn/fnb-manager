import {
	createContext,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

// The bars that stay at the bottom of the screen (design spec 6.0, 7.4). The shell owns two of them, the tab bar and the
// strip above it; a screen may own more, such as a cart bar floating over the tab bar, or a sticky action bar at the end
// of a flow screen. Each one tells the shell how tall it is, and the shell turns the heights into three custom properties
// on the document: --shell-bottom (the tab bar and the strip), --bottom-bars (those and the floating bars: the padding
// under the page) and --bottom-clear (every bar, a sticky one included: the scroll padding of the document and the offset
// of a toast), so that a focused control is never hidden behind a bar (WCAG 2.4.11). At most two bars show at once.

export const MAX_BOTTOM_BARS = 2;

/** What marks a bar at the bottom: the shell's tab bar and strip, and the bars that screens register. */
export const BAR_SELECTOR = "[data-bottom-bar], .zaui-bottom-navigation";

const FOCUS_GAP_PX = 8;

/**
 * How much of the bottom of the screen the bars cover, measured from where they are drawn: the distance from the highest
 * top of a bar that is on screen to the bottom of the viewport (0 without a bar). Measured rather than read from the
 * scroll padding, because a browser may leave that custom property unresolved, and a bar's height can change.
 */
export function clearHeightOf(viewportBottom: number): number {
	let top = viewportBottom;
	for (const bar of document.querySelectorAll(BAR_SELECTOR)) {
		const box = bar.getBoundingClientRect();
		if (box.height > 0 && box.top < viewportBottom)
			top = Math.min(top, box.top);
	}
	return viewportBottom - top;
}

/**
 * The element that scrolls the page a control sits in. ZaUI makes the body the scroller (`html` is `overflow: hidden`),
 * so `window.scrollBy` does nothing in a Mini App: the nearest ancestor that really scrolls up and down, or the
 * document's own scroller when there is none.
 */
export function scrollContainerOf(element: HTMLElement): HTMLElement {
	for (let at = element.parentElement; at !== null; at = at.parentElement) {
		const overflow = getComputedStyle(at).overflowY;
		if (
			(overflow === "auto" || overflow === "scroll") &&
			at.scrollHeight > at.clientHeight
		) {
			return at;
		}
	}
	return (
		(document.scrollingElement as HTMLElement | null) ??
		document.documentElement
	);
}

/**
 * How far to scroll the page up (in px) so that a focused element is clear of the bars at the bottom, or 0 when it is
 * already. `clearPx` is the height of every bar. A browser does not scroll an element that is inside the viewport,
 * even when a bar covers it, whatever the scroll padding says, so the shell scrolls it itself (WCAG 2.4.11, focus not
 * obscured). The element's top is never scrolled off the screen.
 */
export function focusScrollDelta(
	rect: { readonly top: number; readonly bottom: number },
	viewportHeight: number,
	clearPx: number,
): number {
	if (!(clearPx > 0)) return 0;
	const overlap = rect.bottom - (viewportHeight - clearPx) + FOCUS_GAP_PX;
	if (overlap <= 0) return 0;
	return Math.max(0, Math.min(overlap, rect.top));
}

interface BottomBarsValue {
	/** A bar of a screen with its height; `inFlow` is a bar that sits in the page's own flow (it needs no padding). */
	readonly register: (key: string, height: number, inFlow: boolean) => void;
	readonly unregister: (key: string) => void;
}

interface RegisteredBar {
	readonly height: number;
	readonly inFlow: boolean;
}

export const BottomBarsContext = createContext<BottomBarsValue | null>(null);

/** The height of an element, kept up to date while it is on screen (zero when it is not drawn or there is no layout). */
export function useElementHeight(
	ref: RefObject<HTMLElement | null>,
	active = true,
): number {
	const [height, setHeight] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!active || element === null) {
			setHeight(0);
			return;
		}
		const measure = () => setHeight(element.getBoundingClientRect().height);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, active]);
	return height;
}

let nextBar = 0;

/**
 * Registers a bar that a screen draws at the bottom (a fixed element) with the shell while `active`, so the page leaves
 * room for it and the other bars sit under it. Pass the ref of the bar's element. Without a shell it does nothing.
 */
export function useBottomBar(
	ref: RefObject<HTMLElement | null>,
	active = true,
	inFlow = false,
): void {
	const bars = useContext(BottomBarsContext);
	const height = useElementHeight(ref, active);
	const [key] = useState(() => {
		nextBar += 1;
		return `bar-${nextBar}`;
	});
	useEffect(() => {
		if (bars === null || !active) return;
		bars.register(key, height, inFlow);
		return () => bars.unregister(key);
	}, [bars, key, height, active, inFlow]);
}

export interface FloatingBarProps {
	readonly children: ReactNode;
	readonly testId?: string;
	/** Whether the bar shows; a hidden bar takes no room. */
	readonly show?: boolean;
	/** The kind of bar, written as data-bottom-bar ("cart", for a cart bar). */
	readonly kind?: string;
}

/**
 * A bar that floats over the bottom of a tab screen, above the shell's own bars: it registers its height so the page
 * leaves room for it, and sits 8 px above the tab bar (or the strip) and 12 px in from the sides.
 */
export function FloatingBar({
	children,
	testId,
	show = true,
	kind = "floating",
}: FloatingBarProps) {
	const holder = useRef<HTMLDivElement>(null);
	useBottomBar(holder, show);
	if (!show) return null;
	return (
		<div
			ref={holder}
			data-bottom-bar={kind}
			data-testid={testId}
			className="fixed inset-x-3 z-30"
			style={{ bottom: "calc(var(--shell-bottom, 0px) + 0.5rem)" }}
		>
			{children}
		</div>
	);
}

/** The shell's side: collects the bars that screens register. */
export function useBarRegistry(): {
	readonly value: BottomBarsValue;
	/** The height of the bars that take room under the page (the floating ones). */
	readonly padding: number;
	/** The height of every bar of the screens, the sticky ones included. */
	readonly all: number;
	readonly count: number;
} {
	const [bars, setBars] = useState<ReadonlyMap<string, RegisteredBar>>(
		() => new Map(),
	);
	const [value] = useState<BottomBarsValue>(() => ({
		register: (key, height, inFlow) =>
			setBars((previous) => {
				const known = previous.get(key);
				return known?.height === height && known.inFlow === inFlow
					? previous
					: new Map(previous).set(key, { height, inFlow });
			}),
		unregister: (key) =>
			setBars((previous) => {
				if (!previous.has(key)) return previous;
				const next = new Map(previous);
				next.delete(key);
				return next;
			}),
	}));
	let padding = 0;
	let all = 0;
	for (const bar of bars.values()) {
		all += bar.height;
		if (!bar.inFlow) padding += bar.height;
	}
	return { value, padding, all, count: bars.size };
}
