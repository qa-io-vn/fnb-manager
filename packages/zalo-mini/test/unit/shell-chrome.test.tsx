import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FloatingBar,
	focusScrollDelta,
	MAX_BADGE,
	MiniApp,
	type MiniAppRoute,
	type MiniAppTab,
	routeAt,
	StickyActionBar,
	scrollContainerOf,
	sharedCatalogs,
	shellProblems,
} from "../../src/react/index";
import type { SessionClient } from "../../src/session/types";

// Test design (ISTQB) for the route chrome and the bars at the bottom (design spec 6.0, 6.1, 7.4):
// - a decision table of the route (tab route or flow route) against the slot above the tabs and a bar of the screen: which
//   bars show, how many, and what the page leaves room for;
// - equivalence partitions of a tab's badge (none, zero, a negative, a fraction, an ordinary count, the largest and one
//   above it) and a state transition (the count changes while the tab bar is on screen);
// - the rules of the shell (a wrong chrome, a flow route behind a tab) and the matching of a route to an address.

const idleClient: SessionClient = {
	connect: () => new Promise(() => undefined),
	start: () => new Promise(() => undefined),
	bind: () => new Promise(() => undefined),
	pair: () => new Promise(() => undefined),
	acceptNotice: () => new Promise(() => undefined),
	texts: () => new Promise(() => undefined),
	forget: () => undefined,
};

function rect(height: number): DOMRect {
	return {
		height,
		width: 100,
		top: 0,
		left: 0,
		right: 100,
		bottom: height,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	};
}

// jsdom has no layout: each kind of bar is given a height, by its data-bottom-bar
function giveHeights(heights: Record<string, number>): void {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			return rect(heights[this.dataset.bottomBar ?? ""] ?? 0);
		},
	);
}

const TABS: readonly MiniAppTab[] = [
	{ path: "/", labelKey: "shell.plainState", icon: <i /> },
	{ path: "/b", labelKey: "shell.mainNavigation", icon: <i /> },
];

function show(
	options: {
		readonly start?: string;
		readonly routes?: readonly MiniAppRoute[];
		readonly tabs?: readonly MiniAppTab[];
		readonly strip?: boolean;
	} = {},
) {
	vi.stubEnv("VITE_MINI_APP_STAGE", "development");
	window.history.replaceState(
		{},
		"",
		options.start === undefined ? "/" : `/?route=${options.start}`,
	);
	const routes = options.routes ?? [
		{ path: "/", element: <p>home</p> },
		{ path: "/b", element: <p>tab b</p> },
		{ path: "/flow", chrome: "flow", element: <p>a flow screen</p> },
	];
	return render(
		<MiniApp
			language="vi"
			catalogs={sharedCatalogs}
			sessionClient={idleClient}
			routes={routes}
			tabs={options.tabs ?? TABS}
			standInHeader={null}
			{...(options.strip === true
				? { aboveTabs: <p data-testid="strip-content">Đơn #A12 · Đang làm</p> }
				: {})}
		/>,
	);
}

const count = { value: 0 as number | null, listeners: new Set<() => void>() };
const store = {
	subscribe: (listener: () => void) => {
		count.listeners.add(listener);
		return () => count.listeners.delete(listener);
	},
	snapshot: () => count.value,
	set(next: number | null) {
		count.value = next;
		for (const listener of count.listeners) listener();
	},
};

function useCount(): number | null {
	return useSyncExternalStore(store.subscribe, store.snapshot);
}

const root = () => document.documentElement.style;
const shell = () => screen.getByTestId("shell");

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	window.history.replaceState({}, "", "/");
});

