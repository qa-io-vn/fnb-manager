import { describe, expect, it } from "vitest";
import { measureScrollEdges } from "./table-scroller";

interface Geometry {
	clientWidth: number;
	scrollWidth: number;
	scrollLeft: number;
	tableWidth: number;
	stickyWidth: number;
	lastColumnWidth: number;
}

function scrollerWith(geometry: Geometry): HTMLElement {
	const scroller = document.createElement("div");
	const table = document.createElement("table");
	table.innerHTML =
		"<thead><tr><th data-sticky-column>Cửa hàng</th><th>A</th><th>B</th></tr></thead>";
	scroller.append(table);
	const define = (target: HTMLElement, name: string, value: number) =>
		Object.defineProperty(target, name, { configurable: true, value });
	define(scroller, "clientWidth", geometry.clientWidth);
	define(scroller, "scrollWidth", geometry.scrollWidth);
	define(scroller, "scrollLeft", geometry.scrollLeft);
	define(table, "scrollWidth", geometry.tableWidth);
	const headers = table.querySelectorAll<HTMLElement>("th");
	define(headers[0] as HTMLElement, "offsetWidth", geometry.stickyWidth);
	define(
		headers[headers.length - 1] as HTMLElement,
		"offsetWidth",
		geometry.lastColumnWidth,
	);
	return scroller;
}

describe("measureScrollEdges", () => {
	it("leaves a table that fits without overflow and without snap padding", () => {
		const edges = measureScrollEdges(
			scrollerWith({
				clientWidth: 300,
				scrollWidth: 300,
				scrollLeft: 0,
				tableWidth: 280,
				stickyWidth: 100,
				lastColumnWidth: 80,
			}),
		);
		expect(edges).toEqual({
			overflowing: false,
			atStart: true,
			atEnd: true,
			stickyInset: 100,
			snapEndPadding: 0,
		});
	});

	it("pads a wide table so that its last column can rest right after the sticky column", () => {
		const edges = measureScrollEdges(
			scrollerWith({
				clientWidth: 300,
				scrollWidth: 620,
				scrollLeft: 0,
				tableWidth: 500,
				stickyWidth: 100,
				lastColumnWidth: 80,
			}),
		);
		expect(edges.overflowing).toBe(true);
		expect(edges.snapEndPadding).toBe(120);
		expect(edges.atStart).toBe(true);
		expect(edges.atEnd).toBe(false);
	});

	it("does not count its own snap padding as overflow", () => {
		const edges = measureScrollEdges(
			scrollerWith({
				clientWidth: 300,
				scrollWidth: 420,
				scrollLeft: 0,
				tableWidth: 300,
				stickyWidth: 100,
				lastColumnWidth: 80,
			}),
		);
		expect(edges.overflowing).toBe(false);
		expect(edges.snapEndPadding).toBe(0);
	});

	it("measures the space its wrapper gives it, so a padding left from a wider layout cannot hold it wide", () => {
		const scroller = scrollerWith({
			clientWidth: 537,
			scrollWidth: 537,
			scrollLeft: 0,
			tableWidth: 522,
			stickyWidth: 104,
			lastColumnWidth: 96,
		});
		const wrapper = document.createElement("div");
		wrapper.append(scroller);
		Object.defineProperty(wrapper, "clientWidth", {
			configurable: true,
			value: 294,
		});
		const edges = measureScrollEdges(scroller);
		expect(edges.overflowing).toBe(true);
		expect(edges.snapEndPadding).toBe(94);
	});

	it("reports the end as soon as the last column is in view, before the snap padding", () => {
		const edges = measureScrollEdges(
			scrollerWith({
				clientWidth: 300,
				scrollWidth: 620,
				scrollLeft: 200,
				tableWidth: 500,
				stickyWidth: 100,
				lastColumnWidth: 80,
			}),
		);
		expect(edges.atEnd).toBe(true);
	});

	it("reports the end once the scroller reaches its last position", () => {
		const edges = measureScrollEdges(
			scrollerWith({
				clientWidth: 300,
				scrollWidth: 620,
				scrollLeft: 320,
				tableWidth: 500,
				stickyWidth: 100,
				lastColumnWidth: 80,
			}),
		);
		expect(edges.atStart).toBe(false);
		expect(edges.atEnd).toBe(true);
	});
});