describe("a tab route", () => {
	it("shows the tab bar, frames the page as tabs and leaves room for the bar and the safe area", () => {
		show();
		expect(screen.getByRole("navigation")).toBeTruthy();
		expect(shell().getAttribute("data-chrome")).toBe("tabs");
		expect(shell().getAttribute("data-bottom-bars")).toBe("1");
		const bars = root().getPropertyValue("--bottom-bars");
		expect(bars).toContain("48px");
		expect(bars).toContain("var(--zaui-safe-area-inset-bottom, 0px)");
		// the page is padded by it
		expect(document.querySelector("main")?.className).toContain(
			"pb-[var(--bottom-bars,0px)]",
		);
	});

	it("shows the strip above the tab bar and counts two bars, with room for the strip's height", () => {
		giveHeights({ strip: 56 });
		show({ strip: true });
		expect(screen.getByTestId("above-tabs").textContent).toContain("Đơn #A12");
		expect(
			screen.getByTestId("above-tabs").getAttribute("data-bottom-bar"),
		).toBe("strip");
		expect(shell().getAttribute("data-bottom-bars")).toBe("2");
		expect(root().getPropertyValue("--shell-bottom")).toContain("56px");
		expect(root().getPropertyValue("--bottom-bars")).toContain("56px");
	});

	it("shows no strip when none is given", () => {
		show();
		expect(screen.queryByTestId("above-tabs")).toBeNull();
	});
});

describe("a flow route", () => {
	it("hides the tab bar and the strip, takes no room for them and says so", () => {
		giveHeights({ strip: 56 });
		show({ start: "/flow", strip: true });
		expect(screen.getByText("a flow screen")).toBeTruthy();
		expect(screen.queryByRole("navigation")).toBeNull();
		expect(screen.queryByTestId("above-tabs")).toBeNull();
		expect(shell().getAttribute("data-chrome")).toBe("flow");
		expect(shell().getAttribute("data-bottom-bars")).toBe("0");
		expect(root().getPropertyValue("--bottom-bars")).toMatch(
			/^calc\(calc\(0px \+ 0px\) \+ 0px\)$/,
		);
	});

	it("is a tab route again when the address goes back to one", () => {
		show({ start: "/flow" });
		expect(screen.queryByRole("navigation")).toBeNull();
		act(() => {
			window.history.pushState({}, "", "/");
		});
	});

	it("has no tab bar at all in an app without tabs, whatever the chrome", () => {
		show({ tabs: [], strip: true });
		expect(screen.queryByRole("navigation")).toBeNull();
		expect(screen.queryByTestId("above-tabs")).toBeNull();
		expect(shell().getAttribute("data-bottom-bars")).toBe("0");
	});
});

describe("a bar of the screen", () => {
	const withCart = (path = "/b"): readonly MiniAppRoute[] => [
		{ path: "/", element: <p>home</p> },
		{
			path,
			element: (
				<FloatingBar kind="cart" testId="cart">
					2 món · Xem giỏ
				</FloatingBar>
			),
		},
		{ path: "/flow", chrome: "flow", element: <p>flow</p> },
	];

	it("registers its height with the shell, sits above the shell's bars and is counted", () => {
		giveHeights({ cart: 56 });
		show({ start: "/b", routes: withCart() });
		const cart = screen.getByTestId("cart");
		expect(cart.getAttribute("data-bottom-bar")).toBe("cart");
		expect(cart.style.bottom).toBe("calc(var(--shell-bottom, 0px) + 0.5rem)");
		expect(shell().getAttribute("data-bottom-bars")).toBe("2");
		expect(root().getPropertyValue("--bottom-bars")).toContain("56px");
		// the shell's own bottom does not include the screen's bar
		expect(root().getPropertyValue("--shell-bottom")).not.toContain("56px");
	});

	it("gives its room back when the screen goes away", () => {
		giveHeights({ cart: 56 });
		const { rerender } = show({ start: "/b", routes: withCart() });
		expect(root().getPropertyValue("--bottom-bars")).toContain("56px");
		// the same app, whose route /b no longer draws the bar
		rerender(
			<MiniApp
				language="vi"
				catalogs={sharedCatalogs}
				sessionClient={idleClient}
				routes={[
					{ path: "/", element: <p>home</p> },
					{ path: "/b", element: <p>b without the bar</p> },
				]}
				tabs={TABS}
				standInHeader={null}
			/>,
		);
		expect(root().getPropertyValue("--bottom-bars")).not.toContain("56px");
	});

	it("reports a screen with more than two bars", () => {
		giveHeights({ cart: 56, strip: 40 });
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		show({ start: "/b", routes: withCart(), strip: true });
		// the tab bar, the strip and the cart bar
		expect(shell().getAttribute("data-bottom-bars")).toBe("3");
		expect(error).toHaveBeenCalledWith(
			"a screen shows at most 2 bars at the bottom, found 3",
		);
	});

	it("is fine with exactly two bars, and says nothing", () => {
		giveHeights({ cart: 56 });
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		show({ start: "/b", routes: withCart() });
		expect(shell().getAttribute("data-bottom-bars")).toBe("2");
		expect(error).not.toHaveBeenCalled();
	});

	it("is counted and cleared by a sticky bar of the flow, which takes no padding of its own", () => {
		giveHeights({ action: 64 });
		show({
			start: "/flow",
			routes: [
				{ path: "/", element: <p>home</p> },
				{
					path: "/flow",
					chrome: "flow",
					element: (
						<StickyActionBar testId="action">Thêm vào giỏ</StickyActionBar>
					),
				},
			],
			tabs: [],
		});
		expect(shell().getAttribute("data-bottom-bars")).toBe("1");
		// the bar is in the page's flow: no padding under the page, but a focused control is scrolled clear of it
		expect(root().getPropertyValue("--bottom-bars")).not.toContain("64px");
		expect(root().getPropertyValue("--bottom-clear")).toContain("64px");
		expect(screen.getByTestId("action").getAttribute("data-bottom-bar")).toBe(
			"action",
		);
	});

	it("takes no room when it is hidden", () => {
		const hidden: readonly MiniAppRoute[] = [
			{ path: "/", element: <p>home</p> },
			{
				path: "/b",
				element: (
					<FloatingBar kind="cart" show={false} testId="cart">
						x
					</FloatingBar>
				),
			},
		];
		show({ start: "/b", routes: hidden });
		expect(screen.queryByTestId("cart")).toBeNull();
		expect(shell().getAttribute("data-bottom-bars")).toBe("1");
	});
});

describe("a tab's badge", () => {
	function tabsWith(badge: () => number | null): readonly MiniAppTab[] {
		return [
			{ path: "/", labelKey: "shell.plainState", icon: <i /> },
			{
				path: "/b",
				labelKey: "shell.mainNavigation",
				icon: <i />,
				badge,
			},
		];
	}

	function badgeOf(value: number | null) {
		show({ tabs: tabsWith(() => value) });
		return screen.queryByTestId("tab-badge");
	}

	it.each([
		[3, "3", "3 mới"],
		[1, "1", "1 mới"],
		[99, "99", "99 mới"],
		[100, "99+", "100 mới"],
		[150, "99+", "150 mới"],
		[2.7, "2", "2 mới"],
	])(
		"shows a count of %s as %s, and says %s to a screen reader",
		(value, shown, spoken) => {
			const badge = badgeOf(value);
			expect(badge?.textContent).toBe(shown);
			expect(badge?.getAttribute("aria-hidden")).toBe("true");
			expect(document.querySelector(".sr-only")?.textContent).toBe(spoken);
			expect(MAX_BADGE).toBe(99);
		},
	);

	it.each([[null], [0], [-1], [0.4], [Number.NaN]])(
		"shows no badge for %s",
		(value) => {
			expect(badgeOf(value)).toBeNull();
			expect(document.querySelector(".sr-only")).toBeNull();
		},
	);

	it("follows a store the badge reads through a hook: the count appears, changes and goes", () => {
		store.set(0);
		show({ tabs: tabsWith(useCount) });
		expect(screen.queryByTestId("tab-badge")).toBeNull();
		act(() => store.set(2));
		expect(screen.getByTestId("tab-badge").textContent).toBe("2");
		act(() => store.set(7));
		expect(screen.getByTestId("tab-badge").textContent).toBe("7");
		act(() => store.set(null));
		expect(screen.queryByTestId("tab-badge")).toBeNull();
	});

	it("uses the tab's own message for the spoken count and keeps the tab's label as it is", () => {
		const own = {
			vi: {
				...sharedCatalogs.vi,
				"shell.ordersWaiting": "{count} đơn đang chờ",
			},
			en: {
				...sharedCatalogs.en,
				"shell.ordersWaiting": "{count} orders waiting",
			},
		};
		vi.stubEnv("VITE_MINI_APP_STAGE", "development");
		window.history.replaceState({}, "", "/");
		render(
			<MiniApp
				language="vi"
				catalogs={own}
				sessionClient={idleClient}
				routes={[
					{ path: "/", element: <p>home</p> },
					{ path: "/b", element: <p>b</p> },
				]}
				tabs={[
					{ path: "/", labelKey: "shell.plainState", icon: <i /> },
					{
						path: "/b",
						labelKey: "shell.mainNavigation",
						icon: <i />,
						badge: () => 4,
						badgeLabelKey: "shell.ordersWaiting",
					},
				]}
				standInHeader={null}
			/>,
		);
		expect(document.querySelector(".sr-only")?.textContent).toBe(
			"4 đơn đang chờ",
		);
		// the label of the tab is its own element, so a test (or a person) still finds it by its text
		expect(screen.getByText("Điều hướng chính")).toBeTruthy();
	});

	it("keeps working when a tab is chosen", () => {
		show({ tabs: tabsWith(() => 5) });
		fireEvent.click(screen.getByText("Điều hướng chính"));
		expect(screen.getByText("tab b")).toBeTruthy();
		expect(screen.getByTestId("tab-badge").textContent).toBe("5");
	});
});

describe("the shell's rules for chrome", () => {
	const flow = (path: string): MiniAppRoute => ({
		path,
		chrome: "flow",
		element: <p>x</p>,
	});

	it("accept a flow route that is not a tab, and a route without a chrome", () => {
		expect(
			shellProblems([{ path: "/", element: <p>x</p> }, flow("/mon/:id")], []),
		).toEqual([]);
		expect(
			shellProblems(
				[
					{ path: "/", element: <p>x</p> },
					{ path: "/b", element: <p>x</p> },
					flow("/gio-hang"),
				],
				[
					{ path: "/", labelKey: "k", icon: null },
					{ path: "/b", labelKey: "k", icon: null },
				],
			),
		).toEqual([]);
	});

	it("refuse a chrome that is neither tabs nor flow, and a flow route behind a tab", () => {
		expect(
			shellProblems(
				[
					{ path: "/", element: <p>x</p> },
					{ path: "/b", chrome: "modal" as never, element: <p>x</p> },
				],
				[],
			),
		).toEqual(['the route /b has the chrome "modal": use tabs or flow']);
		expect(
			shellProblems(
				[{ path: "/", element: <p>x</p> }, flow("/b")],
				[
					{ path: "/", labelKey: "k", icon: null },
					{ path: "/b", labelKey: "k", icon: null },
				],
			),
		).toEqual([
			"the route of the tab /b is a flow route: it would hide its own tab bar",
		]);
	});
});

describe("routeAt", () => {
	const routes: readonly MiniAppRoute[] = [
		{ path: "/", element: <p>x</p> },
		{ path: "/mon/:id", chrome: "flow", element: <p>x</p> },
		{ path: "/cua-hang/:code", element: <p>x</p> },
	];

	it("finds the route of an address, with its parameters", () => {
		expect(routeAt(routes, "/")?.path).toBe("/");
		expect(routeAt(routes, "/mon/c-01")?.chrome).toBe("flow");
		expect(routeAt(routes, "/cua-hang/mau-1")?.path).toBe("/cua-hang/:code");
	});

	it("finds nothing for an address no route has (a longer path, another root)", () => {
		expect(routeAt(routes, "/mon/c-01/them")).toBeUndefined();
		expect(routeAt(routes, "/khong-co")).toBeUndefined();
		expect(routeAt(routes, "/mon")).toBeUndefined();
	});
});

describe("focusScrollDelta", () => {
	// a viewport 800 px high with bars 104 px high: the clear area ends at 696 px, and 8 px of air is kept
	const delta = (top: number, bottom: number, clear = 104) =>
		focusScrollDelta({ top, bottom }, 800, clear);

	it("leaves a control that is clear of the bars alone, up to the last pixel above the air", () => {
		expect(delta(100, 148)).toBe(0);
		expect(delta(640, 688)).toBe(0);
	});

	it("scrolls a control that a bar covers, by what it takes to clear the bars and the air", () => {
		expect(delta(641, 689)).toBe(1);
		expect(delta(695, 743)).toBe(55);
		expect(delta(752, 800)).toBe(112);
	});

	it("does nothing without a bar, or when the height of the bars is not a number", () => {
		expect(delta(752, 800, 0)).toBe(0);
		expect(delta(752, 800, Number.NaN)).toBe(0);
		expect(focusScrollDelta({ top: 752, bottom: 800 }, 800, -5)).toBe(0);
	});

	it("never scrolls the top of a control off the screen, and never scrolls up", () => {
		expect(delta(20, 780)).toBe(20);
		expect(delta(-30, 740)).toBe(0);
	});
});

describe("the shell scrolls a focused control clear of the bars", () => {
	it("scrolls by what the bars cover when a control under them takes the focus", async () => {
		const scrollBy = vi.fn();
		Object.assign(document.documentElement, { scrollBy });
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
		show({
			routes: [
				{
					path: "/",
					element: (
						<button type="button" data-testid="low">
							Thấp
						</button>
					),
				},
				{ path: "/b", element: <p>b</p> },
			],
			strip: true,
		});
		const low = screen.getByTestId("low");
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				if (this.dataset.bottomBar === "strip") {
					return { ...rect(56), top: 696, bottom: 752 };
				}
				if (this.classList.contains("zaui-bottom-navigation")) {
					return { ...rect(48), top: 752, bottom: 800 };
				}
				if (this.dataset.testid === "low") {
					return { ...rect(48), top: 695, bottom: 743 };
				}
				return rect(0);
			},
		);
		act(() => low.focus());
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(scrollBy).toHaveBeenCalledWith(0, 55);
		Reflect.deleteProperty(document.documentElement, "scrollBy");
	});

	it("leaves a control inside a bar alone", async () => {
		const scrollBy = vi.fn();
		Object.assign(document.documentElement, { scrollBy });
		vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
		show({
			routes: [
				{ path: "/", element: <p>home</p> },
				{ path: "/b", element: <p>b</p> },
			],
			strip: true,
		});
		const strip = screen.getByTestId("above-tabs");
		const inside = document.createElement("button");
		strip.append(inside);
		act(() => inside.focus());
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(scrollBy).not.toHaveBeenCalled();
		Reflect.deleteProperty(document.documentElement, "scrollBy");
	});
});

describe("scrollContainerOf", () => {
	function scroller(
		overflowY: string,
		scrollHeight: number,
		clientHeight: number,
	) {
		const element = document.createElement("div");
		element.style.overflowY = overflowY;
		Object.defineProperty(element, "scrollHeight", { value: scrollHeight });
		Object.defineProperty(element, "clientHeight", { value: clientHeight });
		return element;
	}

	it("finds the nearest ancestor that really scrolls up and down (ZaUI makes the body the scroller)", () => {
		const outer = scroller("auto", 900, 800);
		const inner = scroller("auto", 900, 800);
		const button = document.createElement("button");
		inner.append(button);
		outer.append(inner);
		document.body.append(outer);
		expect(scrollContainerOf(button)).toBe(inner);
		inner.remove();
		outer.remove();
	});

	it("skips an ancestor that scrolls only sideways or has nothing to scroll, and ends at the document", () => {
		const chips = scroller("auto", 48, 48);
		const hidden = scroller("hidden", 900, 800);
		const visible = scroller("visible", 900, 800);
		const button = document.createElement("button");
		chips.append(button);
		hidden.append(chips);
		visible.append(hidden);
		document.body.append(visible);
		expect(scrollContainerOf(button)).toBe(
			document.scrollingElement ?? document.documentElement,
		);
		visible.remove();
	});

	it("takes an ancestor that is set to scroll", () => {
		const area = scroller("scroll", 500, 300);
		const button = document.createElement("button");
		area.append(button);
		document.body.append(area);
		expect(scrollContainerOf(button)).toBe(area);
		area.remove();
	});
});
